# abap-setup — 4 命令完整速查

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
| `--profile <name>` | 引用已有 profile |
| `--url <url>` | 新建 profile 的系统 URL |
| `-c, --client <n>` | SAP 客户端 |
| `-u, --username <u>` | 用户名 |
| `-p, --password <pwd>` | 密码（写 keychain） |
| `-l, --language <lang>` | SAP 语言 |
| `--tr <transport>` | 默认 transport |
| `--package <pkg>` | 默认包 |
| `--insecure` | 跳过 SSL 校验 |
| `--ca <pem>` | CA 证书 |
| `--test-connection` / `--test-tls` / `--test-auth` | 探针 |
| `--agent <target>` | 脚手架 agent 上下文（copilot \| claude \| cursor \| generic；幂等，`--force` 覆盖） |
| `--yes` / `--non-interactive` | 覆盖已有 `.abap.json` |

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
abap transport create "task" --tr <target>    # 释放到目标请求

# 查看
abap transport show DEVK900001

# 查对象归属
abap transport resolve ZCL_FOO

# 绑定对象到请求（写操作，非 TTY 需 --yes 或 --dry-run）
abap transport assign ZCL_FOO --tr DEVK900001 --yes

# 释放
abap transport release DEVK900001 --tr <target> --yes
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