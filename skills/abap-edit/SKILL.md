---
name: abap-edit
description: abap-cli 源码对象完整生命周期 — `search` / `pull` / `push` / `check` / `create` / `activate` / `inspect` / `diff` / `status` / `sync` / `create local`，覆盖 CLAS / PROG / INTF / FUGR 源码对象以及 DOMA / DTEL / TABL / STRU DDIC 定义。use when asking how to edit SAP source code / download an ABAP class / push a local file / run syntax check or ATC / create a new object / activate inactive parts / inspect metadata / diff local vs SAP / sync status.
metadata:
  version: "0.7.0"
  scope: sap
  commands: [search, pull, push, check, create, activate, inspect, diff, status, sync, "create local"]
---

# abap-edit — 源码对象完整生命周期

`sap scope` — 这 11 个命令（或子命令）走 SAP 系统的 ADT REST API 或自建 ICF 服务，覆盖源码对象从搜索、创建、下载、编辑、校验、推送、激活到对账的全流程。**DDIC 定义**（DOMA / DTEL / TABL / STRU）的 CRUD 通过 `pull --type` / `create --file` / `push *.json` 进入本 skill 同一套流程。

## 何时用

- 首次进入项目，把已有对象（CLAS / PROG / INTF / FUGR）拉到本地编辑
- 创建新 ABAP 对象（class / interface / program / function group）
- 编辑本地 `.abap` / `.json` 文件后推回 SAP（带 transport / 锁 / 激活）
- 推送前做语法检查 / 内容检查 / ATC 检查
- 对象激活状态对不上（`push` 报 activated 但实际未激活）时用 `inspect --activation` 诊断 + `activate` 修复
- 比较本地与 SAP 差异（diff / status）后再决定 pull 或 push
- 一次性跑完 status / pull / push（`sync`）——CI 友好
- 离线起一份草稿（`create local`）再 push
- DDIC 定义 CRUD：`pull <name> --type DOMA|DTEL|TABL|STRU`、`create <type> <name> --file <json>`、`push <name>.<type>.json`

## 决策树（典型任务）

```
改 SAP 上的对象？
├── 已有 → search → pull → 编辑 → check --syntax → push
│         ├── push 报 activated 但未真激活？→ inspect --activation → activate --yes
│         └── 多文件？→ push --atomic
├── 新建 → search 确认不存在 → create <type> <name> --package ... --tr ...
│         └── 离线草稿？→ create local → 编辑 → create ... --no-pull → push
└── 批量 → search --package → pull --package
    └── 链式？→ sync --pull / --push

DDIC 定义？
├── 拉 → pull <name> --type TABL|DOMA|DTEL|STRU
├── 改 → 编辑 <name>.<type>.json
└── 推 → push <name>.<type>.json --tr <tr>
```

## 推送前 checklist

`push` 是写操作。每次推送前：

1. **`check --syntax`**：语法错会被激活拒绝
2. **transport 解析**：已绑定 / `$TMP` 无需 `--tr`；其余必填 `--tr` 或调 [abap-setup 的 resolve-transport.sh](../abap-setup/scripts/resolve-transport.sh)
3. **`--atomic`** 多文件必加：任一失败零写入
4. **`--dry-run`** 大改动前先看 plan
5. **`--json`**：解析信封，失败时看 `error.code`

## 错误恢复

| 错误 | 动作 |
|---|---|
| `OBJECT_NOT_FOUND` (exit 8) | `search <name>` 校对；`push` 不自动创建（创建走 `create`） |
| `OBJECT_EXISTS` (exit 2) | 改用 `pull` + `push`；不要重复 `create` |
| `LOCK_FAILED` (exit 9) | `inspect <obj> --locks` 查持有者；SE03 手动释放 |
| `ACTIVATION_FAILED` (exit 7) | `data.errors` 含行号；修复后重推 |
| `SYNTAX_ERROR` (exit 7) | `data.errors[]` 含 `{line, offset, severity, text}` |
| `NO_TRANSPORT` (exit 7) | 用 [abap-setup 的 resolve-transport.sh](../abap-setup/scripts/resolve-transport.sh) |
| `DDIC_NOT_SUPPORTED` (exit 7) | 类型不在白名单（DOMA/DTEL/TABL/STRU 之外）；看 `abap create --schema` |
| `FILE_EXISTS` (exit 2) | `pull --overwrite` 或 `--skip-existing` |
| `TYPE_NOT_SUPPORTED` (exit 7) | `abap <cmd> --schema` 看支持列表 |
| `PUSH_FAILED` (exit 7) | `data.stage` 指示失败环节（lock/write/activate） |
| `INACTIVE_PARTS` (exit 6) | `inspect --activation` 诊断 → `activate --yes` 修复 |
| `INVALID_ARGUMENT` (exit 2) | 看 `error.nextSteps` |

## 通用规则

1. **永远 `--json`**：`status` / `error.code` 分支
2. **`check --syntax` 默认对 SAP**：无副作用，可反复跑
3. **`--atomic` 防雪崩**：多文件必加
4. **`push` 报 activated 还要 `inspect --activation` 复核**：method/OSI 层级是 013 落地经验
5. **DDIC JSON 结构校验**：客户端走 `validateDdicObject`；命名空间 `Z`/`Y` 开头
6. **跨 skill**：transport 切到 `abap-setup`；跑/查数据切到 `abap-data`

## references（按需加载）

- [references/commands-quick.md](./references/commands-quick.md) — 11 命令完整速查
- [references/errors.md](./references/errors.md) — 错误码全表
- [references/workflow.md](./references/workflow.md) — 详细工作流（type/transport/包/批量变体）
- 权威来源：
  - <https://github.com/SAP/abap-cli/blob/main/wiki/commands/pull.md>
  - <https://github.com/SAP/abap-cli/blob/main/wiki/commands/push.md>
  - <https://github.com/SAP/abap-cli/blob/main/wiki/commands/check.md>
  - <https://github.com/SAP/abap-cli/blob/main/wiki/commands/create.md>
  - <https://github.com/SAP/abap-cli/blob/main/wiki/commands/search.md>
  - <https://github.com/SAP/abap-cli/blob/main/wiki/commands/activate.md>
  - <https://github.com/SAP/abap-cli/blob/main/docs/commands.md>

## assets / scripts

- [scripts/validate-push.sh](./scripts/validate-push.sh) — 推送前 dry-run + check 校验
- [scripts/inspect-activation.sh](./scripts/inspect-activation.sh) — 诊断 + 修复 stale 激活
- [assets/.abapignore.template](./assets/.abapignore.template) — push --all 时跳过规则样板