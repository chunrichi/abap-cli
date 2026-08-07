---
type: command
title: abap activate
description: 激活一个对象的所有 inactive items（method/OSI 源层级），规避 root-URI 激活的静默 no-op
tags: [abap-cli, command, activate, activation, adt]
created at: 2026-08-07 00:21:57
changed at: 2026-08-07 00:28:14
---

# abap activate

激活一个对象的**所有 inactive items**（method/OSI 源层级）。命令入口在 `commands/activate.ts`（`registerActivateCommand`），批量激活走 `clients/adt-client.ts` 的 `activateAll`。

## 为什么存在（013 dogfooding 教训）

ADT 的 root-URI 级激活（只传对象根 URI）在真实 SAP 上可能**静默 no-op**：报告成功，但 method/OSI 子项仍停留在 inactive 状态。`abap activate` 先拉取系统 inactive 列表，筛出属于该对象的每一项，再**逐项批量激活**，确保真正生效。

## Usage

```bash
abap activate <object> [options]
```

## Options

- `<object>`: **SAP 对象名**（如 `ZCL_MY_CLASS`），不是本地文件名；经 `resolveObject`（ADT searchObject）解析为 objectUrl
- `--type <type>`: 对象类型（CLAS / PROG / INTF 等），用于同名多类型对象消歧（否则抛 `AMBIGUOUS_OBJECT`）
- `--yes`: 非交互环境确认（无 TTY 时必须提供）

## 执行流程

1. **非交互确认**：`!opts.yes && !process.stdin.isTTY` → 抛 `VALIDATION_ERROR`（exit 7），`nextSteps` 提示加 `--yes` 或先用 `abap inspect <object> --activation` 检查状态
2. 创建 `AdtClientWrapper`，`resolveObject(client, object, opts.type)` 解析对象 → `{ name, type, objectUrl }`
3. `client.inactiveObjects()` 拉取系统所有 inactive 项
4. **过滤（精确匹配）**：`uri.split('#')[0] === resolved.objectUrl` — method/OSI 项的 URI 带 `#fragment`，只比对对象部分；**不用前缀 `startsWith`**，避免 `ZCL_FOO_BAR` 被误判为属于 `ZCL_FOO`
5. 无匹配项 → 输出 `no inactive items to activate`（`activated: 0`）
6. 有匹配项 → 构造 `{ uri, type, name, parentUri }` 列表（`parentUri = uri.split('#')[0]`），调 `client.activateAll(items)` 批量激活
7. 输出 `Activated N inactive item(s) of <name>` 及 ADT 返回的 messages

## ADT 层细节（adt-client.ts）

- `activate(objectUrl, ...)` **总是用数组重载**：字符串重载会追加 `?context=main`，真实 SAP 对 program 和 class 拒绝并报 `User X is currently editing Y`
- `activateAll(items)`：每个 item 携带 `adtcore:uri/type/name/parentUri`，method/OSI 源层级批量激活

## 相关命令

- `abap inspect <object> --activation` — 只读检查激活状态（`ok` 为 true 表示每个 part 的 active source == latest）；推荐的激活前检查
- `abap deploy` — 内部 `activateAllParts()` 复用同一逻辑，部署后确保对象完全激活（否则后续 runClass 找不到方法），失败抛 `ACTIVATION_FAILED`

## Examples

```bash
# 先检查对象激活状态
abap inspect ZCL_MY_CLASS --activation

# 激活对象的所有 inactive items（非交互需 --yes）
abap activate ZCL_MY_CLASS --yes

# 同名多类型对象需 --type 消歧（如 ZFOO 既是 CLAS 又是 PROG）
abap activate ZFOO --type CLAS --yes
```

## Expected Output

无 inactive 项时：

```json
{
  "object": "ZCL_MY_CLASS",
  "activated": 0,
  "message": "no inactive items to activate"
}
```

激活成功时：

```json
{
  "object": "ZCL_MY_CLASS",
  "activated": 2,
  "messages": []
}
```

# More

## 错误码

| 场景 | 错误码 | 类别 / exit | 附带信息 |
|------|--------|-------------|----------|
| 非 TTY 且无 `--yes` | `VALIDATION_ERROR` | VALIDATION_ERROR / 7 | `nextSteps`：加 `--yes` 或先 `abap inspect <object> --activation` |
| 对象不存在 | `OBJECT_NOT_FOUND` | NOT_FOUND / 8 | `nextSteps`：`abap search <name>` 验证 |
| 同名多类型且未给 `--type` | `AMBIGUOUS_OBJECT` | VALIDATION_ERROR / 7 | `types` 列出候选，用 `--type` 消歧 |
| ADT 激活失败 | 透传底层错误 | — | `printError` 统一输出 |

## fixme

- 未发现专门的 `activate.test.ts`；相关批量激活逻辑只在 push/deploy 流程测试中间接覆盖，建议补单测（含精确匹配 `#fragment` 与同名前缀不误伤两个用例）

# references

- 实现：`src/abap_cli/commands/activate.ts`（`inactiveObjects` 收集 + `activateAll`）、`src/abap_cli/clients/adt-client.ts`（`activateAll`/`inactiveObjects`）
- 匹配规则：`uri.split('#')[0] === resolved.objectUrl`，避免同名前缀误伤（`ZCL_FOO` vs `ZCL_FOO_BAR`）
- SAP 后端：`deploy-flow.ts` 的 `activateAllParts`（013 dogfooding，规避 root-URI activate 静默 no-op）
- 文档：`docs/commands.md`（`abap activate` 一节）
