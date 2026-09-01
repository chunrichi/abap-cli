# abap-cli-search — 错误码全表

> 按需加载。

## 本 skill 错误码清单（6 命令范围）

| code | cat/exit | 触发命令 | 修复 |
|---|---|---|---|
| `OBJECT_NOT_FOUND` | NOT_FOUND/8 | search / where-used / inspect / tcode / diff / status | `search <name>` 校对；缩写 / 包名 / 大小写重试 |
| `NOT_AUTHORIZED` | AUTH_ERROR/5 | search / inspect / where-used / tcode | 用户无 `S_TCODE` / `S_ADT_RES` 等权限；跳 `abap-cli-setup` 跑 `profile test` |
| `TCODE_NOT_FOUND` | NOT_FOUND/8 | tcode | 业务码未在 TSTC；校对拼写 |
| `TCODE_NOT_AUTHORIZED` | AUTH_ERROR/5 | tcode | 用户无 `S_TCODE`；换有权限用户 |
| `OBJECT_NOT_INDEXED` | SAP_ERROR/6 | where-used | 暂时无索引；改用 `search <obj>` + `pull`（[abap-cli-edit]）看代码 |
| `INVALID_ARGUMENT` | USAGE/2 | 任意 | 看 `error.nextSteps` / `error.references`（help 已不再含错误恢复表） |
| `USAGE` | USAGE/2 | 任意 | 缺必填参数；看 `error.nextSteps` |
| `SAP_ERROR` | SAP_ERROR/6 | 任意 | `data.objects[]` 看哪个失败；ICF 端未知错码时跳 `abap-cli-setup` 跑 `extension status` |

## 012 通用退出码（稳定契约）

| exit | category | 含义 |
|---|---|---|
| 0 | success | 成功 |
| 1 | UNKNOWN | 未能归类的异常 |
| 2 | USAGE | 命令行使用错误 |
| 3 | CONFIG_ERROR | 配置文件错 |
| 4 | TLS_ERROR | TLS 握手失败 |
| 5 | AUTH_ERROR | 认证失败 |
| 6 | SAP_ERROR | SAP 端错 |
| 7 | VALIDATION_ERROR | 校验失败 |
| 8 | NOT_FOUND | 对象未找到 |
| 9 | LOCKED | 对象被锁 |

`error.category` 在 `--json` 信封中 1:1 对应退出码。≥10 保留。

## JSON 输出契约参考

- 契约规范：见本仓库 `wiki/json-generation.md`（POSIX 路径是该契约的一部分）