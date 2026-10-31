---
type: reference
title: 支持的对象类型
description: abap CLI 支持的 ABAP 对象类型总览 — 22 个类型码 × create/pull/push 路由（ADT / ICF）与本地 AFF 文件布局
tags: [abap-cli, object-types, ddic, http, sicf, reference]
created at: 2026-08-29 10:00:00
changed at: 2026-10-31 16:20:00
---

# 支持的对象类型

abap CLI 的类型注册表（`src/abap_cli/types/registry.ts`）覆盖 **22 个对象类型**：4 个 ABAP 源对象、1 个 ADT 包（DEVC）、6 个 DDIC 对象、2 个 ICF/事务对象、2 个双通道 DDIC/CDS 对象、7 个 CDS/RAP 对象。分两条路由：**ADT**（`abap-adt-api` 走标准 ADT REST API）与 **ICF**（自建服务 `/sap/abap_cli`，需先 `abap deploy`）。

`create <type>` 的 `--schema` 参数 `allowedValues` 即这 21 个类型码：`CLAS, INTF, PROG, FUGR, DEVC, TABL, STRU, DOMA, DTEL, ENQU, NROB, HTTP, TRAN, TTYP, MSAG, DDLS, SRVB, SRVD, BDEF, DCLS, DDLX, DDLA`。先查能力再动手：`abap create --schema <TYPE>` 会给出某个类型的字段契约。

## 类型 × 命令矩阵

| 类型码 | 对象 | 路由 | `create` | `pull` | `push` | `create local` | 本地文件（平铺 `src/`） |
|---|---|---|---|---|---|---|---|
| `CLAS` | 类 | ADT | 骨架 | ✅ | ✅ | ✅ | `<name>.clas.json` + `<name>.clas.abap` + 各 include `.clas.<subtype>.abap` |
| `INTF` | 接口 | ADT | 骨架 | ✅ | ✅ | ✅ | `<name>.intf.json` + `<name>.intf.abap` |
| `PROG` | 报表程序 | ADT | 骨架 | ✅ | ✅ | ✅ | `<name>.prog.json` + `<name>.prog.abap`（include 为 `.prog.include.abap`） |
| `FUGR` | 函数组 | ADT | 骨架 | ✅ | ✅ | ✅ | `<group>.fugr.json` + `.fugr.sapl<group>.reps.*` + `.fugr.l<group>top.reps.*` + 每 FM `.fugr.<fm>.func.*` |
| `DEVC` | 包（Package） | ADT | 包参数（`--package` = 父包，无需 `--file`） | ✅ | ✅ | ❌（ADT 无更新端点） | ❌ | `<name>.devc.json` |
| `TABL` | 透明表 | ICF | `--file` | ✅ | ✅ | ❌ | `<name>.tabl.{json,ddic,settings.json}` |
| `STRU` | 结构 | ICF | `--file` | ✅ | ✅ | ❌ | `<name>.stru.{json,ddic,settings.json}` |
| `DOMA` | 域 | ICF | `--file` | ✅ | ✅ | ❌ | `<name>.doma.json` |
| `DTEL` | 数据元素 | ICF | `--file` | ✅ | ✅ | ❌ | `<name>.dtel.json` |
| `ENQU` | 锁对象 | ICF | `--file` | ✅ | ✅ | ❌ | `<name>.enqu.json` |
| `NROB` | 编号范围对象 | ICF（pull 主 ADT + ICF 兜底） | `--file` | ✅ | ✅ | ❌ | `<name>.nrob.json` |
| `HTTP` | **ICF / SICF 节点** | ICF | `--file` | ✅ | ✅ | ❌ | `<name>.http.json` |
| `TRAN` | 事务码 (SE93) | ICF | `--file` | ✅ | ✅（写路径未实现，见下） | ❌ | `<code>.tran.json` |
| `TTYP` | 表类型 | auto（ADT 主 / ECC ICF 兜底） | `--file` | ✅ | ✅ | ❌ | `<name>.ttyp.json` + 可选 `<name>.ttyp.type.abap` |
| `MSAG` | 消息类 | auto（ADT 主 / ECC ICF 兜底） | `--file` | ✅ | ✅ | ❌ | `<name>.msag.json` |
| `DDLS` | CDS 视图 | ADT | `--file` | ✅ | ✅ | ❌ | `<name>.ddls.{json,acds}` |
| `SRVB` | Service Binding (metadata only) | ADT | ❌ | ✅ | ❌ | ❌ | `<name>.srvb.json` |
| `SRVD` | Service Definition | ADT | `--file` | ✅ | ✅ | ❌ | `<name>.srvd.{json,acds}` |
| `BDEF` | Behaviour Definition | ADT | ❌（SAP 不接受 CLI 创建 BDEF） | ✅ | ✅ | ❌ | `<name>.bdef.{json,abdl}` |
| `DCLS` | CDS Access Control | ADT | `--file` | ✅ | ✅ | ❌ | `<name>.dcls.{json,acds}` |
| `DDLX` | CDS Metadata Extension | ADT | `--file` | ✅ | ✅ | ❌ | `<name>.ddlx.{json,acds}` |
| `DDLA` | CDS Annotation Definition | ADT | `--file` | ✅ | ✅ | ❌ | `<name>.ddla.{json,acds}` |

> **`create local` 只支持 `CLAS` / `INTF` / `PROG` / `FUGR`**（`formats/templates.ts` 只有这四类模板），其余类型一律 `TYPE_NOT_SUPPORTED`（exit 7）。`SRVD` / `DCLS` / `DDLX` / `DDLA` 在 SAP 侧可创建（`createObjtype`），但没有本地骨架模板；`create local` 会拒绝它们并提示改用 `abap create <type> --file <aff.json>`。
> **`create` 的 `--file` 是数据驱动必填项**（`types/registry.ts` 的 `ObjectTypeEntry.requiresFile`）：`TABL` / `STRU` / `DOMA` / `DTEL` / `ENQU` / `NROB` / `HTTP` / `TRAN` / `TTYP` / `MSAG` / `DDLS` / `SRVD` / `DCLS` / `DDLX` / `DDLA` 缺 `--file` 直接 `USAGE`（exit 2）。`BDEF` 是 pull-only（SAP 不接受 CLI 创建）；`SRVB` 仅 pull（SAP GUI 管理 binding）。
> **`TRAN` 写路径的现状**：ABAP `/tran` 的 POST/PUT 仍返回 `TRAN_WRITE_NOT_IMPLEMENTED`（501），因此 `create TRAN` / `push *.tran.json` 端到端不可用；`pull` 与 `abap tcode` 的读取路径正常。实现计划见 [roadmap](roadmap.md)。

本地产物一律平铺在 `src/` 下（无类型/对象子目录），文件名自带类型后缀；命名空间用 AFF 括号 token（`/UI2/CL_JSON` → `(ui2)cl_json`）。DDIC 三件套（TABL / STRU）与 DOMA / DTEL 的详细字段契约见 [create](commands/create.md) 与 [pull](commands/pull.md)。

## HTTP —— 就是 SICF 节点

> **类型码是 `HTTP`，它就是 SICF 事务里的 ICF 服务节点**。旧版 `SICF` 别名已在 1.0.0 删除（见 CHANGELOG 的 Removed 段）：`--type SICF` / `create SICF` 不再自动映射为 `HTTP`，会得到未知类型错误。新脚本请直接写 `HTTP`。

`HTTP` 类型可读可写：handler class、URL、描述、父节点校验。

```bash
# 拉一个已有 SICF 节点
abap pull ZMY_SERVICE --type HTTP --json

# 创建（必须 --file，走真实 SAP）
abap create HTTP ZMY_SERVICE --file src/zmy_service.http.json --package $TMP --description "My service"

# 改完推回
abap push src/zmy_service.http.json --tr <TR>
```

`.http.json` 遵循 abap-file-format（`http-v1.json`）的嵌套结构，同时也接受扁平写法：

```json
{
  "formatVersion": "1",
  "header": {
    "description": "My service",
    "originalLanguage": "EN"
  },
  "generalInformation": {
    "handlerClass": "ZCL_MY_HANDLER",
    "servicePath": "/sap/zmy_service"
  }
}
```

`create HTTP` 必须带 `--file`（abap-file-format JSON）走真实 SAP create；"无 `--file` 自动落最小骨架"的旧路径已删除，与 DDIC / DDLS 对齐。`create local` 不支持 HTTP；要手写 JSON 可参考 `abap create --schema HTTP` 的 `exampleJson`，或先 `abap pull` 一个同类节点。HTTP push 仍允许 create-on-push（见 [commands/push](commands/push.md)）。

## Package（DEVC）

`DEVC` 是唯一走 ADT 的"非源码"类型：一个包就是 `GET /sap/bc/adt/packages/<name>` 返回的单个
`pak:package` 资源，没有 include、没有激活步骤。

- **create**：`abap create DEVC <name> --package <super> --description <desc>`；软件组件 / 传输层默认继承父包，可用 `--software-component` / `--transport-layer` 覆盖，`--package-type` 选 `development`（默认）/ `main` / `structure`。`--check-only` 用 SAP 自己的 `POST /sap/bc/adt/packages/validation` 预检，名字/软件组件的错误原文回显。
- **LOCAL 包名硬约束**：软件组件为 `LOCAL` 时，SAP 要求包名以 `$` 或 `TEST` 开头（`$TMP` 下建子包只能写 `$...` / `TEST...`）。
- **pull**：映射 `header`（description / masterLanguage）+ `generalInformation`（packageType / superPackage / switch / applicationComponent / softwareComponent / transportLayer / recordChanges / encapsulation / ABAP 语言版本）+ `useAccesses[]`；语言版本键 `0`/`2`/`5` → `standard`/`keyUser`/`cloudDevelopment`。
- **delete**：包删除**不加锁、不传 lockHandle**（先 lock 再 DELETE 会被 SAP 拒绝），且不能删除仍有子包的包；transportable 包（软件组件非 `LOCAL`）需 `--tr`。
- **push**：不支持。ADT 对包只有读 + 创建 + 删除，`PUT` 直接被资源控制器拒绝，`abap push *.devc.json` 报 `TYPE_NOT_SUPPORTED`（exit 7）并说明替代路径。

## 两种 "ICF" 的区别

仓库里 "ICF" 指两件不同的事，别混淆：

| | 含义 | 对应 |
|---|---|---|
| **ICF 作为通道** | 自建服务 `/sap/abap_cli` 旁路 ADT，承载 DDIC CRUD / textpool **读** / `select` / `tcode` / `run` / `mime` | `abap deploy` / `deploy status` |
| **ICF 作为对象** | 被管理的 SICF 服务节点本身 | `--type HTTP` |

也就是说：**用 ICF（通道）来管理 ICF（节点）**。前者是前提，后者是能力——`--type HTTP` 依赖扩展已部署。

## 明确不支持

| 类型 | 状态 | 去向 |
|---|---|---|
| `VIEW`（DDIC 视图） | 不支持 | 候选补充类型，见 [roadmap](roadmap.md)；当前只能用 `select` / `fields` 查询已有视图 |
| `SHLP`（搜索帮助） | 不支持 | 候选补充类型，见 [roadmap](roadmap.md) |
| `AUTH` / `SUSO` 等授权对象 | 不支持 | 候选补充类型，见 [roadmap](roadmap.md) |
| `ENHO` / `ENHS` 增强 | 不支持 | 候选补充类型，见 [roadmap](roadmap.md) |
| BAdI 定义/实现、AMDP、CDS Table Function | 不支持 | 来源对象可用 `where-used` 查引用 |
| SAPscript / Smart Forms / Adobe Form | 不支持 | — |
| Web Dynpro / ITS / BSP | 不支持 | — |
| IDoc / ALE 配置、Workflow | 不支持 | — |
| Package（`DEVC`）更新/推送 | 不支持 | ADT 资源控制器拒绝 `PUT /sap/bc/adt/packages/<name>`；`create DEVC` / `pull DEVC` / `delete` 已支持，改包请在 SAP GUI 操作或删除后重建 |
| `TRAN` 写入 | 未实现（501） | 读取用 `pull TRAN` / `abap tcode` |
| Pool / Cluster Table | 不支持 | 仅 TABL / STRU |

> 注：原 0.2.x 文档中曾把 `TTYP`/`DDLS` 列为"显式 deferred"或"无实现"。实际后续演进中两者已完整支持 `pull` + `create`（`--file`）；但 **`create local` 从未支持过它们**——`create local` 仅 `CLAS` / `INTF` / `PROG` / `FUGR`。

## 常见误判

- `abap pull X --type SICF` / `abap create SICF ...` → **不会**再映射为 `HTTP`（别名已在 1.0.0 删除）；请直接写 `HTTP`。
- `create <type>` 的 `--schema` `allowedValues` 已是全 22 类：`CLAS, INTF, PROG, FUGR, DEVC, TABL, STRU, DOMA, DTEL, ENQU, NROB, HTTP, TRAN, TTYP, MSAG, DDLS, SRVB, SRVD, BDEF, DCLS, DDLX, DDLA`。
- `DDIC_NOT_SUPPORTED` (exit 7) → 类型在 DOMA/DTEL/TABL/STRU 之外。
- 所有 ICF 路由类型在扩展未部署时都会失败 → 先 `abap deploy status`。
- CDS 家族（`DDLS`/`DCLS`/`DDLX`/`DDLA`）+ RAP 三件套（`SRVB`/`SRVD`/`BDEF`）走 ADT，**不**经 ICF。`SRVB` 仅 `pull`（SAP GUI 管理 binding），其余 7 类支持完整 create/push（`BDEF` 仅 pull/push）。

# More

## todo

- [x] `SICF` → `HTTP` 别名在 1.0.0 删除（旧文档里的"自动映射"描述已同步删除）
- [x] `create <type>` `--schema` 补全 `allowedValues` 全 21 类（含 `ENQU`/`NROB`）
- [x] 矩阵补全 `ENQU`/`NROB` 行、修正 `create local` 列（CDS/RAP 伴生对象不再落错误骨架）
- [ ] 候选补充类型（VIEW / SHLP / AUTH / ENHO…）的取舍与排期 → [roadmap](roadmap.md)
- [ ] `create` 的 help/description 文案随 registry 动态化

# references

- [create](commands/create.md)
- [pull](commands/pull.md)
- [push](commands/push.md)
- [deploy](commands/deploy.md)
- [roadmap（对象类型补充路线）](roadmap.md)
- [abap-file-format 规范来源（vendored schema）](../src/abap_cli/schema/README.md)
