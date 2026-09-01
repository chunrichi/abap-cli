---
name: abap-cli-performance
description: Review or improve ABAP performance through abap-cli. Use when diagnosing slow ABAP reads, loops, memory use, or mass processing while keeping ECC/S4HANA product evidence separate from HANA database evidence.
argument-hint: "Describe the ABAP code path, observed bottleneck, data volume, and available platform evidence"
user-invocable: true
metadata:
  version: "0.3.0"
  scope: abap-performance-review
  commands: [search, inspect, pull, check, select]
  tags: [read-only-first, no-mutation, no-transport]
---

# abap-cli-performance — ABAP 性能 review

`abap-performance-review` scope — 本 skill **不直接管命令**，而是给 agent 一套方法论：先**量**瓶颈、再**改**代码、最后**核验**，全程 ECC / S/4HANA 产品证据与 HANA 数据库证据**分开**记录。

触发本 skill 的典型意图：

- "这段 ABAP 跑得很慢，帮我看哪里能优化"
- "SELECT 是不是应该走 CDS 视图 / AMDP？"
- "FOR ALL ENTRIES 在我们系统上要不要去重？"
- "LOOP 里查表是不是要拆 HASHED？"
- "检查这段代码是否有 N² 复杂度"

> **本 skill 只读**：调查阶段一律 `abap ... --json` + `--json` 收集证据；不直接 `push` / `activate` / `create` / `transport`。所有写操作必须 handoff 到 [`abap-cli-edit`](../abap-cli-edit/SKILL.md)。

## 平台证据（首要原则）

**产品类型 ≠ 数据库类型**——两者必须分开记录：

| 证据类型 | 能证明的事实 |
|---|---|
| 系统所有者 / 验证后的系统 API 返回的明确 S/4HANA 产品标识 | 系统运行在 HANA 上 |
| 明确的 ECC 产品标识 | 产品是 ECC；其数据库**仍然未知**（ECC 也可跑在 HANA 上） |
| ADT 协议版本、ADT discovery 能力、ABAP 语言 / release 版本 | 仅能力提示；**不**证明 ECC / S/4HANA / HANA / 传统数据库 |
| 无明确产品 / 数据库证据 | 两个分类都未知，仅适用下文"基线规则" |

禁止从以下任一项推断数据库行为：
- 对象名 / 端点是否存在
- textpool 能力探测
- ABAP release 版本号

当前 abap-cli 命令**未暴露**已验证的产品或数据库标识——遇到此情况必须在 review 记录里写明证据来源与不确定度。

## 基线规则（适用于所有 ABAP 平台）

1. **先复现 / 先量后改**：建立慢路径的输入体量，**不要**优化没观测到的问题
2. **只读必要的字段与最严格可验证的过滤**，避免无界数据读
3. **消除循环里的数据库调用**：使用已验证的集合读 / 有界 lookup table（保留语义）
4. **按访问模式选内表类型**：`HASHED` 唯一键读多 / `SORTED` 键或范围访问 / `STANDARD` 小或顺序数据
5. **避免意外 O(n²)**：嵌套全扫描、字符串反复增长、相同数据的重复转换
6. **授权检查放在贵读前**；改实现时保留异常、事务、显示行为
7. **改完后必须核验**：
   - `abap check <file> --json`（语法）
   - `abap check atc <file> --variant <var> --json`（若 ATC variant 已知）
   - 用代表性、非敏感数据量确认运行时行为

## 决策树（路由）

```
已知慢对象 / 报告？
├── 否
│   └── 加载 abap-cli-search 定位所有者与直接依赖（references/commands-quick.md）
├── 是
│   └── abap-cli-search: search → inspect → pull 读受影响路径
├── 需要数据形状事实？
│   └── abap-cli-search: inspect 确认 DDIC → 必要时 abap-cli-data: select 跑有界读
├── 平台证据明确为 S/4HANA？
│   └── 应用下方"HANA 考量"
└── 产品 / 数据库证据缺失或仅版本派生？
    └── 应用"基线规则"；不选 HANA / 传统数据库特定的重写
```

## HANA 考量

**仅在**有明确 S/4HANA 或独立验证的 HANA 证据时使用：

- 把大过滤、聚合、排序、join 下推到 Open SQL 或**已有**的 CDS 视图（前提：减少传输数据且保留语义）
- 优先**已有 CDS 视图**承载可复用数据模型，再考虑新 AMDP；AMDP 是非可移植专项选项，需要 Open SQL/CDS 确实不足的具体证据
- 不要把每个小 ABAP 循环都改写成 SQL：业务分支、授权检查、内存小转换留在 ABAP 通常更清楚

## 传统数据库考量

**仅在**有独立验证的非 HANA 数据库证据时使用：

- 保持数据库请求的选择性，避免每行查询；评估简单 join 或已验证的 lookup-table 策略哪个往返成本更低
- 检查 `FOR ALL ENTRIES` 驱动表是否为空；只在结果语义允许时去重
- 不要假设 buffering 生效：依赖 `SELECT SINGLE` 当 buffered 读前，先确认表与访问路径

## Review 记录（输出格式）

每次 review 必须给出一段**结构化结论**，覆盖：

1. **受影响对象与代码路径**（含对象类型 / 包 / 入口 method）
2. **观察到的或预期的输入体量**（行数 / 调用频率）
3. **已证明的瓶颈**（不是猜的——测量出处要写明）
4. **平台证据与来源**（明确产品类型、明确 / 未知的数据库分类）
5. **保留行为的改法**（具体 code patch / 配置变更，列出文件与变更点）
6. **核验结果**：`abap check` / `abap check atc` 的 JSON 信封状态、运行时观察

平台分类未知时**明确写"unknown"**，不要用版本号或 release 时间填进去。

## Handoff 规则

| 情况 | 加载 |
|---|---|
| 所有者 / 直接依赖 / 事务 / 错误 / DDIC 结构尚不清楚 | [`abap-cli-search`](../abap-cli-search/SKILL.md) |
| 准备 pull / 编辑 / push / check / activate | [`abap-cli-edit`](../abap-cli-edit/SKILL.md) |
| 跑有界数据 / 验证 classrun 输出 | [`abap-cli-data`](../abap-cli-data/SKILL.md) |
| profile / 连接失败 / transport 问题 | [`abap-cli-setup`](../abap-cli-setup/SKILL.md) |
| 模糊意图 / 不知归哪 | [`abap-cli`](../abap-cli/SKILL.md)（meta 路由） |

## 通用规则

1. **永远 `--json`**：分支判断只看 `status` / `error.code` / `data`
2. **可反复只读**：调查阶段不写 transport / 不加锁
3. **patch 验证必须**：`abap check <file>` 返回 `status: success` 才算改完
4. **不要让 `--pretty-json` 干扰解析**：性能脚本只在 `--json` 下稳定
5. **本 skill 不替代 `clean-abap`**：本 skill 关注性能面，clean-abap 关注命名 / 错误处理 / 测试覆盖

## references（按需加载）

- [references/commands-quick.md](./references/commands-quick.md) — 本 skill 触发的命令速查（与 `abap-cli-search` / `-edit` / `-data` 对齐）

## scripts / assets

- 无（性能 review 是方法论 + handoff，不含 CLI 包装脚本）

## 权威来源

- 仓库索引：[`skills/README.md`](../README.md)
- 入口路由：[`skills/abap-cli/SKILL.md`](../abap-cli/SKILL.md)
- 端到端编排：[`agents/abap-developer.agent.md`](../../agents/abap-developer.agent.md)