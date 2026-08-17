# abap-data — 错误码全表

> 按需加载。

## run

| code | cat/exit | 触发 | 修复 |
|---|---|---|---|
| `METHOD_FAILED` | VALIDATION_ERROR/7 | 目标方法抛 `cx_root` | 读 `data.parsed` 看异常 |
| `METHOD_NOT_SUPPORTED` | VALIDATION_ERROR/7 | 方法签名不可反射（CHANGING/TABLES/instance/private/deep） | 改 wrapper 类签名 |
| `CLASS_NOT_RUNNABLE` | VALIDATION_ERROR/7 | 类没实现 `if_oo_adt_classrun~main` | 改用 `--method` 路径 |
| `OBJECT_NOT_ACTIVE` | SAP_ERROR/6 | 类未激活 | 用 abap-edit 的 `activate <obj> --yes` |
| `LOCAL_CLASS_NOT_RUNNABLE` | SAP_ERROR/6 | 类名含 `~`（本地类） | 用外部类 |
| `TIMEOUT` | SAP_ERROR/6 | classrun 超时 | `--timeout` 增大；或拆小循环 |
| `WRAPPER_NOT_DEPLOYED` | NOT_FOUND/8 | `ZCL_ABAP_VIBE_RUNNER` 缺失 | `abap extension deploy --yes` |
| `WRAPPER_INPUT_UNAVAILABLE` | SAP_ERROR/6 | ADT classrun 不注入 `--method` 入参 | 改用直接 classrun |

## select

| code | cat/exit | 触发 | 修复 |
|---|---|---|---|
| `TABLE_NOT_FOUND` | NOT_FOUND/8 | 表/视图不存在 | `search <name>` 校对 |
| `TABLE_TYPE_NOT_SUPPORTED` | VALIDATION_ERROR/7 | 非 TABL/VIEW（pool/cluster/结构/表类型） | v1 仅 TABL+VIEW |
| `INVALID_FIELD` | VALIDATION_ERROR/7 | 字段不在表内 / 显式大对象投影 | `error.details.validFields` 取合法字段 |
| `INVALID_WHERE` | VALIDATION_ERROR/7 | where 语法/字段/操作符/类型/MANDT 违规 | `error.details.offset` 指向解析失败位置 |
| `LIMIT_EXCEEDED` | VALIDATION_ERROR/7 | `--limit > 10000` 或非整数 | `--limit` ∈ `[1, 10000]` |
| `OFFSET_EXCEEDED` | VALIDATION_ERROR/7 | `--offset > 100000` 或非整数 | `--offset` ∈ `[0, 100000]` |
| `QUERY_FAILED` | SAP_ERROR/6 | 动态 SQL 运行时异常 | 用 abap-edit 的 `activate <table>` |
| `AUTH_ERROR` | AUTH_ERROR/5 | 连接用户无该表读取权限 | 检查用户权限分配（S_TABU_DIS） |

## deploy

| code | cat/exit | 触发 | 修复 |
|---|---|---|---|
| `OBJECT_EXISTS` | USAGE/2 | `--atomic` 推送已存在对象 | 加 `--overwrite`（如支持） |
| `ACTIVATION_FAILED` | VALIDATION_ERROR/7 | ICF handler 激活失败 | 复检：`inspect <obj> --activation` → `activate --yes` |
| `SAP_ERROR` | SAP_ERROR/6 | SAP 端 deploy 失败 | 看 `data.objects[]` 哪个失败 |
| `ICF_CHECK_DEGRADED` | warning（meta.warnings） | ICF 部署健康探测不可达 | 不阻断；查 SAP 端 `/sap/zabap_vibe/` 是否可达 |

## 完整 012 契约参考

- <https://github.com/SAP/abap-cli/blob/main/docs/commands.md#json-output-contract>
- <https://github.com/SAP/abap-cli/blob/main/specs/012-unify-cli-output-contract/contracts/cli-output.md>