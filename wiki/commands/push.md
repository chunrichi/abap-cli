---
type: command
title: abap push
description: 推送本地 ABAP 文件到 SAP — lock → set source → syntax check → activate → unlock，支持源码对象、FUGR、textpool 与 DDIC JSON，按对象解析 transport
tags: [abap-cli, command, push, upload, abap-file-format, ddic, textpool, transport]
created at: 2026-08-07 00:11:03
changed at: 2026-09-03 00:00:00
---

# abap push

把本地 ABAP 文件推送到 SAP 系统，核心流程是 **lock → set source → syntax check → activate → unlock**。支持四类文件：普通源码对象（CLAS/PROG/INTF）、FUGR 子对象、textpool `.properties`、以及 DDIC `.json`（014）。文件级编排在 `flows/push-flow.ts`（`runPush`），单对象核心在 `flows/push-object.ts`（`pushObject`）。

## Usage

```bash
abap push [options] [files...]
```

## Options

- `[files...]`: 要推送的文件路径（一个或多个）
- `--all`: 推送扫描根下所有 `.abap` 文件（遵循 `.abapignore`）——扫描根为 `.abap.json::sourceDir`（配置了时，相对配置文件所在目录解析），否则为当前工作目录；不遵循 `<name>.<type>.abap|xml` 布局的杂散文件会被跳过（显式 `[files...]` 路径永不跳过）
- `--tr <transport>`: 传输请求号（按对象解析，见下文；多数场景不再必输）
- `--check-only`: 只做语法检查不激活（与 `--no-activate` 互斥）
- `--no-activate`: lock + write + 跳过 check + 跳过 activate + unlock
- `--dry-run`: 只记录计划，零变更 ADT 调用
- `--fail-fast`: 第一个失败文件即停（默认 keep-going）
- `--schema`: 打印本命令参数 schema（unified envelope，无 SAP 调用；`data` 即 schema 对象）
- `--atomic`: 先结构校验所有文件，任一失败则零写入（`VALIDATION_ERROR`）
- `--yes`: 非交互确认写操作；非 TTY 且无 `--yes`/`--dry-run` → `VALIDATION_ERROR`（exit 7）

无 `[files...]` 且无 `--all` 时抛 `USAGE`（exit 2）。`--check-only` 与 `--no-activate` 同时给时抛 `USAGE`（exit 2）。

## 按对象 transport 解析（核心设计）

`runPush` **不再**在顶层统一解析一个 transport；改为 `pushOne` 拿到对象后逐对象解析（`resolveObjectTransport`）：

1. **对象已绑定请求**（`client.transportInfo(objectUrl)` → `TRANSPORTS[0].TRKORR`）— 直接复用该请求，**无需 `--tr`**；若显式传了不同的 `--tr` → 抛 `VALIDATION_ERROR`（exit 7），提示去掉 `--tr` 或先用 `abap transport assign` 换请求。push 不允许顺手改对象的请求归属。
2. **`$TMP` 对象**（search 命中 `adtcore:packageName === '$TMP'`，经 `ResolvedObject.packageName` 携带）— transport-free，空 transport 推送，无需 `--tr`（与 `abap extension deploy` 的 `$TMP` 规则一致）。显式传了非空 `--tr` → **告警 + 忽略**（`meta.warnings` 的 `PUSH_TR_IGNORED_TMP`，exit 不变），不会真的绑定到任何请求。
3. 其余未绑定非 `$TMP` 对象：`--tr` > 项目 config `transport` > 用户第一个可修改请求（`userTransports`）> `NO_TRANSPORT`（exit 7）。

`--dry-run` 不查真实请求，用 `--tr` > config > `'DRY_RUN'` 占位。每文件 JSON 结果带该文件实际解析到的 `transport`。

## push 只更新已存在对象（035 设计收敛）

push 是「把本地文件写进 SAP 的**已存在**对象」，不是创建入口。创建走 `abap create`（`--package` + `--tr`），改归属走 `abap transport assign`（独立 link），push 不承担这两者：

- **ADT 源对象**（CLAS/INTF/PROG/FUGR）：对象不存在 → `OBJECT_NOT_FOUND`，`nextSteps` 引导 `abap create`（不自动创建）。
- **DDIC**（DOMA/DTEL/TABL/STRU）与 **TRAN**：push 前先 ICF GET 探测存在性（`GET /ddic/<type>/<name>` / `GET /tran/<code>`，与 pull 同一端点）。对象不存在 → `OBJECT_NOT_FOUND`（`nextSteps` 引导 `abap create <TYPE> <name> --file ...`），**不再**让 ICF POST 隐式 upsert 创建。
- **HTTP**（SICF 节点）：**明确例外，保留 push 即创建**。`create HTTP`（无 `--file`）只落本地骨架（`action: local`，不调 SAP），真正在 SAP 建 SICF 节点靠 `abap push`。若把 HTTP push 限为「必须已存在」会破坏该骨架工作流，故 HTTP 不做存在性探测。

DDIC/TRAN 的探测在 `--dry-run` 之后（plan-only 不做多余 round-trip）；探测的 not-found 之外的错误（网络/权限）按原错误码传播。

## 对象路由（`pushOne`）

按 `resolveFile` 的 `route` 分派：

| 路由 | 入口 | 行为 |
|------|------|------|
| 普通源码（adt） | `pushObject` | 锁对象 → 写每个 part 源码 → check/activate → 解锁（`finally` 保证） |
| FUGR | `push-fugr.ts` | 子对象（FM/include）是独立 ADT 锁对象，逐文件锁自己的目标、写源，最后激活整个 function group |
| Textpool | `push-textpool.ts` | 混合模式：profile 缓存能力决定走 ADT `setTextElements`（lock→write→unlock）还是 ICF `/textpool/*`；`--check-only` 不支持（`VALIDATION_ERROR`） |
| DDIC（icf） | `pushDdicFile` | `.doma/.dtel/.tabl/.stru.json` 经 ICF `POST /ddic/<type>`（与 `abap create --file` 同一端点）；结果 `written` / stage `ddic-icf`；`--check-only` 不支持；transport 缺省时回退文件里记录的 `transportRequest` |
| TTYP / MSAG / DDLS（通道路由） | `pushChannelRoutedFile` | 见下节 |

DDIC 推送时 `--atomic` 也会结构校验 JSON（`readDdicJson` + `validateDdicObject`），不是只读文本。

### 新增 TTYP / MSAG / DDLS（双通道）

这三类的扩展名同样是 `.json`，但**在 DDIC 分支之前**被拦截——它们先经 `flows/edit/channel-detect.ts` 判定通道，再走各自的 `push-{ttyp,msag,ddls}.ts`：

| 类型 | 主通道（kernel ≥ 753） | 兜底（kernel < 753） | stage |
|---|---|---|---|
| TTYP | ADT PUT `/sap/bc/adt/ddic/tabletypes/<name>`（lock → PUT → unlock） | ICF PUT `/ddic/ttyp/<name>` | `channel-adt` / `channel-icf` |
| MSAG | ADT PUT `/sap/bc/adt/messageclass/<name>`（lock → PUT → unlock） | ICF PUT `/ddic/msag/<name>` | `channel-adt` / `channel-icf` |
| DDLS | ADT PUT `/sap/bc/adt/ddic/ddl/sources/<name>` | **无兜底** → 硬错 | `channel-adt` |

`--atomic` 阶段对这三类走各自的 `validate{Ttyp,Msag,Ddls}Object`（AFF schema），而不是 `readDdicJson`。

沿用 035 语义：对象不存在时报 `OBJECT_NOT_FOUND` 并提示改用 `abap create`，push **绝不隐式创建**。

错误码映射：

| 错误码 | exit | 触发条件 |
|---|---|---|
| `DDLS_NOT_SUPPORTED_ON_ECC` | 64 | DDLS + 旧内核；不发起任何 SAP 调用 |
| `CHANNEL_DETECTION_FAILED` | 65 | system profile 缺 `kernelRelease` 且缺 `ddlsSupported` |
| `OBJECT_NOT_FOUND` | 8 | 对象不存在（引导 `abap create`） |
| `LOCK_FAILED` | 9 | ICF 兜底写路径拿不到 enqueue 锁（ICF handler 的错误码原样透传） |
| `VALIDATION_ERROR` | 7 | DDLS 缺 `.ddls.acds`，或 `sourceType` 与 `.acds` 顶部 `define` 不一致 |
| `AFF_FIXTURE_INVALID` | 7 | push 前 AFF schema 校验失败 |

### 支持的文件类型

按 [file-resolver.ts](../../src/abap_cli/formats/file-resolver.ts) 的文件名解析规则，push 可处理的文件：

| 文件 | 路由 | 说明 |
|------|------|------|
| `zcl_foo.clas.abap` / `.clas.definitions.abap` / `.clas.implementations.abap` / `.clas.macros.abap` / `.clas.testclasses.abap` | adt | 类及各类 include part，按 subtype 精确匹配对象的 include |
| `zif_foo.intf.abap` / `.intf.definitions.abap` / `.intf.implementations.abap` | adt | 接口及各 part |
| `zprog.prog.abap` | adt | 程序 main |
| `zfg.fugr.abap` / `.fugr.sapl<name>.reps.abap` / `.fugr.l<name>top.reps.abap` / `.fugr.<fm>.func.abap` | adt | 函数组（含 include 与 FM 子对象，各自独立加锁） |
| `zmy_table.tabl.json` / `.doma.json` / `.dtel.json` / `.stru.json` | icf | 四种 DDIC 对象 |
| `zmy_ttyp.ttyp.json` / `zmy_msag.msag.json` / `zmy_view.ddls.json` | 通道路由 | 036 三类型，`channel-detect` 决定 ADT / ICF |
| `zprog.prog.texts.en.properties`（`texts`/`selections`/`headings`） | textpool | 文本元素，混合模式路由 |

**不支持的**：`.clas.json` 等源码对象的元数据 JSON — 被解析为 route `icf` 但对象类型既不在四种 DDIC 之内、也不是 036 的三类型，`validateLocalFile` 抛 `DDIC_NOT_SUPPORTED`（exit 7）。源码对象的创建/更新走 `abap create`，不是 push。

**目录约定（与 pull / create local 对齐）**：push 路径上的目录层级（`src/<typeFolder>/<objectName>/...`）仅作约定，不影响路由与解析——`file-resolver.ts#resolveFile` 只看 `path.basename`。pull / create local 默认把产物放到对应类型的顶层子目录下（`src/clas/`、`src/prog/`、`src/intf/`、`src/fugr/`、`src/tabl/`、`src/doma/`、`src/stru/`、`src/dtel/`），push 沿用同一目录读 basename 即可；推老路径（裸 `src/<name>.<type>.abap`）也仍然能正常解析并推送。

**part 精确匹配**：`.clas.macros.abap` 只有在对象确实有 `macros` include 时才推送；对象没有该 include 时**报错**（`SAP_ERROR`，exit 6，`nextSteps` 指引 `abap inspect <obj> --includes`），不会静默回退把 macros 内容写进 main。只有 `main` 文件映射到对象的 main part。

## 失败处理

| 场景 | 错误码 | 类别 / exit | 附带信息 |
|------|--------|-------------|----------|
| 对象被他人锁定 | `LOCK_FAILED` | LOCKED / 9 | `nextSteps`：`abap inspect <obj> --locks` 查锁 + SE03 手动释放；FUGR 额外带 `subtype` |
| 对象不存在（ADT 源对象 / DDIC / TRAN） | `OBJECT_NOT_FOUND` | NOT_FOUND / 8 | `nextSteps`：`abap search <name>` 验证；**引导 `abap create <TYPE> <name> --file <path> --package ... --tr ...`**。push 不自动创建（创建走 `abap create`；HTTP 例外——push 会创建 SICF 节点） |
| 命名的 include part 不存在（如 `.macros.abap` 而对象无 macros） | `SAP_ERROR` | SAP_ERROR / 6 | `subtype` + `nextSteps`：`abap inspect <obj> --includes` 列出可用 include |
| 激活失败 | `ACTIVATION_FAILED` | VALIDATION_ERROR / 7 | `stage: 'activate'` + 原始 `detail` |
| 写源码失败 | `SAP_ERROR` | SAP_ERROR / 6 | `stage: 'write'` + `subtype` |
| 语法检查失败（`--check-only`） | `SYNTAX_ERROR` | VALIDATION_ERROR / 7 | `errors` 数组（`{line, offset, severity, text, uri}`，仅 `E`） |
| 无可用 transport | `NO_TRANSPORT` | VALIDATION_ERROR / 7 | 提示 `--tr` 或 `abap transport create` |

**收尾保证**：lock 在任何路径（成功 / check-only / write-only / 激活失败）都会在 `finally` 释放；释放失败不报错，降级为 `UNLOCK_WARNING`（`meta.warnings`，exit 不变）。

**按文件隔离**：每个文件独立 try/catch，失败进 `results`（`status: 'failed'` + `code`/`stage`/`message`/`nextSteps`），不中断其他文件（默认 keep-going）；`--fail-fast` 可选提前停。聚合错误以首个失败文件的错误码作为聚合 `code`；**单文件失败时透出原始 `message` 与 `nextSteps`**（不再笼统 "N file(s) failed"），多文件时给通用指引。

**写保护**：与 `create` / `transport create|assign` / `extension deploy` 共用 `core/confirmation.ts#requireWriteConfirmation`，非 TTY 必须 `--yes` 或 `--dry-run`，否则 `VALIDATION_ERROR`（exit 7）并附 `nextSteps` + `example`（如 `abap push <files...> --tr <transport> --yes`）。

## Examples

```bash
# 推送单个文件（对象已绑定请求或 $TMP 时无需 --tr）
abap push src/clas/zcl_my_class/zcl_my_class.clas.abap --yes

# 显式指定 transport
abap push src/prog/zprog/zprog.prog.abap --tr NDK123456 --yes

# 只做语法检查
abap push src/clas/zcl_foo/zcl_foo.clas.abap --tr NDK123456 --check-only

# 只写不激活
abap push src/clas/zcl_foo/zcl_foo.clas.abap --tr NDK123456 --no-activate

# 推送整个目录（遵循 .abapignore）
abap push --all --tr NDK123456

# 计划模式（零变更）
abap push src/clas/zcl_foo/zcl_foo.clas.abap --tr NDK123456 --dry-run

# 原子推送：任一文件校验失败则零写入
abap push src/clas/a.clas.abap src/clas/b.clas.abap --tr NDK123456 --atomic

# 推送 DDIC 对象（$TMP 无需 --tr）
abap push src/tabl/ztest_e2e.tabl.json

# 推送 TABL 三件套：main 即可；同目录 .tabl.ddic / .tabl.settings.json 自动一起推
abap push src/tabl/zthree.tabl.json --tr NDK900001 --yes
# 等价于：abap push src/tabl/zthree.tabl.json src/tabl/zthree.tabl.ddic src/tabl/zthree.tabl.settings.json --tr NDK900001 --yes

# 推送 textpool
abap push src/prog/zprog/zprog.prog.texts.en.properties
```

## Expected Output

```json
{
  "status": "success",
  "meta": {
    "command": "abap push",
    "version": "0.2.0",
    "timestamp": "2026-08-07T00:11:03.000Z",
    "durationMs": 111,
    "warnings": []
  },
  "data": {
    "results": [
      {
        "file": "src/prog/zprog/zprog.prog.abap",
        "status": "activated",
        "transport": "NDK123456",
        "stage": "unlock"
      }
    ],
    "failed": 0
  }
}
```

每文件 `status`：`activated`（默认全流程）/ `checked-only`（`--check-only`）/ `written`（`--no-activate` 或 DDIC）/ `dry-run`（`--dry-run`，含 `plan` 数组）/ `failed`。`stage` 取值：`lock`/`write`/`check`/`activate`/`unlock`/`read`/`textpool-adt`/`textpool-icf`/`ddic-icf`。

失败时错误 envelope（单文件透出原始 message）：

```json
{
  "status": "error",
  "meta": { "command": "abap push", "version": "0.2.0" },
  "error": {
    "code": "LOCK_FAILED",
    "category": "LOCKED",
    "message": "Cannot lock ZCL_TR: Object ZCL_TR is locked by user OTHER",
    "details": { "results": [{ "file": "src/clas/zcl_tr.clas.abap", "status": "failed", "code": "LOCK_FAILED", "nextSteps": ["Check who holds the lock: abap inspect ZCL_TR --locks", "Wait for the lock to be released, or release it manually in SE03."] }] }
  }
}
```

# More

## fixme

- [ ] **B** — `src/abap_cli/commands/push.ts` 的 `--tr` help 文案仍写 "required in non-TTY mode"，与新的按对象解析行为不符（已绑定请求或 `$TMP` 对象不再必输）。应改为描述解析规则。
- [ ] **C** — textpool 的 ADT 路由在 lock 失败时走通用 HTTP 分类（`SAP_ERROR`），不是精确的 `LOCK_FAILED`（无 `inspect --locks` 指引）。与源码对象/FUGR 的锁错误体验不一致。

## todo

- [x] **DDIC/TRAN push 前校验对象是否已存在** — 已实现（035）：`pushDdicFile` / `pushTranFile` 在 POST 前 ICF GET 探测，不存在 → `OBJECT_NOT_FOUND` 引导 `abap create`，不再让 ICF upsert 隐式创建；HTTP 例外保留 push 即创建（SICF 骨架工作流）。
- [ ] **多文件失败聚合的 `nextSteps`** — 多文件失败目前给通用指引（看 `code`/`stage`、keep-going/--fail-fast）；可考虑按失败类别（LOCK_FAILED / ACTIVATION_FAILED / NO_TRANSPORT）分组聚合更具体的下一步。
- [ ] **不可编辑态分类** — 非 `$TMP` 对象因 tr 已 release（游离）而不可编辑时，lock/写失败的错误签名尚未与「他人持锁」区分（FR-2，需真实 SAP 验证）；目标：游离 → 引导 `abap transport assign <obj> --tr <new>`。

# references

- 实现：`src/abap_cli/commands/push.ts`、`src/abap_cli/flows/push-flow.ts`（`runPush`/`pushOne`/`resolveObjectTransport`/`pushDdicFile`）、`push-object.ts`、`push-fugr.ts`、`push-textpool.ts`、`src/abap_cli/core/confirmation.ts`
- transport 解析：`src/abap_cli/core/transport.ts`（`resolveTransport`）、`src/abap_cli/core/resolve.ts`（`ResolvedObject.packageName`）
- SAP 后端：`abap/src/clas/zcl_abap_vibe_icf.clas.abap`（`dispatch_ddic` / `dispatch_textpool`）
- 文档：`docs/commands.md`（`abap push` 一节）、`docs/configuration.md`（Transport Resolution Order）
