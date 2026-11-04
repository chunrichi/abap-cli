# abap-cli-setup — 错误码全表

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

## 本 skill 错误码清单（8 命令范围）

### init / profile

| code | cat/exit | 触发 | 修复 |
|---|---|---|---|
| `CONFIG_ERROR` | CONFIG_ERROR/3 | `.abap.json` / `systems.json` 损坏、字段缺失 | 检查 JSON 语法；重新 `abap init` |
| `TLS_ERROR` | TLS_ERROR/4 | TLS 握手失败 | `--insecure` 或 `--ca <pem>` |
| `AUTH_ERROR` | AUTH_ERROR/5 | 用户名/密码错 / 会话过期 | `profile test <name>`；确认 keychain 密码 |
| `USAGE` | USAGE/2 | 缺必填参数 | `error.nextSteps` / `error.references`（help 已不再含错误恢复表） |
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
| `USAGE` | USAGE/2 | 缺必填参数 | `error.nextSteps` / `error.references`（help 已不再含错误恢复表） |

### 写操作保护

`transport create` 与 `transport assign` 是写操作：

- **非 TTY**：必须 `--yes` 或 `--dry-run`，否则 `VALIDATION_ERROR` (exit 7)
- **`--dry-run`**：返回 `{ dryRun: true, ... }` 不改 SAP
- **`--yes`**：跳过确认

### deploy / deploy status

| code | cat/exit | 触发 | 修复 |
|---|---|---|---|
| `OBJECT_EXISTS` | USAGE/2 | `--atomic` 推送已存在对象 | 加 `--overwrite`（如支持） |
| `ACTIVATION_FAILED` | VALIDATION_ERROR/7 | ICF handler 激活失败 | 复检：`inspect <obj> --activation`（[abap-cli-search]）→ `activate --yes`（[abap-cli-edit]） |
| `SAP_ERROR` | SAP_ERROR/6 | SAP 端 deploy 失败 | 看 `data.objects[]` 哪个失败 |
| `ICF_CHECK_DEGRADED` | warning（meta.warnings） | ICF 部署健康探测不可达 | 不阻断；查 SAP 端 `/sap/abap_cli/` 是否可达 |

### deploy status 状态值

| `data.status` | 含义 | 推荐动作 |
|---|---|---|
| `not_deployed` | ICF 服务没装过 | `deploy --yes` |
| `current` | 安装且版本匹配 | 跳过 |
| `outdated` | 安装但版本过期 | `deploy --yes` 升级 |
| `unreachable` | 探测不可达 | 不阻断；查 `meta.warnings`（ICF_CHECK_DEGRADED） |

<a id="icf_identity_unavailable"></a>

### whoami

| code | cat/exit | 触发 | 修复 |
|---|---|---|---|
| `ICF_IDENTITY_UNAVAILABLE` | NOT_FOUND/8 | 内置 ICF 服务未部署或版本过旧，没有 `/whoami` 身份端点（身份只能由 SAP 系统返回） | `abap deploy --yes` 后重试；`abap deploy status --json` 确认 `current`。刚部署完仍报错时等约 1 分钟（SICF handler class load 刷新延迟），不要重复部署 |

### session

| Code | Category/Exit | When |
|---|---|---|
| `SESSION_JAR_DECRYPT_FAILED` | VALIDATION_ERROR/7 | `session info` 解密失败：key 变了 / jar 损坏 / 换了 profile。`abap session reset --yes` 后下次登录重建 |
| `SESSION_REUSE_UNSUPPORTED` | VALIDATION_ERROR/7 | cloud/BTP profile 不支持 cookie 复用（`doctor` warning；不阻断） |

`--json` 的 `meta.warnings` 里可能出现：`SESSION_REUSE_DISABLED`（没有 durable 存储或 key 不可持久化，复用关闭、每条命令登录+登出）、`SESSION_STORE_FALLBACK`（HOME 不可写，已切到工作区存储）、`SESSION_REUSE_UNSTABLE`（SAP 连续拒绝存档会话，复用暂停 10 分钟）、`SESSION_JAR_CORRUPT`（jar 解不开已隔离）。排查看 `abap session info --json` 的 `store` / `candidates` / `jar`。

## JSON 输出契约参考

- `--json` 中的路径字段统一使用 `/` 分隔（POSIX 风格），不随运行平台变化；以 `abap <cmd> --schema --json` 为准。