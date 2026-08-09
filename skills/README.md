# abap-cli skills

abap-cli 用户的 AI agent 上下文集合。**自包含**——分发时每个 skill 是 `SKILL.md + references/ + scripts/ + assets/` 的完整程序知识包，**不**依赖用户的 workspace 有 `wiki/` `docs/` `specs/` 副本。

## 分层边界（必读）

本仓库有两套 `skills/` `agents/`，**用途不同**：

| 路径 | 用途 | 谁用 | 随 npm 包分发？ |
|---|---|---|---|
| `.github/skills/` `abap-style/` `okf/` | 本仓库 AI 贡献者的元方法 | vibe_with_abap 开发者 | ❌ |
| `.github/agents/`（spec-kit、test-driver 等） | 本仓库工作流 | vibe_with_abap 开发者 | ❌ |
| **顶层 `skills/`（本目录）** | **abap-cli 用户的 agent 路由层** | **abap-cli 用户** | **❌（v1）** |
| **顶层 `agents/abap-developer.md`** | **abap-cli 用户的端到端开发代理** | **abap-cli 用户** | **❌（v1）** |

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
cp -r agents/abap-developer.md <your-project>/.claude/agents/abap-developer.md
# 或 GitHub Copilot：
cp -r skills/ <your-project>/.github/skills/abap-cli
cp agents/abap-developer.md <your-project>/.github/agents/abap-developer.md
```

## 索引

### Skill（按用户动作切，3 个）

| skill | 覆盖命令 | 触发场景 | 入口 |
|---|---|---|---|
| **`abap-setup`** | `config` `connection` `doctor` `transport` | 接入 / 诊断 / 传输请求 | [SKILL.md](./abap-setup/SKILL.md) |
| **`abap-edit`** | `search` `pull` `push` `check` `create` `activate` `inspect` `diff` `status` `sync` `create local` + DDIC 子集 | 改源码 / 推送 / 校验 | [SKILL.md](./abap-edit/SKILL.md) |
| **`abap-data`** | `select` `run` `deploy` | 看数据 / 跑类 / 部署 ICF | [SKILL.md](./abap-data/SKILL.md) |

每个 skill 的内部结构：

```
skills/<name>/
├── SKILL.md                  # 入口（决策树 + 错误恢复）
├── references/
│   ├── commands-quick.md     # 完整命令速查
│   ├── errors.md             # 错误码全表
│   └── workflow.md           # 详细工作流（变体）
├── scripts/                  # 可执行 bash 脚本（包装 abap-cli）
└── assets/                   # 模板文件
```

### Agent（编排 3 个 skill）

| agent | 角色 | 详细 |
|---|---|---|
| **`abap-developer`** | 端到端开发代理（handoffs 跳转 3 skill） | [abap-developer.md](../agents/abap-developer.md) |

## 命令覆盖核对（v1）

- ✅ `abap-setup` 覆盖：`config` `connection` `doctor` `transport`
- ✅ `abap-edit` 覆盖：`search` `pull` `push` `check` `create` `activate` `inspect` `diff` `status` `sync` `create local`
- ✅ `abap-data` 覆盖：`select` `run` `deploy`
- ❌ 不纳入（v1 决策）：`abap atc`（deprecated → `abap check --atc`）、`abap report-stuck`（反馈环命令）

## 版本

- **CLI 版本**：`0.7.0`
- **本特性 spec**：`specs/019-cli-skill-agent-bundle/spec.md`
- **agentskills.io 标准**：<https://agentskills.io/>

## references

- 外部对标调研：`/memories/session/cli-skill-agent-plan.md`
- 项目 constitution：`.specify/memory/constitution.md`