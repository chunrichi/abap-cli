# abap-edit — 错误码全表

> 按需加载。

## 本 skill 错误码（11 命令范围）

| code | cat/exit | 触发命令 | 修复 |
|---|---|---|---|
| `OBJECT_NOT_FOUND` | NOT_FOUND/8 | search / pull / push / inspect / activate / check | `search <name>` 校对；`push` 不自动创建（创建走 `create`） |
| `OBJECT_EXISTS` | USAGE/2 | create | 改用 `pull` + `push`；不要重复 `create` |
| `LOCK_FAILED` | LOCKED/9 | push | `inspect <obj> --locks` 查持有者；SE03 手动释放 |
| `ACTIVATION_FAILED` | VALIDATION_ERROR/7 | push / create / activate | `data.errors` 含行号；修复后重推 |
| `SYNTAX_ERROR` | VALIDATION_ERROR/7 | check / push --check-only | `data.errors[]` 含 `{line, offset, severity, text}` |
| `NO_TRANSPORT` | VALIDATION_ERROR/7 | push / create / sync | `transport create "..."` 后 `--tr` 重试（用 abap-setup 的 resolve-transport.sh） |
| `DDIC_NOT_SUPPORTED` | VALIDATION_ERROR/7 | pull / create / push | 类型不在白名单（DOMA/DTEL/TABL/STRU 之外）；看 `abap create --schema` |
| `FILE_EXISTS` | USAGE/2 | pull | `pull --overwrite` 或 `--skip-existing` |
| `TYPE_NOT_SUPPORTED` | VALIDATION_ERROR/7 | 任意 | `abap <cmd> --schema` 看支持列表 |
| `PUSH_FAILED` | VALIDATION_ERROR/7 | push | `data.stage` 指示失败环节（lock/write/activate/unlock） |
| `INACTIVE_PARTS` | SAP_ERROR/6 | inspect --activation | `activate --yes` 修复 |
| `REMOTE_VERSION_NOT_FOUND` | NOT_FOUND/8 | pull --remote | 对象未传到远程系统；改用普通 `pull` 拉本地 |
| `VERSION_DESTINATION_INVALID` | USAGE/2 | pull --remote | 系统 ID 非法；看 `--remote` 参数 |
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

## 写操作保护（P0.3）

`push` / `create` / `sync` / `transport`（本 skill 涉及的）是写操作：

- **非 TTY**：必须 `--yes` 或 `--dry-run`，否则 `VALIDATION_ERROR` (exit 7)
- **`--dry-run`**：返回 `{ dryRun: true, ... }` 不调 SAP
- **`--atomic`** 多文件：先全量校验，任一失败零写入

## 完整 012 契约参考

- <https://github.com/SAP/abap-cli/blob/main/docs/commands.md#json-output-contract>
- <https://github.com/SAP/abap-cli/blob/main/specs/012-unify-cli-output-contract/contracts/cli-output.md>