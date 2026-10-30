---
type: reference
title: 写路径与观测语义的五条硬契约
description: pull / inspect / run 的版本语义、激活行号与半写状态、ICF 会话过期重试、select 行类型、发布依赖与错误边界 — 五条经真机验证的契约，改 CLI 或 ICF 前先对照
tags: [abap-cli, design-decisions, semantics, activation, icf, select, publishing]
created at: 2026-10-29 22:20:00
changed at: 2026-10-29 22:20:00
---

# 006 — 写路径与观测语义的五条硬契约

## 背景

1.0.0 之前（0.2.x 期间）的一轮外部反馈暴露了一批"CLI 说得太确定、但说的不是事实"的问题。逐条在真机（`vhcala4hci:50000`，A4H）上复现、定位到具体层（client TS / 自带 ICF / SAP 内核 / 本机环境）并修掉之后，沉淀出下面五条长期契约。它们描述的是 **agent 通过 `--json` 看到的信号到底代表什么**，不是实现细节。

> 一次性核验报告不进仓库；本页只保留可复用的结论与实现落点，供后续改动对照。

## 1. 三种"版本"必须分开说：latest / active / runnable

**契约**

- `pull` / `diff` / `status` 读取的是 **working area（latest，可能未激活）** 版本；`run` / 激活语义使用 **active** 版本。
- `inspect --activation` 的权威信号是 **ADT inactive-objects 列表**（对象级"当前用户是否持有未激活版本"），逐 part 的 active 比较只作补充。
- 存在未激活版本时，`pull` 必须显式暴露 `data.versionKind`（`latest` / `active`），`pull --active` 可选 active 版本，并对"拿到了未激活源码"发出 `PENDING_INACTIVE_VERSION` 警告。

**现象与根因**

`push` 报成功 → `run` 执行旧源码，曾经被误诊为 classrun 缓存。真实机制是：`push` 的激活曾是静默空操作（已由独立构造请求体修复）；同时 `pull` 返回 latest、`inspect --activation` 因为在 OO 类上排除了系统托管的 `source/main` 而误报 `ok: true`——三个信号里两个在撒谎，只有 `run` 是对的。

**实现落点**：`formats/pull-strategy.ts`（`versionKind`）、`clients/adt-client.ts`（`getObjectSource` / `getActiveObjectSource`）、`flows/search/inspect-ops.ts`（`hasPendingInactiveVersion`）。

## 2. 激活错误的位置语义：以 `href#start=<line>,<col>` 为准

**契约**

- SAP 激活消息里的 `line` 是 **相对生成 include** 的行号；准确位置在消息 `href` 的 `#start=<line>,<col>` 片段。
- `ACTIVATION_FAILED` 必须携带 `lineScope`（`source-uri` / `generated-include`）说明手上的行号属于哪一类，并同时保留 SAP 原始 messages。
- 失败的 `push` 必须区分 **written / activated**：`ACTIVATION_FAILED` 带 `written: true` / `activated: false`，`push --json` 的 `results[]` 分列两个状态位。

**现象与根因**

真实第 16 行的语法错误被报成 `line 1`；且同一错误前缀被拼了两次。更危险的是"写进去但没激活"的半写状态没有任何信号，agent 会以为可以重试或继续。

**实现落点**：`clients/activation.ts`（href 解析 + `lineScope`）、`flows/edit/push.ts` / `push-object.ts`（`written` / `activated` 透出）、`nextSteps` 指向 `inspect --activation`。

## 3. ICF 通道的过期会话是 `HTTP 400 Session Timed Out`

**契约**

- 除 401/403 之外，ICF 层对过期 session 返回 **400 + "Session Timed Out"**，必须同样触发重登后重试；否则所有 ICF 命令（`select` / `deploy status` / `--textpool` / TABL pull）会持续失败到用户手动重登。
- session jar 写入失败必须 **每进程每类只告警一次**，且说明后果（复用失效 → 每次全新登录），不能每条命令刷屏。

**现象与根因**

旧实现只对 401/403 做 stale-session 兜底；`deploy status` 因此报 `unreachable`，而同一时刻 ADT 完全可用。本机沙箱拒绝写 `~/.abap-cli/sessions/` 时，告警刷屏掩盖了"每次命令都重新登录"的真实后果。

**实现落点**：`clients/icf-client.ts`（400 + `Session Timed Out` 判定）、`session/*`（one-shot 告警）。

## 4. `select` 的动态行类型必须来自 DDIC，不能按名字猜

**契约**

- 构建动态行类型时优先使用表自身的 DDIC 行类型（`cl_abap_typedescr=>describe_by_name` + `get_table_line_type`）。
- 回退映射按 **类型族** 处理（INT1/2/4/8、RAW、RAWSTRING、DF16/DECFLOAT、UTCLONG…），不得把 INT/RAW 一律映射成 CHAR——那会让 `DD03L`、`VRSD`、`TSTC`、`REPOSRC` 等表直接 dump（`not Unicode convertible`）。
- 这批表是行类型映射的回归基准。

**实现落点**：`abap/src/zcl_abap_vibe_icf_data.clas.abap`（动态行类型构建）、`src/abap_cli/formats/ddic/*`（客户端字段元数据）。

## 5. 发布产物依赖与顶层错误边界

**契约**

- `dist` 静态 `import` 的包必须在 `dependencies`（不能只在 `devDependencies`），`doctor env.deps` 要探测它们；发布包必须能在只有 dependencies 的环境里跑通 `--help`。
- 顶层错误处理不得 `JSON.parse` 人类可读模式的 stderr 文本；解析失败时降级为合成形状，绝不用新异常覆盖原错误。
- SAP 返回 HTML（dump / ICM 5xx）时归类为 `errorKind` + 截断摘要，完整原文只放在 `details.sapErrorBody`。

**现象与根因**

典型事故形状：发布产物静态 import 了 devDependency，registry 安装后 `create --help` 崩溃；顶层错误处理再把真实原因替换成 `SyntaxError`。本机因全局安装是源码目录 symlink 而掩盖了问题——不能用本机可跑来判定发布包可用。

**实现落点**：`package.json`（dependencies）、`flows/setup/doctor-checks.ts`（`env.deps`）、`top-error.ts`、`clients/http-error.ts`。

## 被否决方案

- **`inspect --activation` 只比较 includes 各 part**：对 OO 类不可靠（未激活新源码只体现在 `source/main`），会给出 `ok: true` 假阳性。
- **把 SAP 的 `line` 直接当源码行号展示**：生成 include 与源码行号不一致，agent 会去改错行。
- **把 400 一律当 SAP_ERROR 不重试**：过期 cookie jar 会让整条 ICF 命令族长期不可用，且用户没有任何恢复提示。
- **按 built-in 类型名硬编码 INT/RAW→CHAR**：Unicode 转换 dump，且随 SAP 版本漂移。
- **把 ajv 留在 devDependencies、错误处理里 JSON.parse stderr**：掩盖真实原因，故障转移成本极高。

## 当前代价

- `inspect --activation` 多一次 inactive-objects 列表请求（只读、可缓存）。
- 400 重试增加一次登录延迟；需要区分"真 400 业务错误"与"会话过期 400"（靠响应体标记）。
- DDIC 行类型路径依赖 `describe_by_name` 的权限；回退类型族表需要随 SAP 新类型维护。
- `doctor env.deps` 增加探测项，启动诊断略慢。

## 后果

- **正面**：`pull` / `inspect` / `run` / `push` 的信号语义明确，agent 不会再被"三个信号两个假"的现场误导；写失败可判断能否重试；ICF 命令族抗会话过期。
- **负面**：多出 `versionKind` / `lineScope` / `written` / `activated` 等字段，agent 需要读文档（`docs/commands.md` 与命令页）；这些字段一旦改名就是 breaking。

# references

- [`docs/commands.md`](../../docs/commands.md) — `pull` / `push` / `inspect` 的字段契约
- 命令页：[`pull.md`](../commands/pull.md)、[`push.md`](../commands/push.md)、[`inspect.md`](../commands/inspect.md)
- 源码：[`formats/pull-strategy.ts`](../../src/abap_cli/formats/pull-strategy.ts)、[`clients/activation.ts`](../../src/abap_cli/clients/activation.ts)、[`clients/icf-client.ts`](../../src/abap_cli/clients/icf-client.ts)、[`flows/search/inspect-ops.ts`](../../src/abap_cli/flows/search/inspect-ops.ts)
- [`wiki/design-decisions/002-icf-bypass-ddic.md`](002-icf-bypass-ddic.md) — 为什么 ICF 通道存在
