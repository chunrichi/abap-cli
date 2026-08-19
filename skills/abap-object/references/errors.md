# abap-object — 错误码全表

> 按需加载。

## 写路径 — search/pull/push/create/activate/check/inspect/diff/status/create local/where-used

| code | cat/exit | 触发命令 | 修复 |
|---|---|---|---|
| `OBJECT_NOT_FOUND` | NOT_FOUND/8 | search / pull / push / inspect / activate / check | `search <name>` 校对；`push` 不自动创建（创建走 `create`） |
| `OBJECT_EXISTS` | USAGE/2 | create | 改用 `pull` + `push`；不要重复 `create` |
| `LOCK_FAILED` | LOCKED/9 | push | `inspect <obj> --locks` 查持有者；SE03 手动释放 |
| `ACTIVATION_FAILED` | VALIDATION_ERROR/7 | push / create / activate | `data.errors` 含行号；修复后重推 |
| `SYNTAX_ERROR` | VALIDATION_ERROR/7 | check / push --check-only | `data.errors[]` 含 `{line, offset, severity, text}` |
| `NO_TRANSPORT` | VALIDATION_ERROR/7 | push / create | 跳到 `abap-setup`：`transport list` / `transport create` → `--tr` 重试 |
| `DDIC_NOT_SUPPORTED` | VALIDATION_ERROR/7 | pull / create / push | 类型不在白名单（DOMA/DTEL/TABL/STRU 之外）；看 `abap create --schema` |
| `FILE_EXISTS` | USAGE/2 | pull | `pull --overwrite` 或 `--skip-existing` |
| `TYPE_NOT_SUPPORTED` | VALIDATION_ERROR/7 | 任意 | `abap <cmd> --schema` 看支持列表 |
| `PUSH_FAILED` | VALIDATION_ERROR/7 | push | `data.stage` 指示失败环节（lock/write/activate/unlock） |
| `INACTIVE_PARTS` | SAP_ERROR/6 | inspect --activation | `activate --yes` 修复 |
| `REMOTE_VERSION_NOT_FOUND` | NOT_FOUND/8 | pull --remote | 对象未传到远程系统；改用普通 `pull` 拉本地 |
| `VERSION_DESTINATION_INVALID` | USAGE/2 | pull --remote | 系统 ID 非法；看 `--remote` 参数 |
| `OBJECT_NOT_INDEXED` | SAP_ERROR/6 | where-used | 暂时无索引；改用 `search <obj>` + `pull` 看代码 |
| `USAGE` / `INVALID_ARGUMENT` | USAGE/2 | 任意 | 看 `error.nextSteps` 或 `abap <cmd> --help` |

## push 失败环节（`data.stage`）

| stage | 含义 | 典型错误 |
|---|---|---|
| `lock` | 获取编辑锁 | `LOCK_FAILED` |
| `write` | 写源码 | `SAP_ERROR` |
| `check` | 语法检查 | `SYNTAX_ERROR` |
| `activate` | 激活 | `ACTIVATION_FAILED` |
| `unlock` | 释放锁 | `UNLOCK_WARNING`（仅 meta.warnings，不阻断） |
| `ddic-icf` | DDIC JSON 写 | `INVALID_FIELD` / `MISSING_FIELD` |
| `textpool-adt` / `textpool-icf` | textpool 写 | 视 mode 而定 |

`UNLOCK_WARNING` 仅在 `meta.warnings`，exit 仍 0——锁释放失败不影响推送结果。

## 只读消费路径 — run / select / tcode

### run

| code | cat/exit | 触发 | 修复 |
|---|---|---|---|
| `METHOD_FAILED` | VALIDATION_ERROR/7 | 目标方法抛 `cx_root` | 读 `data.parsed` 看异常 |
| `METHOD_NOT_SUPPORTED` | VALIDATION_ERROR/7 | 方法签名不可反射（CHANGING/TABLES/instance/private/deep） | 改 wrapper 类签名 |
| `CLASS_NOT_RUNNABLE` | VALIDATION_ERROR/7 | 类没实现 `if_oo_adt_classrun~main` | 改用 `--method` 路径 |
| `OBJECT_NOT_ACTIVE` | SAP_ERROR/6 | 类未激活 | 本 skill `activate <obj> --yes` |
| `LOCAL_CLASS_NOT_RUNNABLE` | SAP_ERROR/6 | 类名含 `~`（本地类） | 用外部类 |
| `TIMEOUT` | SAP_ERROR/6 | classrun 超时 | `--timeout` 增大；或拆小循环 |
| `WRAPPER_NOT_DEPLOYED` | NOT_FOUND/8 | `ZCL_ABAP_VIBE_RUNNER` 缺失 | 跳 `abap-setup`：`extension deploy --yes` |
| `WRAPPER_INPUT_UNAVAILABLE` | SAP_ERROR/6 | ADT classrun 不注入 `--method` 入参 | 改用直接 classrun |

### select

| code | cat/exit | 触发 | 修复 |
|---|---|---|---|
| `TABLE_NOT_FOUND` | NOT_FOUND/8 | 表/视图不存在 | `search <name>` 校对 |
| `TABLE_TYPE_NOT_SUPPORTED` | VALIDATION_ERROR/7 | 非 TABL/VIEW（pool/cluster/结构/表类型） | v1 仅 TABL+VIEW |
| `INVALID_FIELD` | VALIDATION_ERROR/7 | 字段不在表内 / 显式大对象投影 | `error.details.validFields` 取合法字段 |
| `INVALID_WHERE` | VALIDATION_ERROR/7 | where 语法/字段/操作符/类型/MANDT 违规 | `error.details.offset` 指向解析失败位置 |
| `LIMIT_EXCEEDED` | VALIDATION_ERROR/7 | `--limit > 10000` 或非整数 | `--limit` ∈ `[1, 10000]` |
| `OFFSET_EXCEEDED` | VALIDATION_ERROR/7 | `--offset > 100000` 或非整数 | `--offset` ∈ `[0, 100000]` |
| `QUERY_FAILED` | SAP_ERROR/6 | 动态 SQL 运行时异常 | 本 skill `activate <table>` |
| `AUTH_ERROR` | AUTH_ERROR/5 | 连接用户无该表读取权限 | 跳 `abap-setup`：`profile test`；检查 S_TABU_DIS |

### tcode

| code | cat/exit | 触发 | 修复 |
|---|---|---|---|
| `TCODE_NOT_FOUND` | NOT_FOUND/8 | 业务码未在 TSTC | 校对拼写；用 `search <code>` |
| `TCODE_NOT_AUTHORIZED` | AUTH_ERROR/5 | 用户无 `S_TCODE` | 换有权限用户；申请权限 |
| `SAP_ERROR` | SAP_ERROR/6 | ICF 端未知错码 / 响应缺字段 | `extension deploy` 升级；`doctor` 查连接 |

## 写操作保护（P0.3）

`push` / `create` / `activate`（本 skill 涉及的）是写操作：

- **非 TTY**：必须 `--yes` 或 `--dry-run`，否则 `VALIDATION_ERROR` (exit 7)
- **`--dry-run`**：返回 `{ dryRun: true, ... }` 不调 SAP
- **`--atomic`** 多文件：先全量校验，任一失败零写入

## 完整 012 契约参考

- <https://github.com/SAP/abap-cli/blob/main/docs/commands.md#json-output-contract>
- <https://github.com/SAP/abap-cli/blob/main/specs/012-unify-cli-output-contract/contracts/cli-output.md>
