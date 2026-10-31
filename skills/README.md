# abap-cli skills

abap-cli 用户的 AI agent 上下文集合。**自包含**——分发时每个 skill 是 `SKILL.md + references/ + scripts/ + assets/` 的完整程序知识包，**不**依赖用户的 workspace 有 `wiki/` `docs/` `specs/` 副本。

## 分层边界（必读）

本仓库有两套 agent 上下文，**用途不同**：

| 路径 | 用途 | 谁用 | 随 npm 包分发？ |
|---|---|---|---|
| `.agents/skills/`（`abap-style` / `abap-report-style` / `okf` / `abap-testing` / `repo-workflow`） | 本仓库贡献者的本地元方法 | vibe_with_abap 开发者 | ❌（gitignored） |
| **顶层 `skills/`（本目录）** | **abap-cli 用户的路由/领域 skill** | **abap-cli 用户** | **✅（`package.json#files` 含 `skills/`）** |
| **顶层 `agents/abap-developer.agent.md`** | **abap-cli 用户的端到端开发代理** | **abap-cli 用户** | **✅（`package.json#files` 含 `agents/`）** |

不要把两套目录混用：本目录是**给 abap-cli 安装者看的**，`.agents/skills/` 是**给本仓库贡献者看的**。

## 自包含原则（重要）

**每个 skill 分发出去后必须能独立工作**——agent 不需要在用户 workspace 里找 `wiki/` `docs/` `specs/` 等本地副本。

具体规则：

- ✅ SKILL.md 含决策树 + 错误恢复（最小必要知识）
- ✅ `references/` 子目录放按需加载的完整命令速查、错误码全表、详细工作流
- ✅ `scripts/` 子目录放可执行的辅助脚本（包装 abap-cli）
- ✅ `assets/` 子目录放模板文件（如 `.abap.json` `.abapignore`）
- ✅ 权威细节引用走 **GitHub URL**（永久链接），不依赖本地相对路径
- ❌ 禁止用 `../../wiki/` `../../docs/` `../../specs/` 等相对路径（用户机器上不存在）

progressive loading 三阶段：

1. **发现**（~100 tokens）：agent 启动时只读每个 skill 的 `name` + `description`
2. **正文加载**（< 5000 tokens）：匹配路由后读 SKILL.md 全文
3. **资源按需**：执行命令时读 `references/`，跑脚本时读 `scripts/`

## 安装

### 方式 A — `abap init --agent`（推荐）

```bash
npx abap-cli init --agent copilot   # 或 claude / cursor / generic
```

把 `skills/` 与 `agents/` 拷到对应 vendor 目录（`--force` 覆盖已有文件）：

| target | skills 目录 | agent 目录 | 额外 |
|---|---|---|---|
| `copilot` | `.github/skills/` | `.github/agents/` | — |
| `claude` | `.claude/skills/` | `.claude/agents/` | 根 `CLAUDE.md` |
| `cursor` | `.cursor/skills/` | `.cursor/agents/` | `.cursor/rules/abap.mdc` |
| `generic` | `.agents/skills/` | `.agents/agents/` | — |

### 方式 B — 手动拷贝

```bash
# 拷 skill 时必须拷目录内容，不要多套一层（否则 <name>/SKILL.md 不会被发现）
cp -r skills/* <your-project>/.claude/skills/
cp agents/abap-developer.agent.md <your-project>/.claude/agents/
```

## 索引

### Skill（6 个 — 1 meta + 4 领域 + 1 方法论）

| skill | scope | 覆盖命令 | 一句话职责 |
|---|---|---|---|
| **`abap-cli`** | meta | `report-stuck` | 入口路由层：按意图分发到 4 个领域 skill + 1 个方法论 skill；本地卡死留痕；CLI 反馈直接提 GitHub issue |
| **`abap-cli-setup`** | workspace-and-sap | `init` `profile` `doctor` `transport` `deploy` `session` `types` | 环境就绪：工作区、凭证、诊断、传输请求、ICF 部署、session、TADIR 映射 |
| **`abap-cli-search`** | sap（只读） | `search` `where-used` `inspect` `tcode` `diff` `status` `dumps` | 元数据探查：不改对象、不加锁、不写 transport；`dumps` 列 ST22 dump |
| **`abap-cli-edit`** | sap（写） | `pull` `push` `check` `create`（含 `create local`）`activate` `delete` `list` `mime` `validate:aff` | 写路径：源码/DDIC/MIME 的拉取、创建、修改、推送、激活、删除；类型码以 `src/abap_cli/types/registry.ts` 为准（当前 21 个注册类型，`SRVB` 等部分类型仅支持 pull） |
| **`abap-cli-data`** | sap（只读消费） | `select` `fields` `run` `run-report` | 运行时消费：查表/字段、跑类、跑报表；全程只读 |
| **`abap-cli-performance`** | abap-performance-review | （方法论；触发只读命令 `search` / `inspect` / `pull` / `check` / `select`） | ABAP 性能 review：慢路径诊断、分平台建议、`check` / ATC 核验 |

每个 skill 的内部结构：

```
skills/<name>/
├── SKILL.md                  # 入口（决策树 + 错误恢复）
├── references/
│   ├── commands-quick.md     # 本 skill 覆盖命令的完整速查
│   └── errors.md             # 本 skill 错误码全表
├── scripts/                  # 可执行 .mjs 脚本（包装 abap-cli）
└── assets/                   # 模板文件
```

### Agent（编排 6 个 skill）

| agent | 角色 | 详细 |
|---|---|---|
| **`abap-developer`** | 端到端开发代理（7 步工作流；路由由 `abap-cli` meta-skill 承担） | [abap-developer.agent.md](../agents/abap-developer.agent.md) |

### 路由表（`abap-cli` meta-skill 权威持有）

| 用户意图 | 唯一目标 skill | 触发命令 |
|---|---|---|
| 配置 / 接 SAP / 加 profile / 诊断 / 传输请求 / 部署 ICF / 看 session / 查类型映射 | `abap-cli-setup` | `init` `profile` `doctor` `transport` `deploy` `session` `types` |
| 查对象元数据 / where-used / 业务码 / 拉取对账 / 状态只读 / 看 ST22 dump | `abap-cli-search` | `search` `where-used` `inspect` `tcode` `diff` `status` `dumps` |
| 拉对象 / 改 / 推 / 语法检查 / 激活 / 创建 / 删除 / 列举 / MIME / AFF 校验 | `abap-cli-edit` | `pull` `push` `check` `create` `activate` `delete` `list` `mime` `validate:aff` |
| 跑类 / 查表数据 / 列表字段 / 跑报表 / 翻页 select | `abap-cli-data` | `select` `fields` `run` `run-report` |
| ABAP 性能 review / 慢路径诊断 / 优化建议 | `abap-cli-performance` | （方法论 skill，不直接管命令） |
| Agent 卡死留痕（不依赖 SAP） | `abap-cli`（meta） | `report-stuck` |
| Agent 提交反馈 / bug | `abap-cli`（meta） | GitHub Issues（无 CLI 命令） |
| 意图模糊 / 不确定归哪类 | `abap-cli`（meta） | （路由查询本身） |

> ⚠️ **`pull` 归 `abap-cli-edit`**（写路径中间步骤），**`inspect` 归 `abap-cli-search`**（只读元数据，修复动作归 edit）。
>
> ⚠️ **`abap-cli-performance` 不是领域 skill**——不声明 `metadata.commands`（命令归属仍是 4 个领域 skill）；本 skill 全程只读、不写对象。
>
> ⚠️ **`report-stuck` 归 `abap-cli`（meta）**——不操作 SAP 对象，纯本地留痕；CLI 反馈不再有内置命令，agent 直接建 GitHub issue（GitHub MCP / `gh` / 预填 URL）。

### 错误码不重叠（硬性约束）

权威列表见 `src/abap_cli/output/error-codes.ts`。归属约束：

- `abap-cli-data`：`WRAPPER_NOT_DEPLOYED` / `WRAPPER_INPUT_UNAVAILABLE` / `METHOD_NOT_SUPPORTED` / `METHOD_FAILED` / `CLASS_NOT_RUNNABLE` / `LOCAL_CLASS_NOT_RUNNABLE` / `TABLE_NOT_FOUND` / `TABLE_TYPE_NOT_SUPPORTED` / `INVALID_FIELD` / `INVALID_WHERE` / `LIMIT_EXCEEDED` / `OFFSET_EXCEEDED` / `QUERY_FAILED` / `TIMEOUT`
- `abap-cli-edit`：`LOCK_FAILED` / `LOCKED` / `SYNTAX_ERROR` / `OBJECT_NOT_ACTIVE` / `ACTIVATION_FAILED` / `DDIC_NOT_SUPPORTED` / `TYPE_NOT_SUPPORTED` / `CHANNEL_DETECTION_FAILED` / `DDLS_NOT_SUPPORTED_ON_ECC` / `PUSH_FAILED`
- `abap-cli-search`：`OBJECT_NOT_FOUND` / `TCODE_NOT_FOUND` / `AUTH_ERROR` / `TCODE_NOT_AUTHORIZED` / `AMBIGUOUS_OBJECT`
- `abap-cli-setup`：`CONFIG_ERROR` / `TLS_ERROR` / `NO_TRANSPORT` / `SESSION_INVALID` / `SESSION_JAR_DECRYPT_FAILED`
- `abap-cli`（meta）：无专属错误码（`report-stuck` 只用公共 `USAGE`）
- 公共错误（`INVALID_ARGUMENT` / `USAGE` / `VALIDATION_ERROR` / `SAP_ERROR` 等）在涉及它的每个 skill 中各自内联，不做 cross-reference

## 命令覆盖核对（28 CLI 命令）

- ✅ `abap-cli-setup`：`init` `profile` `doctor` `transport` `deploy` `session` `types` — **7 顶层**
- ✅ `abap-cli-search`：`search` `where-used` `inspect` `tcode` `diff` `status` `dumps` — **7 顶层**
- ✅ `abap-cli-edit`：`pull` `push` `check` `create`（含 `create local`）`activate` `delete` `list` `mime` `validate:aff` — **9 顶层 + `create local` 子命令**
- ✅ `abap-cli-data`：`select` `fields` `run` `run-report` — **4 顶层**
- ✅ `abap-cli`（meta）：`report-stuck` — **1 顶层**
- ✅ `abap-cli-performance`：方法论 skill，不占顶层命令
- **合计**：7 + 7 + 9 + 4 + 1 = **28 顶层命令**（与 `src/abap_cli/registry/commands.ts` 的 `COMMAND_SPECS` 1:1，由 `npm run check-skills-drift` 校验）

## 版本

- **CLI 版本**：`1.0.0`
- **类型注册表**：21 个类型码（`src/abap_cli/types/registry.ts`）
- **agentskills.io 标准**：<https://agentskills.io/>

## references

- 仓库合约：根 `AGENTS.md`
