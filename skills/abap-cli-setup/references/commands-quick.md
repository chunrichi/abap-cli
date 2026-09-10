# abap-cli-setup — 7 命令完整速查

> 按需加载。本文件只在 SKILL.md 提及 references 时被 agent 读取。

## `abap init`

写入工作区 `.abap.json`。两个入口：

### 参数形式（推荐）

```bash
# 引用现有 profile
abap init --profile dev --tr DEVK900001 --package ZDEV --json

# 新建 profile + 写工作区
abap init --url https://sap:44300 --client 100 --username DEV --password '***' --json

# 写工作区 + 信息性 ICF 部署检查（不阻断）
abap init --profile dev --json
# → data.icf: 'not_deployed' | 'current' | 'outdated' | 'unreachable'
```

| flag | 含义 |
|---|---|
| `--profile <name>` | 引用已有 profile（推荐） |
| `--system <name>` | `--profile` 的废弃别名；保留兼容 |
| `--url <url>` | 新建 profile 的系统 URL（TTY 向导 / `profile add` 已建立的 profile 优先） |
| `-c, --client <n>` | SAP 客户端 |
| `-u, --username <u>` | 用户名 |
| `-p, --password <pwd>` | 密码（写 keychain） |
| `-l, --language <lang>` | SAP 语言 |
| `--tr <transport>` | 默认 transport |
| `--package <pkg>` | 默认包 |
| `--source-dir <path>` | `push --all` / `check --all` 扫描根目录（写入 `.abap.json::sourceDir`） |
| `--insecure` | 跳过 SSL 校验 |
| `--ca <pem>` | CA 证书 |
| `--auth-method <method>` | 登录策略：`basic`（默认）/ `cert`（X.509 客户端证书，025）/ `browser_sso`（BTP / SAML，026）/ `oauth_password`（BTP service-key JWT，027） |
| `--auth-option <kv>` | 通用 auth 选项，重复 `key=value`；新增 auth method 不增加 Commander options，全走这个 bag |
| `--cert-path <path>` / `--cert-key <path>` / `--cert-ca <path>` / `--cert-passphrase <pwd>` | `--auth-method=cert` 客户端证书材料（passphrase 写 keychain） |
| `--sso-cookie-file <path>` | `--auth-method=browser_sso` cookie jar 路径 |
| `--service-key <path>` | `--auth-method=oauth_password` BTP service key JSON |
| `--test-connection` / `--test-tls` / `--test-auth` | 探针（TLS→4, AUTH→5） |
| `--show-config` | 打印当前 `.abap.json` 后退出（只读，替代旧的 `abap config show`） |
| `--unset-package` / `--unset-tr` / `--unset-source-dir` | 从 `.abap.json` 移除对应字段（互斥组） |
| `--agent <target>` | 脚手架 agent 上下文（`copilot` / `claude` / `cursor` / `generic`；幂等，`--force` 覆盖） |
| `--force` | 脚手架时覆盖已有文件 |
| `--yes` / `--non-interactive` | 跳过提示；非交互模式必填 |

### 交互向导

```bash
abap init        # TTY only，失败时退出 USAGE
```

## `abap profile`

管理全局 profiles（`~/.abap-cli/systems.json`，mode `0600`）。绑定工作区用 `abap init --profile <name>`（021 移除 `use`）。

```bash
abap profile list                          # 列出
abap profile show <name>                   # 详情
abap profile add <name> --url ... --username ... --password '***'   # 新建（存在则拒绝）
abap profile set <name> [flags]            # 修改已有
abap profile test <name> [--verbose]       # 分层测试（TLS→4, AUTH→5, ADT/ICF→6）
abap profile login <name>                  # Browser SSO：起 127.0.0.1 临时 loopback 捕获 SAP SAML cookie
abap profile delete <name> --yes           # 删除（非 TTY 需 --yes）
abap profile export <name>                 # 导出 profile
abap profile import <file> [--overwrite]   # 导入 profile
```

## `abap doctor`

诊断 CLI 环境（env / config / connection 三段）。

```bash
abap doctor                  # 三段 ok/err
abap doctor --verbose        # 详细
abap doctor --fix            # 应用安全可逆修复（需 --yes）
abap doctor --json
```

未配置工作区时：`config.workspace` 报 err，指向 `abap init` 或 `abap init --profile <name>`。

## `abap transport`

管理 SAP 传输请求。

```bash
# 列出（默认仅 workbench modifiable）
abap transport list
abap transport list --open    # 仅未释放
abap transport list --json

# 创建（默认 $TMP 本地请求）
abap transport create "Feature work"
abap transport create "Customizing" --package $PKG
abap transport create "task" --tr <target>    # 创建 task 到目标请求

# 查看（含嵌套 task 对象与 `deduplicated` 计数，供 `abap pull --tr <request>` 去重）
abap transport show DEVK900001

# 查对象归属
abap transport resolve ZCL_FOO

# 绑定对象到请求（写操作，非 TTY 需 --yes 或 --dry-run）
abap transport assign ZCL_FOO --tr DEVK900001 --yes

# 释放请求 — 当前 CLI **未实现** `abap transport release` 子命令
# 走 GUI（SE01 / SE09 / SE10）或外部 `tp` / `R3trans`；spec 候选
```

### 退出码 / 错误码

| code | category/exit |
|---|---|
| `NO_TRANSPORT` | VALIDATION_ERROR / 7 |
| `TRANSPORT_CREATE_FAILED` | VALIDATION_ERROR / 7 |
| `INVALID_ARGUMENT` | USAGE / 2 |
| `USAGE` | USAGE / 2 |

### 写操作约束

`create` 与 `assign` 是写操作：

- **TTY**：无确认提示
- **非 TTY**：必须 `--yes` 或 `--dry-run`，否则 `VALIDATION_ERROR` (exit 7)

## `abap deploy`（基础设施就绪）

部署和探测 bundled ICF 服务（`/sap/zabap_vibe`）。安装 `ZCL_ABAP_VIBE_ICF` + `ZCL_ABAP_VIBE_ICF_SETUP` + `ZCL_ABAP_VIBE_RUNNER`，是 [abap-cli-data] 的 `run` / `select` 的硬性依赖。

### `abap deploy`

```bash
# 部署 / 升级 bundled ICF 服务（默认 $TMP 无需 --tr）
abap deploy --yes

# 计划部署（零变更）
abap deploy --dry-run

# 看会改什么
abap deploy --diff

# 部署到非 $TMP 包（需 --tr）
abap deploy --package ZABAP_VIBE --tr DEVK900001 --yes
```

#### 输出信封（`--json`）

```jsonc
{
    "status": "success",
    "data": {
        "icfNode": {
            "status": "deployed" | "planned" | "unchanged" | "failed",
            "path": "/sap/zabap_vibe"
        },
        "objects": [
            { "name": "ZCL_ABAP_VIBE_ICF", "type": "CLAS",
              "status": "created" | "updated" | "unchanged" | "failed" }
        ],
        "files": [
            { "file": "src/zcl_abap_vibe_icf/zcl_abap_vibe_icf.clas.abap",
              "status": "pushed" | "failed" }
        ]
    }
}
```

#### ICF 服务版本

- 服务版本随 CLI 升级；CLI 启动时缓存 `ICF_SERVICE_VERSION` / handler 端 `gc_version`
- `abap deploy` 自动创建/更新 `ZCL_ABAP_VIBE_ICF` + `ZCL_ABAP_VIBE_ICF_SETUP` + `ZCL_ABAP_VIBE_RUNNER`（013 + 015 + 016 + 017 + tcode 累积）

#### 写操作约束

`deploy` 是写操作：

- **非 TTY**：必须 `--yes` 或 `--dry-run`，否则 `VALIDATION_ERROR` (exit 7)
- **`--dry-run`**：返回 `{ dryRun: true, icfNode.status: "planned" }` 不调 SAP

### `abap deploy status`

```bash
abap deploy status                  # 仅探测
abap deploy status --json
# → data: { installed, status, remoteVersion, expectedVersion, match }
```

| `status` | 含义 | 推荐动作 |
|---|---|---|
| `not_deployed` | ICF 服务没装过 | `abap deploy --yes` |
| `current` | 安装且版本匹配 | 跳过 |
| `outdated` | 安装但版本过期 | `abap deploy --yes` 升级 |
| `unreachable` | 探测不可达 | 不阻断；查 `meta.warnings`（ICF_CHECK_DEGRADED） |

### 与 doctor / init 的关系

- `deploy status` 查 SAP 侧
- `doctor` 查本地（环境 / 配置 / profile 可达性）
- `init --profile <name>` 一次性做 `doctor` + ICF 探测，结果落在 `data.icf`

## `abap extensions`

管理 `.abap.json::extensions[]` 中声明的第三方扩展（npm 包 / 本地路径）。**与 `abap deploy` 不同**——`deploy` 装的是内置 SAP 侧 ICF 服务（`/sap/zabap_vibe`）；`extensions` 管的是 npm 端扩展加载机制（spec 023 + 027）。

### `abap extensions list`

只读探测。列 `.abap.json::extensions[]` 每条：声明信息（`sourceType` / `packageName` 或 `path`）、加载结果（`loaded` / `failed` + reason）、lockfile 状态（仅 `sourceType: 'npm'`）。**无 SAP 调用**。

```bash
abap extensions list --json
abap extensions list --pretty-json
```

### `abap extensions lock`

重新生成 `extensions.lock.json`，记录每个 npm-source 扩展的 sha512。

```bash
# 常规重锁
abap extensions lock

# 首次跑且没现成 lockfile 时，强制允许未签扩展（不安全；建议手动审核）
abap extensions lock --allow-unsigned

# 自省（无 I/O）
abap extensions --schema
```

#### 安全约束（spec 027 信任硬化）

- `extensions lock` 拒绝创建**全新** lockfile 除非传 `--allow-unsigned`，防止恶意 `.abap.json` 首次跑静默注入未钉扩展
- 重跑（lockfile 已存在）正常无 `allow-unsigned` 也会通过
- npm 包第一次被锁前会校验 `package.json::signature`；不签名直接拒绝

### 退出码 / 错误码

| code | cat/exit |
|---|---|
| `EXTENSION_LOAD_FAILED` | CONFIG_ERROR / 3 |
| `EXTENSION_VALIDATION_FAILED` | VALIDATION_ERROR / 7 |

## `abap session info`

读 session cookie jar 状态（**只读、不联网**）。session jar 路径：`~/.abap-cli/sessions/<system-hash>.json`，内容 AES-256-GCM 加密，密钥存 OS keychain。

排查 400 "Session Timed Out" 错误的关键诊断：CLI 在 0.2.5+ 会自动把 `400 + /session\s+timed\s+out/i` 重新分类为 `AUTH_ERROR` 并触发 `_call` 的 re-login fallback；如果 re-login 仍失败，先看 `session info` 确认 jar 是否过期。

```bash
abap session info --json                          # 当前 active profile
abap session info --profile vhcala4hci --json      # 指定 profile
```

| flag | 含义 | 默认 |
|---|---|---|
| `--profile <name>` | 覆盖 active profile | `.abap.json#system` 指向的 profile |

输出信封：

```jsonc
{
    "status": "success",
    "data": {
        "policy": "reuse" | "always-logout",   // 会话复用策略
        "systemHash": "<sha256>",              // 系统指纹
        "cookieCount": 12,                     // jar 里 cookie 数（BTP / Cloud: 0）
        "csrfPresent": true,                   // CSRF token 是否存在
        "lastLoginAt": "2026-09-06T10:00:00Z" | null,
        "jarPath": "~/.abap-cli/sessions/<hash>.json"
    }
}
```

**BTP / Cloud profile**：`policy` 与 `systemHash` 仍计算；但 `cookieCount: 0`、`csrfPresent: false`、`lastLoginAt: null`（jar 路径在不支持的 profile 上**不**触碰）。

### 退出码 / 错误码

| code | cat/exit |
|---|---|
| `CONFIG_ERROR` | CONFIG_ERROR / 3（profile 不存在 /  .abap.json 损坏） |
| `SESSION_JAR_DECRYPT_FAILED` | VALIDATION_ERROR / 7（keychain 缺 / 密钥错） |