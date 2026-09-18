---
name: abap-cli-edit
description: abap-cli 写路径 — 拉（`pull`）/ 推（`push`）/ 语法检查（`check`）/ 创建（`create` / `create local`）/ 激活（`activate`）/ MIME Repository CRUD（`mime create` / `mime delete` / `mime push`）/ AFF 校验（`validate:aff`），含 DDIC CRUD（DOMA / DTEL / TABL / STRU）与 ICF/SICF 服务节点（类型码 `HTTP`），经 `pull --type` / `create --file` / `push *.json`。use when asking how to change a SAP object / download an ABAP class / push a local file / run syntax check / create a new object / activate inactive parts / edit a DDIC definition / create or edit an ICF SICF HTTP service node / upload or delete MIME resources in SE80 / validate an AFF canonical JSON before pushing / which object types the CLI supports.
metadata:
  version: "0.2.6"
  scope: sap
  commands: [pull, push, check, create, activate, "create local", mime, "validate:aff"]
  tags: [write, lock, transport, ddic, http, sicf, mime, aff]
---

# abap-cli-edit — 写路径（含 DDIC + MIME + AFF 校验）

`sap scope` — 6 个写命令集合 + 2 个写辅助。`mime` 走自建 ICF handler `dispatch_mime`（依赖 `deploy`），`validate:aff` 是纯本地（ajv + Draft 2020-12）写盘前 gate（**不进 SAP**）。DDIC 定义（DOMA / DTEL / TABL / STRU）的 CRUD 与源码 CLAS/INTF/PROG 共用同一组 `pull` / `create` / `push` 命令（DDIC 走 ICF 旁路而非 ADT），归此 skill 的同一棵决策树。

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
- DDIC 定义 CRUD：`pull <name> --type DOMA|DTEL|TABL|STRU`、`create <type> <name> --file <json>`、`push <name>.<type>.json`。TABL/STRU 现在遵循 abap-file-format 三件套（`--file` 指向 main `.tabl.json` + 同目录 `.tabl.ddic` + 可选 `.tabl.settings.json`）；只有 main JSON 时回落 014 legacy wire-flat（详见 workflow.md 变体 2）。**写新 TABL/STRU 时直接 `cp` [assets/tabl-templates](./assets/tabl-templates/README.md) 里的 DDL 骨架**（5 个场景：透明表 / include / 货币金额 / 数量单位 / STRU），别凭空写 `@AbapCatalog.*` 注释
- 上传 UI 资产（JavaScript / CSS / 图片 / 模板）到 SAP MIME Repository（SE80）→ `mime create / push`；删 MIME 目录走 `mime delete --recursive`
- 写盘前用官方 AFF schema 严格校验本地 JSON（CLAS / INTF / PROG / FUGR / TABL / STRU / DOMA / DTEL / HTTP / TRAN / TTYP / MSAG / DDLS）→ `validate:aff <file-or-dir> --json`（纯本地 ajv + Draft 2020-12，**不进 SAP**；CI / pretest gate）

## 决策树

```
动一个 SAP 对象？
├── 已有 → [abap-cli-search] search → 必要时 where-used 评估冲击 → pull → 编辑 → check syntax → push
│         ├── push 报 activated 但未真激活？→ inspect --activation（[abap-cli-search]）→ activate --yes
│         └── 多文件？→ push --atomic
├── 新建 → [abap-cli-search] search 确认不存在 → create <type> <name> --package ... --tr ...
│         └── 离线草稿？→ create local → 编辑 → create ... --no-pull → push
├── 批量 → search --package → pull --package
│   └── 链式？→ status → pull → push
└── 拉 transport 内全部对象（跨开发同步 / 接手别人工作）→ pull --tr <request>
    └── 一次性按 transport 详情 + 嵌套 task 去重拉取，按 type 路由；单对象失败不中断（data.partial: true）

DDIC 定义？
├── TABL/STRU 拉 → pull <name> --type TABL|STRU                # 落三件套 (.tabl.json + .tabl.ddic [+ .tabl.settings.json])
├── TABL/STRU 改 → 编辑 .tabl.ddic（DDL 源真值）；设置编辑 .tabl.settings.json
├── TABL/STRU 建 → write 三件套 → create <type> <name> --file <name>.tabl.json --package ... --tr ...
├── TABL/STRU 推 → push <name>.tabl.json --tr <tr>             # main 文件即可；同目录三件套一起推
├── DOMA/DTEL 拉 → pull <name> --type DOMA|DTEL                # 落单文件 wire-flat
├── DOMA/DTEL 改 → 编辑 <name>.<type>.json（顶层 name / dataType / length / description / domain）
└── DOMA/DTEL 推 → push <name>.<type>.json --tr <tr>

ICF / SICF 服务节点？→ 类型码是 HTTP，不是 SICF
├── 拉 → pull <name> --type HTTP                               # 落 http/<name>.http.json
├── 建 → 写 .http.json → create HTTP <name> --file <path> --package ... --tr ...
└── 推 → push <name>.http.json --tr <tr>

MIME Repository（SE80 / UI 资产）？
├── 建目录 → mime create /<path> --package $TMP --yes   # 非 TTY 必填 --yes
├── 传文件 → mime push ./dist --root /zntf_ui/assets ----tr <request> --yes
└── 删目录 → mime delete /<path> [--recursive] --tr <request> --yes

AFF 写盘前 gate（纯本地，不进 SAP）
├── 单文件 → validate:aff <file>.tabl.json --json
├── 目录递归 → validate:aff test/fixtures/ --json   # 默认路径；用于 pretest
└── 多路径 → validate:aff test/fixtures/ --wire tmp/s4h/wire/ --json   # 同时扫 fixture + wire
```

## 支持的对象类型（权威列表）

写命令认下面 **13 个**类型码（`SRVB` 仅 pull）。19 个类型全集（含 CDS 与 RAP 6 类 metadata 跟 `TRAN` / `SRVB` 的特例）见 [abap-cli wiki object-types](https://github.com/chunrichi/abap-cli/blob/main/wiki/object-types.md)；本节只列**写路径能力**。

| 类型码 | 对象 | 路由 | `create` | `pull` | `push` | `create local` |
|---|---|---|---|---|---|---|
| `CLAS` / `INTF` / `PROG` / `FUGR` | 源对象 | ADT | ✅ | ✅ | ✅ | ✅ |
| `TABL` / `STRU` | 表 / 结构 | ICF | ✅ | ✅ | ✅ | ❌（`TYPE_NOT_SUPPORTED`） |
| `DOMA` / `DTEL` | 域 / 数据元素 | ICF | ✅ | ✅ | ✅ | ❌（`TYPE_NOT_SUPPORTED`） |
| `TTYP` | 表类型 | ADT（ECC EHP6 走 ICF fallback） | ✅ | ✅ | ✅ | ❌（`TYPE_NOT_SUPPORTED`） |
| `MSAG` | 消息类 | ADT（ECC EHP6 走 ICF fallback） | ✅ | ✅ | ✅ | ❌（`TYPE_NOT_SUPPORTED`） |
| `DDLS` | CDS 视图源 | ADT（仅） | ✅ | ✅ | ✅ | ❌（`TYPE_NOT_SUPPORTED`） |
| `HTTP` | **ICF / SICF 节点** | ICF | ✅（须 `--file`） | ✅ | ✅ | ❌（`TYPE_NOT_SUPPORTED`） |
| `TRAN` | 事务码 (SE93) | ICF | ✅（须 `--file`） | ✅ | ✅ | ❌（`TYPE_NOT_SUPPORTED`） |

> `create` 的 `--file` 是 **registry 数据驱动**的必填项（`ObjectTypeEntry.requiresFile`），对 `TABL` / `STRU` / `DOMA` / `DTEL` / `HTTP` / `TRAN` / `TTYP` / `MSAG` / `DDLS` 都适用；缺 `--file` 报 `USAGE`（exit 2），且该检查在写确认提示**之前**。`HTTP` 已没有"无 `--file` 落本地骨架"的旧路径（032 US10 行为已删除）。
>
> `create local` 只支持 **`CLAS` / `INTF` / `PROG` / `FUGR`**（`formats/templates.ts` 只有这四类模板），其余类型一律 `TYPE_NOT_SUPPORTED`（exit 7）。`TTYP` / `MSAG` / `DDLS` 要起草稿就手写（或 `pull` 一份）AFF JSON 后走 `create --file`，别指望 `create local`。

### 仅 pull（不能 create / push / create local）

| 类型码 | 对象 | 路由 | 备注 |
|---|---|---|---|
| `SRVB` | Service Binding metadata | ADT | SAP GUI 管理；pull 写 `<name>.srvb.json` |

### CDS / RAP 扩展（写路径能力与 FUGR 一致；走 child-lock + activate）

`SRVD` / `DCLS` / `DDLX` / `DDLA` — 这四类支持 `create / pull / push`（`create` 走 `--file` 必填 + companion `.acds` sidecar，pull/push 文件布局与 FUGR 平行：child-lock + parent activate）。**`create local` 不支持**（同样 `TYPE_NOT_SUPPORTED`）。**`BDEF` 是 pull-only**：SAP 不接受 CLI 创建 BDEF，所以只有 `pull / push`，`create` 在 schema 里仍作为 `allowedValues` 暴露但报 `TYPE_NOT_SUPPORTED`。详细见 [abap-cli wiki object-types](https://github.com/chunrichi/abap-cli/blob/main/wiki/object-types.md) 与各命令 schema。

### 关键说明

- **ICF 通道类型**（`TABL` / `STRU` / `DOMA` / `DTEL` / `HTTP` / `TRAN`）依赖内置 ICF 服务已部署——失败先跳 `abap-cli-setup` 跑 `deploy status`。`TTYP` / `MSAG` 在旧内核（ECC EHP5/6）也降级走同一 ICF 服务；`DDLS` 无兜底。
- **`TTYP` / `MSAG` / `DDLS`**（0.2.5 036 spec）：envelope 多 `data.channel: 'adt' | 'icf'` 与 `data.fallbackReason: 'ECC_EHP6_NO_ADT_TABLETYPE'` / `'ECC_EHP6_NO_ADT_MESSAGECLASS'`；ECC EHP5/6 自动降级 ICF；`DDLS` ECC 旧内核硬错 `DDLS_NOT_SUPPORTED_ON_ECC`（exit 64），不静默降级。
- **DDIC 三件套（TABL/STRU）**：`--file` 指向 main `.tabl.json`，CLI 自动读同目录 `.tabl.ddic`（DDL 真值）与可选 `.tabl.settings.json`；详见下方 TABL vs STRU 注解差异。
- **`create` 的未知类型报错已由 registry 驱动**：会列出全部 19 个注册类型码，无需再记住"哪些没被列进文案"。真正受限的是 `create local`（只 CLAS/INTF/PROG/FUGR）。

### 错误码全集（本 skill 涉及）

| 错误 | 触发场景 | 修复 |
|---|---|---|
| `DDIC_NOT_SUPPORTED` (exit 7) | 类型不在白名单（13 类之外） | 看 [GitHub wiki/object-types.md](https://github.com/chunrichi/abap-cli/blob/main/wiki/object-types.md) 类型表 |
| `DDLS_NOT_SUPPORTED_ON_ECC` (exit 64) | DDLS 在 ECC EHP5/6 | 不可降级；需升级到 ECC EHP7+ 或 S/4HANA |
| `CHANNEL_DETECTION_FAILED` (exit 65) | profile 缺 systemVersion，channel-detect 拿不到 release | 跑 `profile test` 重读 release |
| `TYPE_NOT_SUPPORTED` (exit 7) | 类型不在白名单（13 类之外） | 看 [GitHub wiki/object-types.md](https://github.com/chunrichi/abap-cli/blob/main/wiki/object-types.md) 类型表 |
| `OBJECT_NOT_FOUND` (exit 8) | 类型码传错（如 `--type SICF` 应为 `HTTP`） | 改用 `HTTP` 类型码；老 `SICF` 自动映射 + deprecation warning |

HTTP 服务（SICF 节点）的文件契约与完整示例见 [references/workflow.md](references/workflow.md) 变体 12。

## TABL vs STRU（DDL 注解差异）

`@AbapCatalog.*` 注释里**只有 TABL 适用**——给 STRU 写会过 DDL 解析但语义无意义，AGENTS / 测试不会拦。下列差异在 DDL 写错时常撞上：

| 注解 / 字段 | TABL | STRU |
|---|---|---|
| `define` 关键字 | `define table <name>` | `define structure <name>` |
| `@AbapCatalog.deliveryClass : #A/C/L/...` | ✅ 必填 | ❌ 写了无意义 |
| `@AbapCatalog.enhancement.category : #NOT_EXTENSIBLE` | ✅ 通常写 | ❌ |
| `@AbapCatalog.tableCategory : #TRANSPARENT` | ✅ 必填 | ❌ |
| `@AbapCatalog.dataMaintenance : #RESTRICTED` | ✅ 通常写 | ❌ |
| `.tabl.settings.json` | 可选 | ❌ 不要写（SAP 不为 STRU 产生 settings） |
| `key client : abap.clnt not null;` | ✅ 业务主键 | ❌ 不需要 key |
| `key <business_field>` | 主键 | 不需要 |
| `@Semantics.*` | 适用 | 适用（语义注解同样有效） |

CLI 解析器（[tabl-artifact.ts:parseTablDdic](https://github.com/chunrichi/abap-cli/blob/main/src/abap_cli/formats/ddic/tabl-artifact.ts)）按 `define table|structure` 自动分流；不会强制检查上述「TABL-only 注解出现在 STRU」的反模式，所以**写错是 silent 的**。直接 cp [assets/tabl-templates/structure-basic](./assets/tabl-templates/structure-basic/README.md) 骨架最稳。

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
| `OBJECT_NOT_FOUND` (exit 8) | `search <name>` 校对；`push` 不自动创建（创建走 `create`）。**也可能是类型码写错**（如 `--type SICF` 应为 `HTTP`）——未知类型会被静默降级成这个错 |
| `OBJECT_EXISTS` (exit 2) | 改用 `pull` + `push`；不要重复 `create` |
| `LOCK_FAILED` (exit 9) | `inspect <obj> --locks`（[abap-cli-search]）查持有者；SE03 手动释放 |
| `ACTIVATION_FAILED` (exit 7) | `data.errors` 含行号；修复后重推 |
| `SYNTAX_ERROR` (exit 7) | `data.errors[]` 含 `{line, offset, severity, text}` |
| `NO_TRANSPORT` (exit 7) | 跳 `abap-cli-setup`：`transport list` / `transport create` → `--tr` 重试 |
| `DDIC_NOT_SUPPORTED` (exit 7) | 类型不在白名单（DOMA/DTEL/TABL/STRU 之外）；看上方类型表 |
| `FILE_EXISTS` (exit 2) | `pull --overwrite` 或 `--skip-existing` |
| `TYPE_NOT_SUPPORTED` (exit 7) | 以上方类型表为准；未知类型的报错已列出全部 19 个注册类型。`create local` 只支持 CLAS/INTF/PROG/FUGR |
| `PUSH_FAILED` (exit 7) | `data.stage` 指示失败环节（lock/write/activate/unlock） |
| `HTTP_CREATE_FAILED` (exit 6) | HTTP 服务（SICF 节点）写失败；看 `error.details`，校对 handlerClass / url / 父节点是否存在 |
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
| `ddic-icf` | 所有 ICF/通道 JSON 推送的统一进入 stage（DDIC / HTTP / TRAN / TTYP / MSAG / DDLS；`--dry-run` 的 `plan` 也含它） | 视类型而定（DDIC: `INVALID_FIELD` / `MISSING_FIELD`；HTTP: `HTTP_CREATE_FAILED`；TRAN: `TRAN_CREATE_FAILED`；TTYP/MSAG: `LOCK_FAILED` 等透传） |
| `textpool-adt` / `textpool-icf` | textpool 写（混合模式） | 视 mode 而定 |
| `channel-adt` / `channel-icf` | TTYP/MSAG/DDLS 通道检测（0.2.5+） | `CHANNEL_DETECTION_FAILED` / `DDLS_NOT_SUPPORTED_ON_ECC` |
| `read` | textpool 读（混合模式 pre-stage） | 通常不报错 |

> ⚠️ **textpool 写受 SAP release 限制**：只有 ADT text-elements 写端点可用的系统才能写文本元素；`adtTextpool.write: false` 的系统（vhcala4hci / A4H 实测）走 ICF POST，无条件报 `TEXTPOOL_WRITE_UNSUPPORTED`。textpool **读**始终可用；写不可用时选择屏幕标签改用 `SELECTION-SCREEN COMMENT <pos>(<len>) lbl_xxx` + `INITIALIZATION` 赋值。详见 [references/workflow.md 变体 8](./references/workflow.md)。

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

- [references/commands-quick.md](./references/commands-quick.md) — 6 写 + mime + validate:aff 共 8 命令完整速查
- [references/errors.md](./references/errors.md) — 本 skill 错误码全表
- [references/workflow.md](./references/workflow.md) — DDIC / FUGR / textpool / stale 激活详细变体