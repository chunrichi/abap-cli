---
name: abap-object
description: abap-cli 对象全生命周期 — 源码对象（`search` / `where-used` / `pull` / `push` / `check` / `create` / `activate` / `inspect` / `diff` / `status` / `create local`）与 DDIC 定义（DOMA / DTEL / TABL / STRU 经 `pull --type` / `create --file` / `push *.json`），以及对该对象的只读消费（`select` 表查询 / `run` 跑类 / `tcode` 查业务码）。use when asking how to change a SAP object / download an ABAP class / push a local file / run syntax or ATC / create a new object / activate inactive parts / inspect metadata / diff local vs SAP / query a table / run a classrun / resolve a transaction code.
metadata:
  version: "0.2.0"
  scope: sap
  commands: [search, where-used, pull, push, check, create, activate, inspect, diff, status, "create local", select, run, tcode]
---

# abap-object — 对象全生命周期 + 对对象的只读消费

`sap scope` — 这 13 个命令（或子命令）走 SAP 系统的 ADT REST API 或自建 ICF 服务，覆盖一个对象（CLAS / PROG / INTF / FUGR / TABL / STRU / DOMA / DTEL）从搜索、创建、下载、编辑、校验、推送、激活到对账的全流程，**外加** 对该对象的只读消费（查表 / 跑类 / 查业务码）。

为什么不拆成"写"与"读数据"两个 skill：因为它们的真实意图维度是**"对哪个对象"**，与 `abap-setup` 的"环境就绪"维度正交。`push ZCL_FOO` 后通常紧跟 `run ZCL_FOO`、`push ZT_FOO` 后通常紧跟 `select --table ZT_FOO`，合一个 skill 让 agent 决策一次完成。

## 何时用

- 首次进入项目，把已有对象（CLAS / PROG / INTF / FUGR / TABL）拉到本地编辑
- 创建新 ABAP 对象（class / interface / program / function group / table / structure / domain / data element）
- 编辑本地 `.abap` / `.json` 文件后推回 SAP（带 transport / 锁 / 激活）
- 推送前做语法检查 / 内容检查 / ATC 检查
- 对象激活状态对不上（`push` 报 activated 但实际未激活）时用 `inspect --activation` 诊断 + `activate` 修复
- 比较本地与 SAP 差异（diff / status）后再决定 pull 或 push
- 显式编排 status → pull → push——CI 友好
- 离线起一份草稿（`create local`）再 push
- DDIC 定义 CRUD：`pull <name> --type DOMA|DTEL|TABL|STRU`、`create <type> <name> --file <json>`、`push <name>.<type>.json`
- 推送后跑类看输出：`run ZCL_FOO`
- 看表数据：`select --table ZTAB`
- 业务码入口解析：`tcode <code>`

## 决策树（典型任务）

```
动一个 SAP 对象？
├── 已有 → search → 必要时 where-used 评估重构冲击 → pull → 编辑 → check syntax → push
│         ├── push 报 activated 但未真激活？→ inspect --activation → activate --yes
│         └── 多文件？→ push --atomic
├── 新建 → search 确认不存在 → create <type> <name> --package ... --tr ...
│         └── 离线草稿？→ create local → 编辑 → create ... --no-pull → push
└── 批量 → search --package → pull --package
    └── 链式？→ status → pull → push（sync 已移除）

DDIC 定义？
├── 拉 → pull <name> --type TABL|DOMA|DTEL|STRU
├── 改 → 编辑 <name>.<type>.json
└── 推 → push <name>.<type>.json --tr <tr>

对对象的只读消费（强对对象、不写、不锁）？
├── 表/视图数据 → select --table T --where "..." --limit N
│    ├── 部分列 → --fields
│    ├── 仅计数 → --count-only
│    └── 翻页 → --order-by "ID:ASC" --limit 20 --offset 40
├── 跑类 → run ZCL_FOO
│    ├── 直接 classrun → run ZCL_FOO
│    ├── 静态方法 → run ZCL_FOO --method compute --args '{...}'
│    └── 业务码 → 读 data.exitCode（不是 CLI exit code）
└── 业务码入口 → tcode <code>
```

## 推送前 checklist

`push` 是写操作。每次推送前：

1. **`check syntax`**：语法错会被激活拒绝
2. **transport 解析**：已绑定 / `$TMP` 无需 `--tr`；其余必填 `--tr` 或跳到 `abap-setup` 用 transport 解析脚本
3. **`--atomic`** 多文件必加：任一失败零写入
4. **`--dry-run`** 大改动前先看 plan
5. **`--json`**：解析信封，失败时看 `error.code`

## 错误恢复

### 写路径（search/pull/push/create/activate）

| 错误 | 动作 |
|---|---|
| `OBJECT_NOT_FOUND` (exit 8) | `search <name>` 校对；`push` 不自动创建（创建走 `create`） |
| `OBJECT_EXISTS` (exit 2) | 改用 `pull` + `push`；不要重复 `create` |
| `LOCK_FAILED` (exit 9) | `inspect <obj> --locks` 查持有者；SE03 手动释放 |
| `ACTIVATION_FAILED` (exit 7) | `data.errors` 含行号；修复后重推 |
| `SYNTAX_ERROR` (exit 7) | `data.errors[]` 含 `{line, offset, severity, text}` |
| `NO_TRANSPORT` (exit 7) | 跳到 `abap-setup` 的 `transport list` / `transport resolve` / `transport create` |
| `DDIC_NOT_SUPPORTED` (exit 7) | 类型不在白名单（DOMA/DTEL/TABL/STRU 之外）；看 `abap create --schema` |
| `FILE_EXISTS` (exit 2) | `pull --overwrite` 或 `--skip-existing` |
| `TYPE_NOT_SUPPORTED` (exit 7) | `abap <cmd> --schema` 看支持列表 |
| `PUSH_FAILED` (exit 7) | `data.stage` 指示失败环节（lock/write/activate） |
| `INACTIVE_PARTS` (exit 6) | `inspect --activation` 诊断 → `activate --yes` 修复 |
| `INVALID_ARGUMENT` (exit 2) | 看 `error.nextSteps` |

### 只读消费路径（select/run/tcode）

| 错误 | 动作 |
|---|---|
| `WRAPPER_NOT_DEPLOYED` (exit 8) | 跳到 `abap-setup` 的 `extension deploy --yes` 安装 `ZCL_ABAP_VIBE_RUNNER` |
| `WRAPPER_INPUT_UNAVAILABLE` (exit 6) | ADT classrun 不注入 `--method` 入参；改用直接 classrun 路径 |
| `METHOD_NOT_SUPPORTED` (exit 7) | 方法签名不可反射；改 wrapper 类签名 |
| `METHOD_FAILED` (exit 7) | 目标方法抛 `cx_root`；读 `data.parsed` 看异常 |
| `CLASS_NOT_RUNNABLE` (exit 7) | 类没实现 `if_oo_adt_classrun~main`；改用 `--method` 路径 |
| `OBJECT_NOT_ACTIVE` (exit 6) | 本 skill 直接 `activate <obj> --yes` |
| `LOCAL_CLASS_NOT_RUNNABLE` (exit 6) | 类名含 `~`（本地类）；用外部类 |
| `TIMEOUT` (exit 6) | `--timeout` 增大；或拆小循环 |
| `TABLE_NOT_FOUND` (exit 8) | `search <name>` 校对 |
| `TABLE_TYPE_NOT_SUPPORTED` (exit 7) | v1 仅 TABL+VIEW |
| `INVALID_FIELD` (exit 7) | `error.details.validFields` 取合法字段 |
| `INVALID_WHERE` (exit 7) | `error.details.offset` 指向解析失败位置 |
| `LIMIT_EXCEEDED` (exit 7) | `--limit` ∈ `[1, 10000]` |
| `OFFSET_EXCEEDED` (exit 7) | `--offset` ∈ `[0, 100000]` |
| `QUERY_FAILED` (exit 6) | 本 skill 直接 `activate <table>` |
| `AUTH_ERROR` (exit 5) | 跳到 `abap-setup` 的 `profile test` |
| `ICF_CHECK_DEGRADED` | warning（meta.warnings），不阻断 |
| `TCODE_NOT_FOUND` (exit 8) | 业务码不存在 |
| `TCODE_NOT_AUTHORIZED` (exit 5) | 用户无 `S_TCODE` 权限 |

## 注入安全（`select` 三层防线，必须严守）

1. **字段名白名单**：`--fields` / where / order-by 字段先对照 `DD03L` 校验并大写归一化
2. **值绑定**：where 值经解析后声明为 ABAP 变量，嵌入 `WHERE (lt_where)` 时以 `@lv_where_v1` 占位——**值永远不进 SQL 文本**
3. **整数边界**：`limit` / `offset` 由 JSON 解析后服务端 `CONV i` + 范围校验

注入载荷按字面值匹配或返回空集，**不**触发 SQL 注入。

## 通用规则

1. **永远 `--json`**：`status` / `error.code` 分支
2. **`check syntax` 默认对 SAP**：无副作用，可反复跑
3. **`--atomic` 防雪崩**：多文件必加
4. **`push` 报 activated 还要 `inspect --activation` 复核**：method/OSI 层级是 013 落地经验
5. **DDIC JSON 结构校验**：客户端走 `validateDdicObject`；命名空间 `Z`/`Y` 开头
6. **`select` 完全可放心反复调用**：不修改表数据、不产生传输请求、不加锁
7. **`run --method` 前先看 `extension status`**：若 `WRAPPER_NOT_DEPLOYED`，跳 `abap-setup` 部署
8. **`run` 业务退出码 vs CLI 退出码**：`data.exitCode` 是**业务退出码**（SAP 端写），CLI 退出码是命令本身状态——`jq '.data.exitCode'` 读业务码
9. **`select --count-only` 比 `select --limit 99999` 快**：只取 `COUNT(*)`
10. **跨 skill**：环境/连接/transport 切到 `abap-setup`（含 `extension deploy`）

## references（按需加载）

- [references/commands-quick.md](./references/commands-quick.md) — 13 命令完整速查
- [references/errors.md](./references/errors.md) — 错误码全表
- [references/workflow.md](./references/workflow.md) — 详细工作流（DDIC/FUGR/textpool/stale 激活/翻页/部署）
- 权威来源：
  - <https://github.com/SAP/abap-cli/blob/main/wiki/commands/pull.md>
  - <https://github.com/SAP/abap-cli/blob/main/wiki/commands/push.md>
  - <https://github.com/SAP/abap-cli/blob/main/wiki/commands/check.md>
  - <https://github.com/SAP/abap-cli/blob/main/wiki/commands/create.md>
  - <https://github.com/SAP/abap-cli/blob/main/wiki/commands/search.md>
  - <https://github.com/SAP/abap-cli/blob/main/wiki/commands/activate.md>
  - <https://github.com/SAP/abap-cli/blob/main/wiki/commands/select.md>
  - <https://github.com/SAP/abap-cli/blob/main/wiki/commands/run.md>
  - <https://github.com/SAP/abap-cli/blob/main/wiki/commands/tcode.md>
  - <https://github.com/SAP/abap-cli/blob/main/docs/commands.md>

## scripts / assets

- [scripts/pages-select.mjs](./scripts/pages-select.mjs) — 自动分页跑 `select`（>10000 行场景；Node 18+ 跨平台）
- [assets/.abapignore.template](./assets/.abapignore.template) — push --all 时跳过规则样板

> `validate-push.sh` / `inspect-activation.sh` 已删除——前者是 2 命令链、后者是 3 行 jq 分支，agent 可在 SKILL.md 错误恢复指引下按需现写。保留 `pages-select.mjs` 是因为其分页状态机（`offset += page_size` + `truncated` 跳出）agent 难以一次性拼对；用 `.mjs` 而非 `.sh` 是为了跨平台（macOS / Linux / Windows + WSL 一致）。
