# abap-cli-edit — 错误码全表

> 按需加载。本文件仅覆盖写路径错误码。

## 本 skill 错误码清单（6 命令范围）

| code | cat/exit | 触发命令 | 修复 |
|---|---|---|---|
| `OBJECT_NOT_FOUND` | NOT_FOUND/8 | pull / push / check / activate | `search <name>`（[abap-cli-search]）校对；`push` 不自动创建（创建走 `create`） |
| `OBJECT_EXISTS` | USAGE/2 | create | 改用 `pull` + `push`；不要重复 `create` |
| `LOCK_FAILED` | LOCKED/9 | push | `inspect <obj> --locks`（[abap-cli-search]）查持有者；SE03 手动释放 |
| `ACTIVATION_FAILED` | VALIDATION_ERROR/7 | push / create / activate | `data.errors` 含行号；修复后重推 |
| `SYNTAX_ERROR` | VALIDATION_ERROR/7 | check / push --check-only | `data.errors[]` 含 `{line, offset, severity, text}` |
| `NO_TRANSPORT` | VALIDATION_ERROR/7 | push / create | 跳 `abap-cli-setup`：`transport list` / `transport create` → `--tr` 重试 |
| `DDIC_NOT_SUPPORTED` | VALIDATION_ERROR/7 | pull / create / push | 类型不在白名单（DOMA/DTEL/TABL/STRU 之外）；看 `abap create --schema` |
| `TABL_DDL_INVALID` | VALIDATION_ERROR/7 | create TABL/STRU | 三件套的 `.tabl.ddic` / `.stru.ddic` 解析失败（缺 `define table|structure ... {` 或 `}`）；`error.message` 含 DDL 解析行；详见 [workflow.md 变体 2](workflow.md) |
| `FILE_EXISTS` | USAGE/2 | pull | `pull --overwrite` 或 `--skip-existing` |
| `TYPE_NOT_SUPPORTED` | VALIDATION_ERROR/7 | 任意 | `abap <cmd> --schema` 看支持列表 |
| `PUSH_FAILED` | VALIDATION_ERROR/7 | push | `data.stage` 指示失败环节（lock/write/activate/unlock） |
| `INACTIVE_PARTS` | SAP_ERROR/6 | inspect --activation | `activate --yes` 修复 |
| `REMOTE_VERSION_NOT_FOUND` | NOT_FOUND/8 | pull --remote | 对象未传到远程系统；改用普通 `pull` 拉本地 |
| `VERSION_DESTINATION_INVALID` | USAGE/2 | pull --remote | 系统 ID 非法；看 `--remote` 参数 |
| `INVALID_FIELD` / `MISSING_FIELD` | VALIDATION_ERROR/7 | push（DDIC JSON 写） | DDIC 结构校验失败；看 `error.details` |
| `INVALID_ARGUMENT` | USAGE/2 | 任意 | 看 `error.nextSteps` / `error.references` |
| `USAGE` | USAGE/2 | 任意 | 缺必填参数；看 `error.nextSteps` |

## push 失败环节（`data.stage`）

| stage | 含义 | 典型错误 |
|---|---|---|
| `lock` | 获取编辑锁 | `LOCK_FAILED` |
| `write` | 写源码 | `SAP_ERROR` |
| `check` | 语法检查 | `SYNTAX_ERROR` |
| `activate` | 激活 | `ACTIVATION_FAILED` |
| `unlock` | 释放锁 | `UNLOCK_WARNING`（仅 `meta.warnings`，exit 0） |
| `ddic-icf` | DDIC JSON 写 | `INVALID_FIELD` / `MISSING_FIELD` |
| `textpool-adt` / `textpool-icf` | textpool 写 | 视 mode 而定 |

## 写操作保护（P0.3）

`push` / `create` / `activate` 是写操作：

- **非 TTY**：必须 `--yes` 或 `--dry-run`，否则 `VALIDATION_ERROR` (exit 7)
- **`--dry-run`**：返回 `{ dryRun: true, ... }` 不调 SAP
- **`--atomic`** 多文件：先全量校验，任一失败零写入

## JSON 输出契约参考

- 契约规范：见本仓库 `wiki/json-generation.md`（POSIX 路径是该契约的一部分）