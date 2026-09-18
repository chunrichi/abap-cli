---
name: abap-cli
description: abap-cli 用户的 agent 路由层 — 根据用户意图分发到 4 个领域 skill（abap-cli-setup / -search / -edit / -data）与 1 个方法论 skill（abap-cli-performance）；串联 .github/skills/ 两层通用 ABAP 方法论；并代理 2 个 agent 元命令（`feedback` 提交 issue / `report-stuck` 卡死本地 triage）。use when asking "这个查询该看哪个 skill" 或 agent 收到模糊意图需要先做路由决策；agent 自身做完一轮任务想提交反馈或遇到不可恢复卡死想留痕。
metadata:
  version: "0.2.8"
  scope: meta
  commands: [feedback, report-stuck]
---

# abap-cli — 入口路由层（meta-skill）

`scope: meta` — 这个 skill **不直接管领域命令**，做四件事：

1. **路由表**：把用户意图映射到唯一目标领域 skill（4 选 1）+ 1 个方法论 skill
2. **边界说明**：澄清与 `.github/skills/` 两层通用 ABAP 方法论的关系
3. **agent 元命令**：直接代理 2 个反馈链路命令（`feedback` / `report-stuck`），不依赖任何领域 skill
4. **意图模糊回退**：当其他 5 个 skill 都不命中时，本 skill 处理"该看哪个 skill"的问题

加载本 skill 后，**第一步是查路由表**；命中目标后，**只加载那一个领域 skill 的 SKILL.md 全文**，不要把 4 棵决策树都读进上下文。

## 路由表（权威）

| 用户意图 | 唯一目标 skill | 触发命令 |
|---|---|---|
| 配置 / 接 SAP / 加 profile / 诊断 / 传输请求 / 部署 ICF / 管理扩展 / 看 session | `abap-cli-setup` | `init` `profile` `doctor` `transport` `deploy` `extensions` `session` |
| 查对象元数据 / where-used / 业务码 / 拉取对账 / 状态只读 / 看 ST22 dump | `abap-cli-search` | `search` `where-used` `inspect` `tcode` `diff` `status` `dumps` |
| 拉对象 / 改 / 推 / 语法检查 / 激活 / 创建 / MIME / AFF 校验 | `abap-cli-edit` | `pull` `push` `check` `create` `activate` `create local` `mime` `validate:aff` |
| 跑类 / 查表 / 翻页 select | `abap-cli-data` | `select` `run` |
| ABAP 性能 review / 慢路径诊断 / 优化建议 | `abap-cli-performance` | （方法论 skill，不直接管命令） |
| Agent 提交反馈 / 卡死留痕（不依赖 SAP） | `abap-cli`（meta） | `feedback` `report-stuck` |
| 意图模糊 / 不确定归哪类 | `abap-cli`（meta） | （路由查询本身） |

> **同一命令唯一归属**：4 个领域 skill 的 `metadata.commands` 集合互不相交，并集 = 全部 19 个 CLI 命令（详见 `skills/README.md`）。
>
> **`abap-cli-performance` 例外**：它是方法论 skill，`metadata.commands` 列的是其**触发**的只读命令集合（`search / inspect / pull / check / select`），实际归属仍是上表 4 个领域 skill。本 skill 全程不写对象。

### 路由查询决策树

```
用户查询来了
├── 关键词含 "配置 / 接 / profile / 诊断 / 部署 / transport / 扩展 / session" → abap-cli-setup
├── 关键词含 "查询 / 哪些地方用 / 业务码 / 状态 / 差异 / dump" 且不含 "改 / 推 / 激活" → abap-cli-search
├── 关键词含 "拉 / 改 / 推 / 语法 / 激活 / 创建 / DDIC / MIME / AFF" → abap-cli-edit
├── 关键词含 "跑 / 查表数据 / select / run / 翻页" → abap-cli-data
├── 关键词含 "慢 / 性能 / 优化 / N² / FOR ALL ENTRIES / 内表 / HASHED / AMDP / CDS" → abap-cli-performance
├── 关键词含 "反馈 / bug / 反馈 issue / stuck / 卡死" → 本 meta skill（不走领域）
│   ├── 提交反馈给上游 → abap feedback --feature-key ... --title ... --description ... --json
│   └── 卡死留痕 → abap report-stuck --goal ... --tried ... --where ... --json
└── 模糊 / 无法分类 → 留在 abap-cli（meta），先问用户 1 个澄清问题，再路由
```

### `feedback`（提交 issue）

完成任务但发现 CLI 行为不对？提交给上游（spec P3.3 反馈服务）。**不需要 SAP 连接**（纯 HTTP），但需要网络；离线场景用 `report-stuck`。

```bash
abap feedback \
    --feature-key abap.push \
    --title "Push reports unclear error after syntax check" \
    --description "A valid class push fails after syntax check with no actionable detail." \
    --priority NORMAL \
    --session-id session-123 \
    --json

abap feedback --feature-key abap.cli --title "Example" --description "..." --dry-run --json   # 不真发，看请求体
```

| flag | 含义 | 必填 |
|---|---|---|
| `--feature-key <key>` | 稳定 feature / 功能标识 | ✅ |
| `--title <text>` | 简短标题 | ✅ |
| `--description <text>` | 纯文本观察（≤255 字符） | ✅ |
| `--priority <level>` | `LOW` / `NORMAL` / `HIGH` / `URGENT` | NORMAL |
| `--username <name>` | 业务用户名；默认 `$env:USERNAME` | — |
| `--email <address>` | 联系邮箱 | — |
| `--source-system <name>` | 调用客户端 / 系统名；默认 `abap-cli` | — |
| `--agent-id <id>` | agent / 产品标识 | — |
| `--session-id <id>` | 已完成的 agent session 标识 | — |
| `--idempotency-key <key>` | 稳定重试 key；缺省自动生成 | — |
| `--correlation-id <id>` | 追踪 ID（作 `X-Correlation-ID` header） | — |
| `--dry-run` | 校验 + 打印规范化请求，不真发 | false |

### `report-stuck`（卡死留痕）

任务卡死（SAP 端无响应、错误码无法恢复、agent 自己卡死）→ 写一份本地 JSON 报告留档供 offline triage。**完全离线**（无网络无 SAP）。

```bash
abap report-stuck \
    --goal "Create ZCL_ORDER class" \
    --tried "search ZCL_ORDER; pull ZCL_ORDER; check syntax; push --tr DEVK900001 --yes" \
    --where "abap push src/clas/zcl_order/zcl_order.clas.abap" \
    --json
```

| flag | 含义 | 必填 |
|---|---|---|
| `--goal <text>` | 目标（agent 想做什么） | ✅ |
| `--tried <text>` | 已尝试的动作 | ✅ |
| `--where <cmd>` | 卡死点（具体卡在哪条命令） | ✅ |

输出落在 CLI 配置目录下的 `stuck-reports/<ts>.json`；agent 后续可读这些报告聚类重复问题。

### 错误码（meta 专属）

| 错误 | 触发 | 修复 |
|---|---|---|
| `USAGE` (exit 2) | `feedback` / `report-stuck` 缺必填 | 看 `error.nextSteps` |
| `INVALID_ARGUMENT` (exit 2) | `--priority` / `--feature-key` 取值不合法 | 看 `error.nextSteps` |
| `VALIDATION_ERROR` (exit 7) | `feedback` 标题 / 描述超长 / 字段格式错 | 压缩 description（≤255 字符） |
| `CONFLICT` (exit 66, reserved) | 同 `--idempotency-key` 已发过 → 视为重复，**不**报错；返回上次结果 | 通常无影响 |
| `PERSISTENCE_ERROR` (exit 67, reserved) | `report-stuck` 写本地失败（权限 / 磁盘满） | 看 `error.nextSteps` 改 CLI 报告目录 |
| `HTTP_ERROR` (exit 68, reserved) | `feedback` 提交服务端错（5xx） | 等 1 分钟重试；或转用 `report-stuck` |
| `AUTH_ERROR` (exit 5) | `feedback` 服务端拒绝（认证） | 不太可能发生，bug 则上报 |

> ⚠️ **`pull` 归 `abap-cli-edit` 而非 `abap-cli-search`**：虽然 `pull` 写本地文件，但它是"修改 SAP 对象的中间步骤"（`pull → 编辑 → push`），归 edit 的写路径决策树。
>
> ⚠️ **`inspect` 归 `abap-cli-search` 而非 `abap-cli-edit`**：虽然 `inspect --activation` 暴露修复线索，但 `inspect` 本身**不**改对象，纯只读元数据探查。修复动作归 edit。

## 边界：与 `.github/skills/` 的关系

仓库有两套 `skills/`，**用途不同**，不能混用：

| 路径 | 谁用 | 关注点 |
|---|---|---|
| `.github/skills/abap-code-writing` | vibe_with_abap 仓库贡献者 | 6 步写代码流程（理解需求→探索系统→架构→研究→设计→写代码） |
| `.github/skills/clean-abap` | 同上 | 命名/语法/类设计/错误处理/测试的硬性规范 |
| `.github/skills/abap-research` 等 | 同上 | 元表心智模型 / SPRO / 性能 / ADT 端点 |
| **顶层 `skills/abap-cli-*`**（本目录） | **abap-cli 用户** | **CLI 命令路由**（哪些场景调哪些命令） |

**串联点**（由 `abap-developer.agent.md` 编排）：

- `abap-code-writing` 的 Step 1（理解需求）+ Step 3（架构分解）→ 对应 `abap-developer.agent.md` 的 Step 0
- `clean-abap` 的全清单 → 对应 `abap-developer.agent.md` 的 Step 5.5（推送前自审）
- 用户 workspace **无** `.github/skills/` 时，Step 0 / Step 5.5 是 no-op（agent 跳过而不报错）

## 通用规则

1. **永远先查路由表**：不要直接跳进领域 skill；模糊查询留在 meta
2. **路由唯一**：同一用户意图只命中一个领域 skill，不并发加载多个
3. **`.github/skills/` 不在用户机器上时不阻塞**：串联 Step 是 best-effort

## references（按需加载）

- 无：本 skill 是路由层，不含命令速查 / 错误码表

## scripts / assets

- 无：本 skill 不含可执行辅助脚本或模板

## 权威来源

- 仓库总索引：[`skills/README.md`](../README.md)
- 路由表的"数据视图"：4 个领域 skill 的 `metadata.commands`
- 端到端编排：[`agents/abap-developer.agent.md`](../../agents/abap-developer.agent.md)