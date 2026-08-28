---
name: abap-cli-edit
description: abap-cli 写路径 — 拉（`pull`）/ 推（`push`）/ 语法检查（`check`）/ 创建（`create` / `create local`）/ 激活（`activate`），含 DDIC CRUD（DOMA / DTEL / TABL / STRU 经 `pull --type` / `create --file` / `push *.json`）。use when asking how to change a SAP object / download an ABAP class / push a local file / run syntax check / create a new object / activate inactive parts / edit a DDIC definition.
metadata:
  version: "0.3.0"
  scope: sap
  commands: [pull, push, check, create, activate, "create local"]
  tags: [write, lock, transport, ddic]
---

# abap-cli-edit — 写路径（含 DDIC）

`sap scope` — 6 个写命令集合。**会改 SAP 对象、加编辑锁、写 transport**。DDIC 定义（DOMA / DTEL / TABL / STRU）的 CRUD 与源码 CLAS/INTF/PROG 共用同一组 `pull` / `create` / `push` 命令（DDIC 走 ICF 旁路而非 ADT），归此 skill 的同一棵决策树。

## 与 `.github/skills/` 的串联

写代码前先读 `.github/skills/abap-code-writing` 的 Step 1-3（理解需求 / 探索系统 / 架构分解）；推送前读 `.github/skills/clean-abap` 全清单自审。本 skill **只引用**这两份 skill 的入口，**不**复制其内容（用户机器上不一定有 `.github/skills/`，缺失时 `abap-developer.agent.md` 的对应 Step 是 no-op）。

## 何时用

- 首次进入项目，把已有对象（CLAS / PROG / INTF / FUGR / TABL）拉到本地编辑
- 创建新 ABAP 对象（class / interface / program / function group / table / structure / domain / data element）
- 编辑本地 `.abap` / `.json` 文件后推回 SAP（带 transport / 锁 / 激活）
- 推送前做语法检查 / 内容检查 / ATC 检查
- 对象激活状态对不上（`push` 报 activated 但实际未激活）时用 `inspect --activation` 诊断 + `activate` 修复
- 比较本地与 SAP 差异（`diff` / `status`）后再决定 pull 或 push——`diff` / `status` 在 `abap-cli-search`，本 skill 关注"差异确定后的拉/推动作"
- 显式编排 status → pull → push——CI 友好
- 离线起一份草稿（`create local`）再 push
- DDIC 定义 CRUD：`pull <name> --type DOMA|DTEL|TABL|STRU`、`create <type> <name> --file <json>`、`push <name>.<type>.json`

## 决策树

```
动一个 SAP 对象？
├── 已有 → [abap-cli-search] search → 必要时 where-used 评估冲击 → pull → 编辑 → check syntax → push
│         ├── push 报 activated 但未真激活？→ inspect --activation（[abap-cli-search]）→ activate --yes
│         └── 多文件？→ push --atomic
├── 新建 → [abap-cli-search] search 确认不存在 → create <type> <name> --package ... --tr ...
│         └── 离线草稿？→ create local → 编辑 → create ... --no-pull → push
└── 批量 → search --package → pull --package
    └── 链式？→ status → pull → push

DDIC 定义？
├── 拉 → pull <name> --type TABL|DOMA|DTEL|STRU
├── 改 → 编辑 <name>.<type>.json
└── 推 → push <name>.<type>.json --tr <tr>
```

## 推送前 checklist

`push` 是写操作。每次推送前：

1. **`check syntax`**：语法错会被激活拒绝
2. **transport 解析**：已绑定 / `$TMP` 无需 `--tr`；其余必填 `--tr` 或跳 `abap-cli-setup` 用 `transport` 解析脚本
3. **`--atomic`** 多文件必加：任一失败零写入
4. **`--dry-run`** 大改动前先看 plan
5. **`--json`**：解析信封，失败时看 `error.code`

## 错误恢复（本 skill 专属错误码）

| 错误 | 动作 |
|---|---|
| `OBJECT_NOT_FOUND` (exit 8) | `search <name>` 校对；`push` 不自动创建（创建走 `create`） |
| `OBJECT_EXISTS` (exit 2) | 改用 `pull` + `push`；不要重复 `create` |
| `LOCK_FAILED` (exit 9) | `inspect <obj> --locks`（[abap-cli-search]）查持有者；SE03 手动释放 |
| `ACTIVATION_FAILED` (exit 7) | `data.errors` 含行号；修复后重推 |
| `SYNTAX_ERROR` (exit 7) | `data.errors[]` 含 `{line, offset, severity, text}` |
| `NO_TRANSPORT` (exit 7) | 跳 `abap-cli-setup`：`transport list` / `transport create` → `--tr` 重试 |
| `DDIC_NOT_SUPPORTED` (exit 7) | 类型不在白名单（DOMA/DTEL/TABL/STRU 之外）；看 `abap create --schema` |
| `FILE_EXISTS` (exit 2) | `pull --overwrite` 或 `--skip-existing` |
| `TYPE_NOT_SUPPORTED` (exit 7) | `abap <cmd> --schema` 看支持列表 |
| `PUSH_FAILED` (exit 7) | `data.stage` 指示失败环节（lock/write/activate/unlock） |
| `INACTIVE_PARTS` (exit 6) | `inspect --activation`（[abap-cli-search]）诊断 → `activate --yes` 修复 |
| `INVALID_ARGUMENT` (exit 2) | 看 `error.nextSteps` / `error.references` |

## push 失败环节（`data.stage`）

| stage | 含义 | 典型错误 |
|---|---|---|
| `lock` | 获取编辑锁 | `LOCK_FAILED` |
| `write` | 写源码 | `SAP_ERROR` |
| `check` | 语法检查 | `SYNTAX_ERROR` |
| `activate` | 激活 | `ACTIVATION_FAILED` |
| `unlock` | 释放锁 | `UNLOCK_WARNING`（仅 `meta.warnings`，不阻断） |
| `ddic-icf` | DDIC JSON 写 | `INVALID_FIELD` / `MISSING_FIELD` |
| `textpool-adt` / `textpool-icf` | textpool 写 | 视 mode 而定 |

## 注入安全（DDIC）

1. **DDIC JSON 结构校验**：客户端走 `validateDdicObject`；命名空间 `Z`/`Y` 开头
2. **字段名白名单**：DDIC 字段先对照 `DD03L` 校验并大写归一化（复用 [abap-cli-search] 的同款校验）
3. **值绑定**：值经解析后声明为 ABAP 变量，**值永远不进 SQL / 写入文本**

## 通用规则

1. **永远 `--json`**：`status` / `error.code` 分支
2. **`check syntax` 默认对 SAP**：无副作用，可反复跑
3. **`--atomic` 防雪崩**：多文件必加
4. **`push` 报 activated 还要 `inspect --activation`（[abap-cli-search]）复核**：method / OSI 层级是 013 落地经验
5. **跨 skill**：`transport` 切到 `abap-cli-setup`；`search / inspect / diff / status` 切到 `abap-cli-search`

## references（按需加载）

- [references/commands-quick.md](./references/commands-quick.md) — 6 命令完整速查
- [references/errors.md](./references/errors.md) — 本 skill 错误码全表
- [references/workflow.md](./references/workflow.md) — DDIC / FUGR / textpool / stale 激活详细变体