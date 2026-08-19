# abap-setup — 4 + 2 命令完整速查

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

## `abap extension`（基础设施就绪）

部署和探测 bundled ICF 服务（`/sap/zabap_vibe`）。安装 `ZCL_ABAP_VIBE_ICF` + `ZCL_ABAP_VIBE_ICF_SETUP` + `ZCL_ABAP_VIBE_RUNNER`，是 `abap-object` 的 `run` / `select` / `tcode` 的硬性依赖。

### `abap extension deploy`

```bash
# 部署 / 升级 bundled ICF 服务（默认 $TMP 无需 --tr）
abap extension deploy --yes

# 计划部署（零变更）
abap extension deploy --dry-run

# 看会改什么
abap extension deploy --diff

# 部署到非 $TMP 包（需 --tr）
abap extension deploy --package ZABAP_VIBE --tr DEVK900001 --yes
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
- `abap extension deploy` 自动创建/更新 `ZCL_ABAP_VIBE_ICF` + `ZCL_ABAP_VIBE_ICF_SETUP` + `ZCL_ABAP_VIBE_RUNNER`（013 + 015 + 016 + 017 + tcode 累积）

#### 写操作约束

`deploy` 是写操作：

- **非 TTY**：必须 `--yes` 或 `--dry-run`，否则 `VALIDATION_ERROR` (exit 7)
- **`--dry-run`**：返回 `{ dryRun: true, icfNode.status: "planned" }` 不调 SAP

### `abap extension status`

```bash
abap extension status                  # 仅探测
abap extension status --json
# → data: { installed, status, remoteVersion, expectedVersion, match }
```

| `status` | 含义 | 推荐动作 |
|---|---|---|
| `not_deployed` | ICF 服务没装过 | `abap extension deploy --yes` |
| `current` | 安装且版本匹配 | 跳过 |
| `outdated` | 安装但版本过期 | `abap extension deploy --yes` 升级 |
| `unreachable` | 探测不可达 | 不阻断；查 `meta.warnings`（ICF_CHECK_DEGRADED） |

### 与 doctor / init 的关系

- `extension status` 查 SAP 侧
- `doctor` 查本地（环境 / 配置 / profile 可达性）
- `init --profile <name>` 一次性做 `doctor` + ICF 探测，结果落在 `data.icf`