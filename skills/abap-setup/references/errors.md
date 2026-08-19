# abap-setup — 错误码全表

> 按需加载。本文件只在 SKILL.md 提及 references 时被 agent 读取。

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

## 本 skill 错误码清单（4 命令范围）

### init / profile

| code | cat/exit | 触发 | 修复 |
|---|---|---|---|
| `CONFIG_ERROR` | CONFIG_ERROR/3 | `.abap.json` / `systems.json` 损坏、字段缺失 | 检查 JSON 语法；重新 `abap init` |
| `TLS_ERROR` | TLS_ERROR/4 | TLS 握手失败 | `--insecure` 或 `--ca <pem>` |
| `AUTH_ERROR` | AUTH_ERROR/5 | 用户名/密码错 / 会话过期 | `profile test <name>`；确认 keychain 密码 |
| `USAGE` | USAGE/2 | 缺必填参数 | `abap <cmd> --help` |
| `INVALID_ARGUMENT` | USAGE/2 | 参数不合法（如 `profile add` 缺 url） | 看 `error.nextSteps` |
| `NOT_FOUND` | NOT_FOUND/8 | profile 不存在 | `profile list` 查名字 |

### doctor

| code | cat/exit | 触发 | 修复 |
|---|---|---|---|
| `CONFIG_ERROR` | CONFIG_ERROR/3 | 工作区未配置或 profile 错 | `abap init` 或 `--profile <name>` |
| `TLS_ERROR` | TLS_ERROR/4 | doctor 探针 TLS 失败 | `profile set <name> --insecure` |
| `AUTH_ERROR` | AUTH_ERROR/5 | doctor 探针 auth 失败 | 重写密码 |

`doctor --fix` 仅做安全可逆修复（TLS 校验开关、cache 清理等）。其他问题报在 `nextSteps`。

### transport

| code | cat/exit | 触发 | 修复 |
|---|---|---|---|
| `NO_TRANSPORT` | VALIDATION_ERROR/7 | 推送对象无可用请求 | `transport create "..."` 后 `--tr` 重试 |
| `TRANSPORT_CREATE_FAILED` | VALIDATION_ERROR/7 | `transport create` 失败（描述空、用户无权限） | 描述非空；用户须有 developer 权限 |
| `INVALID_ARGUMENT` | USAGE/2 | `transport create` 描述为空等 | 看 `error.nextSteps` |
| `USAGE` | USAGE/2 | 缺必填参数 | `abap transport --help` |

### 写操作保护（P0.3）

`transport create` 与 `transport assign` 是写操作：

- **非 TTY**：必须 `--yes` 或 `--dry-run`，否则 `VALIDATION_ERROR` (exit 7)
- **`--dry-run`**：返回 `{ dryRun: true, ... }` 不改 SAP
- **`--yes`**：跳过确认

### extension deploy / status

| code | cat/exit | 触发 | 修复 |
|---|---|---|---|
| `OBJECT_EXISTS` | USAGE/2 | `--atomic` 推送已存在对象 | 加 `--overwrite`（如支持） |
| `ACTIVATION_FAILED` | VALIDATION_ERROR/7 | ICF handler 激活失败 | 复检：`inspect <obj> --activation` → `activate --yes`（abap-object skill 内） |
| `SAP_ERROR` | SAP_ERROR/6 | SAP 端 deploy 失败 | 看 `data.objects[]` 哪个失败 |
| `ICF_CHECK_DEGRADED` | warning（meta.warnings） | ICF 部署健康探测不可达 | 不阻断；查 SAP 端 `/sap/zabap_vibe/` 是否可达 |

### extension status 状态值

| `data.status` | 含义 | 推荐动作 |
|---|---|---|
| `not_deployed` | ICF 服务没装过 | `extension deploy --yes` |
| `current` | 安装且版本匹配 | 跳过 |
| `outdated` | 安装但版本过期 | `extension deploy --yes` 升级 |
| `unreachable` | 探测不可达 | 不阻断；查 `meta.warnings`（ICF_CHECK_DEGRADED） |

## 完整 012 契约参考

- <https://github.com/SAP/abap-cli/blob/main/docs/commands.md#json-output-contract>
- <https://github.com/SAP/abap-cli/blob/main/specs/012-unify-cli-output-contract/contracts/cli-output.md>