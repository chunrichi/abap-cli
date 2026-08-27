---
name: abap-cli-search
description: abap-cli 元数据探查（纯只读）— `search` 定位 / `where-used` 评估重构冲击 / `inspect` 查 metadata+activation+locks / `tcode` 查业务码 / `diff` 比较本地与 SAP / `status` 工作区对账。use when asking where an object lives / what uses an object / what state is an object in / what is the business code behind a tcode / what differs between local and SAP / what objects are in the workspace.
metadata:
  version: "0.3.0"
  scope: sap
  commands: [search, where-used, inspect, tcode, diff, status]
  tags: [read-only, no-lock, no-transport]
---

# abap-cli-search — 元数据探查（纯只读）

`sap scope` — 6 个只读命令集合。**不改对象、不加锁、不写 transport**，可反复调用。`pull`（虽写本地文件）是写路径的一部分，归 `abap-cli-edit`。

## 何时用

- 不知道对象在哪个包 → `search <name>`
- 改对象前评估冲击面 → `where-used <name>`
- 对象激活状态对不上 → `inspect <obj> --activation`（诊断线索；**修复**走 `abap-cli-edit` 的 `activate`）
- 谁持锁 / 元数据详情 → `inspect <obj> --locks` / `inspect <obj> --metadata`
- 业务码入口解析 → `tcode <code>`
- 推送前对账 → `status` 看本地 vs SAP 差异
- 局部小对比 → `diff <obj>` 看本地与 SAP 的具体行差

## 决策树

```
查 SAP 对象元数据？
├── 定位 → search [--package ...] [--type ...] <pattern>
├── 影响 → where-used <obj>
├── 详情 → inspect <obj>
│         ├── --metadata → 元数据（package / 描述 / 负责人 / 创建日期）
│         ├── --activation → method / OSI 激活状态
│         └── --locks → 谁持锁（**修复**走 abap-cli-edit 的 push/unlock）
├── 业务码 → tcode <code>
├── 推送前对账 → status
└── 单文件差异 → diff <obj>
```

## 错误恢复（本 skill 专属错误码）

| 错误 | 动作 |
|---|---|
| `OBJECT_NOT_FOUND` (exit 8) | `search <name>` 校对；缩写 / 包名 / 大小写重试 |
| `NOT_AUTHORIZED` (exit 5) | 用户无 `S_TCODE` / `S_ADT_RES` 等权限；跳 `abap-cli-setup` 跑 `profile test` |
| `TCODE_NOT_FOUND` (exit 8) | 业务码未在 TSTC；校对拼写 |
| `TCODE_NOT_AUTHORIZED` (exit 5) | 用户无 `S_TCODE`；换有权限用户 |
| `INVALID_ARGUMENT` (exit 2) | 看 `error.nextSteps` / `error.references` |
| `SAP_ERROR` (exit 6) | `data.objects[]` 看哪个失败；ICF 端未知错码时跳 `abap-cli-setup` 跑 `extension status` |

## 通用规则

1. **永远 `--json`**：`status` / `error.code` 分支
2. **可放心反复调用**：无副作用
3. **`inspect --activation` 是诊断，不修复**：发现 INACTIVE 跳 `abap-cli-edit` 的 `activate --yes`
4. **`inspect --locks` 是只读**：解锁 / 抢锁走 `abap-cli-edit`
5. **`diff` 与 `status` 关系**：`status` 列所有差异文件，`diff <obj>` 看单文件具体行差

## references（按需加载）

- [references/commands-quick.md](./references/commands-quick.md) — 6 命令完整速查
- [references/errors.md](./references/errors.md) — 本 skill 错误码全表