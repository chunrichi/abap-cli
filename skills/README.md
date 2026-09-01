# abap-cli skills

abap-cli 用户的 AI agent 上下文集合。**自包含**——分发时每个 skill 是 `SKILL.md + references/ + scripts/ + assets/` 的完整程序知识包，**不**依赖用户的 workspace 有 `wiki/` `docs/` `specs/` 副本。

## 分层边界（必读）

本仓库有两套 `skills/` `agents/`，**用途不同**：

| 路径 | 用途 | 谁用 | 随 npm 包分发？ |
|---|---|---|---|
| `.github/skills/` `abap-style/` `okf` | 本仓库 AI 贡献者的元方法 | vibe_with_abap 开发者 | ❌ |
| `.github/agents/`（spec-kit、test-driver 等） | 本仓库工作流 | vibe_with_abap 开发者 | ❌ |
| **顶层 `skills/`（本目录）** | **abap-cli 用户的 agent 路由层** | **abap-cli 用户** | **❌（v1）** |
| **顶层 `agents/abap-developer.agent.md`** | **abap-cli 用户的端到端开发代理** | **abap-cli 用户** | **❌（v1）** |

不要把两套目录混用：本目录是**给 abap-cli 安装者看的**，`.github/skills/` 是**给本仓库贡献者看的**。

## 自包含原则（重要）

**每个 skill 分发出去后必须能独立工作**——agent 不需要在用户 workspace 里找 `wiki/` `docs/` `specs/` 等本地副本。

具体规则：

- ✅ SKILL.md 含决策树 + 错误恢复（最小必要知识）
- ✅ `references/` 子目录放按需加载的完整命令速查、错误码全表、详细工作流
- ✅ `scripts/` 子目录放可执行的辅助脚本（bash 包装）
- ✅ `assets/` 子目录放模板文件（如 `.abap.json` `.abapignore`）
- ✅ 权威细节引用走 **GitHub URL**（永久链接），不依赖本地相对路径
- ❌ 禁止用 `../../wiki/` `../../docs/` `../../specs/` 等相对路径（用户机器上不存在）

progressive loading 三阶段：

1. **发现**（~100 tokens）：agent 启动时只读每个 skill 的 `name` + `description`
2. **正文加载**（< 5000 tokens）：匹配路由后读 SKILL.md 全文
3. **资源按需**：执行命令时读 `references/`，跑脚本时读 `scripts/`

## 安装

### 方式 A — `npx skills add`（推荐）

```bash
npx skills add <owner>/abap-cli
```

把顶层 `skills/` `agents/` 完整拷到目标 agent 的 skill 目录。

### 方式 B — 手动拷贝

```bash
# 完整拷（含 references/ scripts/ assets/）
cp -r skills/ <your-project>/.claude/skills/abap-cli
cp -r agents/abap-developer.agent.md <your-project>/.claude/agents/abap-developer.agent.md
# 或 GitHub Copilot：
cp -r skills/ <your-project>/.github/skills/abap-cli
cp agents/abap-developer.agent.md <your-project>/.github/agents/abap-developer.agent.md
```

## 索引

### Skill（5 个 — 1 meta + 4 领域）

| skill | scope | 覆盖命令 | 一句话职责 |
|---|---|---|---|
| **`abap-cli`** | meta | （无命令，纯路由） | 入口路由层：根据用户意图分发到 4 个领域 skill；串联 `.github/skills/` 两层方法论 |
| **`abap-cli-setup`** | workspace-and-sap | `init` `profile` `doctor` `transport` `extension`（deploy/status） | 环境就绪：workspace 配置、profile 凭证、本地诊断、SAP 传输请求、ICF 服务部署 |
| **`abap-cli-search`** | sap（只读） | `search` `where-used` `inspect` `tcode` `diff` `status` | 元数据探查：纯只读命令集合；不改对象、不加锁、不写 transport |
| **`abap-cli-edit`** | sap（写） | `pull` `push` `check` `create` `activate` `create local` + DDIC 子集 | 写路径：所有会改 SAP 对象的命令；DDIC CRUD 与源码 CRUD 同源 |
| **`abap-cli-data`** | sap（只读消费） | `select` `run` | 对象运行时消费：对一个已存在对象做不修改数据的查询/执行 |

每个 skill 的内部结构：

```
skills/<name>/
├── SKILL.md                  # 入口（决策树 + 错误恢复）
├── references/
│   ├── commands-quick.md     # 本 skill 覆盖命令的完整速查
│   └── errors.md             # 本 skill 错误码全表（不含其他 skill 专属错误码）
├── scripts/                  # 可执行 .mjs 脚本（包装 abap-cli）
└── assets/                   # 模板文件
```

### Agent（编排 5 个 skill）

| agent | 角色 | 详细 |
|---|---|---|
| **`abap-developer`** | 端到端开发代理（9 步工作流 + 5 handoffs） | [abap-developer.agent.md](../agents/abap-developer.agent.md) |

### 路由表（`abap-cli` meta-skill 权威持有）

| 用户意图 | 唯一目标 skill | 触发命令 |
|---|---|---|
| 配置 / 接 SAP / 加 profile / 诊断 / 传输请求 / 部署 ICF | `abap-cli-setup` | `init` `profile` `doctor` `transport` `extension` |
| 查对象元数据 / where-used / 业务码 / 拉取对账 / 状态只读 | `abap-cli-search` | `search` `where-used` `inspect` `tcode` `diff` `status` |
| 拉对象 / 改 / 推 / 语法检查 / 激活 / 创建 | `abap-cli-edit` | `pull` `push` `check` `create` `activate` `create local` + DDIC 子集 |
| 跑类 / 查表 / 翻页 select | `abap-cli-data` | `select` `run` |
| 意图模糊 / 不确定归哪类 | `abap-cli`（meta） | （路由查询本身） |

> ⚠️ **`pull` 归 `abap-cli-edit`**（写路径的中间步骤），**`inspect` 归 `abap-cli-search`**（只读元数据，修复动作归 edit）。

### 错误码不重叠（硬性约束）

- `WRAPPER_NOT_DEPLOYED` / `TABLE_NOT_FOUND` / `LIMIT_EXCEEDED` / `TIMEOUT` — **仅** `abap-cli-data`
- `LOCK_FAILED` / `SYNTAX_ERROR` / `DDIC_NOT_SUPPORTED` / `INACTIVE_PARTS` — **仅** `abap-cli-edit`
- `OBJECT_NOT_FOUND` / `TCODE_NOT_FOUND` / `NOT_AUTHORIZED` — **仅** `abap-cli-search`
- `CONFIG_ERROR` / `TLS_ERROR` / `NO_TRANSPORT` / `ICF_CHECK_DEGRADED` — **仅** `abap-cli-setup`
- 公共错误（`INVALID_ARGUMENT` / `USAGE` 等）在涉及它的每个 skill 中各自内联完整描述，不做 cross-reference

## 命令覆盖核对（v0.3 — 5-skill）

- ✅ `abap-cli-setup`：`init` `profile` `doctor` `transport` `extension`（deploy/status）
- ✅ `abap-cli-search`：`search` `where-used` `inspect` `tcode` `diff` `status`
- ✅ `abap-cli-edit`：`pull` `push` `check` `create` `activate` `create local` + DDIC 子集
- ✅ `abap-cli-data`：`select` `run`
- ✅ `abap-cli`（meta）：路由层，**不**直接管命令

## 版本

- **CLI 版本**：`0.3.0`
- **本特性设计回顾**：见 wiki 顶层 `skill-restructure`
- **agentskills.io 标准**：<https://agentskills.io/>

## references

- 外部对标调研：`/memories/session/cli-skill-agent-plan.md`
- 项目 constitution：`.specify/memory/constitution.md`