# abap-cli-data — 错误码全表

> 按需加载。本文件仅覆盖运行时消费错误码。

## 本 skill 错误码清单（2 命令范围）

### run

| code | cat/exit | 触发 | 修复 |
|---|---|---|---|
| `WRAPPER_NOT_DEPLOYED` | NOT_FOUND/8 | run --method 缺失 wrapper | 跳 `abap-cli-setup`：`extension deploy --yes` 安装 `ZCL_ABAP_VIBE_RUNNER` |
| `WRAPPER_INPUT_UNAVAILABLE` | SAP_ERROR/6 | run --method（ADT classrun 不注入） | 改用直接 classrun 路径 |
| `METHOD_NOT_SUPPORTED` | VALIDATION_ERROR/7 | run --method（签名不可反射） | 改 wrapper 类签名（避免 CHANGING/TABLES/instance/private/deep） |
| `METHOD_FAILED` | VALIDATION_ERROR/7 | run（目标方法抛 `cx_root`） | 读 `data.parsed` 看异常 |
| `CLASS_NOT_RUNNABLE` | VALIDATION_ERROR/7 | run（类未实现 `if_oo_adt_classrun~main`） | 改用 `--method` 路径 |
| `OBJECT_NOT_ACTIVE` | SAP_ERROR/6 | run（类未激活） | 本 skill 直接 `activate <obj> --yes`（[abap-cli-edit]） |
| `LOCAL_CLASS_NOT_RUNNABLE` | SAP_ERROR/6 | run（类名含 `~`） | 用外部类 |
| `TIMEOUT` | SAP_ERROR/6 | run（classrun 超时） | `--timeout` 增大；或拆小循环 |
| `INVALID_ARGUMENT` | USAGE/2 | run | 看 `error.nextSteps` |

### select

| code | cat/exit | 触发 | 修复 |
|---|---|---|---|
| `TABLE_NOT_FOUND` | NOT_FOUND/8 | select | `search <name>`（[abap-cli-search]）校对 |
| `TABLE_TYPE_NOT_SUPPORTED` | VALIDATION_ERROR/7 | select | v1 仅 TABL+VIEW；pool/cluster/结构/表类型不支持 |
| `INVALID_FIELD` | VALIDATION_ERROR/7 | select | `error.details.validFields` 取合法字段 |
| `INVALID_WHERE` | VALIDATION_ERROR/7 | select | `error.details.offset` 指向解析失败位置 |
| `LIMIT_EXCEEDED` | VALIDATION_ERROR/7 | select | `--limit` ∈ `[1, 10000]` |
| `OFFSET_EXCEEDED` | VALIDATION_ERROR/7 | select | `--offset` ∈ `[0, 100000]` |
| `QUERY_FAILED` | SAP_ERROR/6 | select（动态 SQL 运行时异常） | 本 skill 直接 `activate <table>`（[abap-cli-edit]） |
| `AUTH_ERROR` | AUTH_ERROR/5 | select | 跳 `abap-cli-setup`：`profile test`；检查 `S_TABU_DIS` |
| `ICF_CHECK_DEGRADED` | warning（`meta.warnings`） | select | 不阻断；跳 `abap-cli-setup` 跑 `extension status` |

## JSON 输出契约参考

- 契约规范：见本仓库 `wiki/json-generation.md`（POSIX 路径是该契约的一部分）