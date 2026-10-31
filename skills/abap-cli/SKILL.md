---
name: abap-cli
description: abap-cli 用户的 agent 路由层 — 根据用户意图分发到 4 个领域 skill（abap-cli-setup / -search / -edit / -data）与 1 个方法论 skill（abap-cli-performance）；并处理 agent 元任务：卡死用 `report-stuck` 本地留痕，CLI 反馈 / bug 直接提 GitHub issue（无内置命令）。use when asking "这个查询该看哪个 skill" 或 agent 收到模糊意图需要先做路由决策；agent 自身做完一轮任务想提交反馈或遇到不可恢复卡死想留痕。
metadata:
  version: "1.2.0"
  scope: meta
  commands: [report-stuck]
---

# abap-cli — 入口路由层（meta-skill）

`scope: meta` — 这个 skill **不直接管领域命令**，做四件事：

1. **路由表**：把用户意图映射到唯一目标领域 skill（4 选 1）+ 1 个方法论 skill
2. **边界说明**：说明与仓库本地技能（`.agents/skills/`）的关系（用户机器上不存在时跳过）
3. **agent 元任务**：卡死 → `abap report-stuck` 本地留痕；反馈 / bug → 直接建 GitHub issue（没有 CLI 命令）
4. **意图模糊回退**：当其他 5 个 skill 都不命中时，本 skill 处理"该看哪个 skill"的问题

加载本 skill 后，**第一步是查路由表**；命中目标后，**只加载那一个领域 skill 的 SKILL.md 全文**，不要把 4 棵决策树都读进上下文。

## 路由表（权威）

| 用户意图 | 唯一目标 skill | 触发命令 |
|---|---|---|
| 配置 / 接 SAP / 加 profile / 诊断 / 传输请求 / 部署 ICF / 看 session / 查类型映射 | `abap-cli-setup` | `init` `profile` `doctor` `transport` `deploy` `session` `types` |
| 查对象元数据 / where-used / 业务码 / 拉取对账 / 状态只读 / 看 ST22 dump | `abap-cli-search` | `search` `where-used` `inspect` `tcode` `diff` `status` `dumps` |
| 拉对象 / 改 / 推 / 语法检查 / 激活 / 创建 / 删除 / 列举 / MIME / AFF 校验 | `abap-cli-edit` | `pull` `push` `check` `create` `activate` `delete` `list` `mime` `validate:aff` |
| 跑类 / 查表 / 列表字段 / 跑报表 / 跑 ABAP Unit / 翻页 select | `abap-cli-data` | `select` `fields` `run` `run-report` `test` |
| ABAP 性能 review / 慢路径诊断 / 优化建议 | `abap-cli-performance` | （方法论 skill，不直接管命令） |
| Agent 卡死留痕（不依赖 SAP） | `abap-cli`（meta） | `report-stuck` |
| Agent 提交反馈 / bug | `abap-cli`（meta） | GitHub Issues（无 CLI 命令，见下） |
| 意图模糊 / 不确定归哪类 | `abap-cli`（meta） | （路由查询本身） |

> **同一命令唯一归属**：4 个领域 skill 的 `metadata.commands` 集合互不相交，合计 28 条；再加 meta 的 1 条（`report-stuck`），共 29 个 CLI 命令（详见 `skills/README.md`）。
>
> **`abap-cli-performance` 例外**：它是方法论 skill，不声明 `metadata.commands`；它触发的只读命令（`search / inspect / pull / check / select`）归属上表 4 个领域 skill。本 skill 全程不写对象。

### 路由查询决策树

```
用户查询来了
├── 关键词含 "配置 / 接 / profile / 诊断 / 部署 / transport / 扩展 / session" → abap-cli-setup
├── 关键词含 "查询 / 哪些地方用 / 业务码 / 状态 / 差异 / dump" 且不含 "改 / 推 / 激活" → abap-cli-search
├── 关键词含 "拉 / 改 / 推 / 语法 / 激活 / 创建 / DDIC / MIME / AFF" → abap-cli-edit
├── 关键词含 "跑 / 查表数据 / select / run / test / 单测 / ABAP Unit / 翻页" → abap-cli-data
├── 关键词含 "慢 / 性能 / 优化 / N² / FOR ALL ENTRIES / 内表 / HASHED / AMDP / CDS" → abap-cli-performance
├── 关键词含 "反馈 / bug / issue / 提 issue" → 本 meta skill → 建 GitHub issue（见下）
├── 关键词含 "stuck / 卡死" → 本 meta skill → abap report-stuck --goal ... --tried ... --where ... --json
└── 模糊 / 无法分类 → 留在 abap-cli（meta），先问用户 1 个澄清问题，再路由
```

### 提交反馈（GitHub Issues，无 CLI 命令）

CLI 行为不对 / 缺功能时，直接建 GitHub issue，**默认仓库 `chunrichi/abap-cli`**（用户明确指定别的仓库时优先用户指定）。不要再用已删除的反馈命令。

**先探测当前环境有什么能力，按优先级使用：**

1. **GitHub MCP / issue 工具**：工具列表里有创建 issue 的能力（如 `create_issue`）→ 直接调用，仓库 `chunrichi/abap-cli`。
2. **`gh` CLI**：`gh auth status` 成功 → `gh issue create --repo chunrichi/abap-cli --title "..." --body-file <file>`。
3. **`GITHUB_TOKEN` / `GH_TOKEN`**：调 GitHub REST `POST /repos/chunrichi/abap-cli/issues`。
4. **都没有 / 认证被拒**：不要反复重试；把预填链接交给用户手动提交，并明确说明 **未提交**：
   `https://github.com/chunrichi/abap-cli/issues/new?title=<urlencoded-title>&body=<urlencoded-body>`

**issue 正文模板**（缺什么写 unknown，不要编）：

- CLI 与 Node 版本：`abap --version`、`node -v`
- 失败命令的完整参数、期望 vs 实际、错误码 / 退出码（附 `--json` 错误信封更有用）
- 环境：on-prem / BTP、SAP release（与问题相关时）
- 最小复现步骤
- **脱敏**：不含密码、`.abap.json` 内容、业务数据、内网地址

连不上 GitHub 或需要离线留档时，用下面的 `report-stuck`。

### `report-stuck`（卡死留痕）

任务卡死（SAP 端无响应、错误码无法恢复、agent 自己卡死）→ 写一份本地 JSON 报告留档供 offline triage。**完全离线**（无网络无 SAP）。

```bash
abap report-stuck \
    --goal "Create ZCL_ORDER class" \
    --tried "search ZCL_ORDER; pull ZCL_ORDER; check syntax; push --tr DEVK900001 --yes" \
    --where "abap push src/zcl_order.clas.abap" \
    --json
```

| flag | 含义 | 必填 |
|---|---|---|
| `--goal <text>` | 目标（agent 想做什么） | ✅ |
| `--tried <text>` | 已尝试的动作 | ✅ |
| `--where <cmd>` | 卡死点（具体卡在哪条命令） | ✅ |

输出落在 `userConfigDir()/reports/STUCK-<ts>-<rand>.json`（即 `~/.abap-cli/reports/`）；agent 后续可读这些报告聚类重复问题。报告只存本地，不会自动上传——要同步上游就按上面的 GitHub issue 流程。

### 错误码（meta 专属）

meta 没有专属错误码：`report-stuck` 只用公共错误码。

| 错误 | 触发 | 修复 |
|---|---|---|
| `USAGE` (exit 2) | `report-stuck` 缺 `--goal` / `--tried` / `--where` | 补齐三个必填参数 |

> ⚠️ **`pull` 归 `abap-cli-edit` 而非 `abap-cli-search`**：虽然 `pull` 写本地文件，但它是"修改 SAP 对象的中间步骤"（`pull → 编辑 → push`），归 edit 的写路径决策树。
>
> ⚠️ **`inspect` 归 `abap-cli-search` 而非 `abap-cli-edit`**：虽然 `inspect --activation` 暴露修复线索，但 `inspect` 本身**不**改对象，纯只读元数据探查。修复动作归 edit。

## 边界

本 skill 只负责路由。仓库本地开发技能（`.agents/skills/`：`abap-style` / `abap-report-style` / `okf` / `abap-testing` / `repo-workflow`）属于本仓库贡献者的上下文，**不随 npm 包分发**；用户机器上不存在时直接跳过，不影响路由。

## 通用规则

1. **永远先查路由表**：不要直接跳进领域 skill；模糊查询留在 meta
2. **路由唯一**：同一用户意图只命中一个领域 skill，不并发加载多个
3. **仓库本地技能不阻塞**：`.agents/skills/` 不存在时跳过，不影响分发版路由

## references（按需加载）

- 无：本 skill 是路由层，不含命令速查 / 错误码表

## scripts / assets

- 无：本 skill 不含可执行辅助脚本或模板

## 权威来源

- 仓库总索引：[`skills/README.md`](../README.md)
- 路由表的"数据视图"：4 个领域 skill 的 `metadata.commands`
- 端到端编排：[`agents/abap-developer.agent.md`](../../agents/abap-developer.agent.md)
