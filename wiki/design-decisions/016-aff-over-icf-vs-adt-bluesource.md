---
type: reference
title: AFF 对象按能力拆分通道 — ADT blueSource 写读 / ICF AFF 只读
description: APLO/CHDO/EVTB/SMBC 走 ADT blueSource（source/main 即官方 AFF JSON），ENHO/ENHS 保留 ICF /aff 只读 pull；决策、被否决方案与当前代价
tags: [abap-cli, design-decisions, aff, adt, icf, bluesource, enhancement]
created at: 2026-11-04 02:30:00
changed at: 2026-11-04 02:30:00
---

# 016 — AFF 对象按能力拆分通道（ADT blueSource / ICF 只读）

## 决策

官方 AFF 对象（`APLO` / `CHDO` / `EVTB` / `SMBC` / `ENHO` / `ENHS`）按 SAP 侧实际能力拆成两条通道，用户命令面保持统一（`abap create / pull / push / delete <TYPE>` + 官方 AFF JSON）：

- **`APLO` / `CHDO` / `EVTB` / `SMBC` → ADT blueSource。** 757 上这些对象的 ADT 资源把官方 AFF JSON 直接作为对象源码（`source/main`），ADT 侧承担 lock / 保存即激活 / transport。CLI 只是把 `source/main` 读出或写入本地 `<token>.<type>.json`，不做字段映射。
- **`ENHO` / `ENHS` → ICF `/aff` 只读（仅 pull）。** 通用端点 `GET /sap/abap_cli/aff/<TYPE>/<name>` 调 SAP 自带 AFF 框架序列化对象；这两个类型的 AFF handler 写/删不完整，CLI 明确不支持 `create` / `push` / `delete`。
- 写入路径（SEEF API）留作后续独立工作，不在本轮强行拼装。

## 上下文

- SAP_BASIS 757 的 AFF 框架完整可用，`CL_AFF_OBJECT_HANDLER_FACTORY` 对 6 个目标类型都返回 handler；6 类 serialize 都只产出 1 个官方 AFF 文件（命名空间用括号 token、小写）。
- **AFF 框架的写路径只对 APLO / EVTB 可用**：`DESERIALIZE_OBJECTS` 需要预置 TADIR 行（`get_master_language` 读 TADIR），写入后是 active 数据。CHDO / SMBC 属于 `CL_BLUE_JSON_WB_ACCESS` 系：`deserialize` 只传 `p_data_selection = c_data_content`（metadata 未填），真机 create 静默不写；`delete` 整段注释成 no-op。
- **ENHO / ENHS 的 AFF handler 是只读的**：`can_handle` 要求对象已存在 active 的 `ENHHEADER` / `ENHSPOTHEADER`（create 必被拒），persistence 的 `save_content` 是空实现，直调 deserialize 也不落库；ENHO 的 `delete_object` 为空，ENHS 的 `delete_object` 是 `ASSERT 1 = 2`（调用会 dump）。真正的写路径是 SEEF API（`CL_ENH_FACTORY`、`CL_ENH_ADT_*` persist、`ENH_WB_ACTIVATE`）。
- **ADT blueSource 对 4 类提供完整生命周期**：`source/main` 返回的就是官方 AFF JSON（带 ADT 的 `$schema` / 元数据语义），写走标准 ADT lock → save → activate → unlock，transport 由 ADT/CTS 处理；真机 create / pull / push / delete 已闭环（SMBC 因参考系统无对象未验证）。
- **ICF 端点的价值**：ENHO / ENHS 没有可用的 ADT AFF 资源（它们的 ADT persist 类属 SEEF ADT 资源，不是通用 blueSource），而 AFF 框架的 serialize 在 ICF 上下文可直接调用；因此保留最小只读端点，不复制 SAP 的序列化逻辑。

## 被否决方案

- **6 类统一走 ICF `/aff` 的 CRUD**：AFF 框架写路径对 4/6 类型不可用（CHDO/SMBC 静默不写、ENHO/ENHS 只读），端点为写路径补 TADIR/激活/传输适配也补不出 SAP 缺失的持久化实现；ENHS 的 AFF 删除还会断言。被否。
- **6 类统一走 ADT blueSource**：ENHO / ENHS 没有暴露官方 AFF JSON 的通用 blueSource 资源，ADT 侧的 SEEF 资源是 XML/结构化的持久化接口，无法直接承载 AFF 文档；要么反向映射，要么自建写适配，成本与风险都高于保留只读 pull。被否。
- **为 ENHO / ENHS 在本轮直接接 SEEF 写适配**：需要先造 BAdI 接口 / 增强点 / 实现类等前置对象并逐条验证 `ENH_WB_ACTIVATE` 与 inactive 语义，超出本轮交付面；拆为后续独立工作。
- **CLI 侧自建 AFF 序列化器**（不依赖 SAP AFF 框架）：等于复制 SAP 的 handler / 持久化知识，且随 release 漂移；与"薄客户端"原则冲突。被否。

## 当前代价

- 两条通道并存：`types/registry.ts` 的 channel / 能力标记、`flows/edit/*-aff.ts`、`docs/supported.md`、wiki 类型页和 `abap types --json` 的 channel 都要区分；新增 AFF 类型时必须先探明 SAP 侧能力再选通道。
- **`ENHO` / `ENHS` 只读是已知限制**：用户不能经 CLI 创建 / 修改 / 删除增强；`pull` 产物仅用于阅读 / 比对，维护仍需 SE80 / SE11 / SEEF。文档与 skill 中显式标注。
- **`SMBC` 未真机验证**：参考系统 TADIR 没有 SMBC 对象，且 create 的硬前置是已存在的 SRVB service binding；通道按其他三类相同方式接入，schema 本地校验完整，但真实写入路径待有前置对象的系统验证。
- ICF `/aff` 在 pre-757 上不可用：端点内部对 AFF 类型全部动态调用，`abap deploy` 在旧 release 上仍可编译，调用时返回 `AFF_UNSUPPORTED` 而不是部署失败。

## 后果

- **注册表**：`APLO` / `CHDO` / `EVTB` / `SMBC` 是 ADT 类型（`source`/channel 为 ADT，`requiresFile: true`）；`ENHO` / `ENHS` 保留 ICF 类型但只有 pull 能力。`abap types --json` 的 channel 字段与之一致。
- **路由**：create / pull / push / delete 的 `TYPE_ROUTES` 按类型落到 ADT blueSource 或 ICF `/aff`/只读；`ENHO` / `ENHS` 的写操作在本地即被拒绝（不发起 SAP 请求）。
- **文档**：`docs/supported.md` 矩阵、`wiki/object-types.md` 通道表、`wiki/objects/{aplo,chdo,evtb,smbc,enho,enhs}.md` 与 `docs/architecture.md` 端点表都按本决策描述；只读限制在 `Not supported` 表与类型页给出原因。
- **后续工作**：`ENHO` / `ENHS` 写入 = SEEF API 适配（create / update / delete + 激活）；`SMBC` = 有 SRVB 前置对象的系统上补真机验证；AFF 框架对 CHDO / SMBC 的写入若在未来 release 补齐，可重新评估改回 ICF 或直接复用 ADT。

# references

- 类型注册表：[`src/abap_cli/types/registry.ts`](../../src/abap_cli/types/registry.ts)
- AFF bundle 与通道流程：`src/abap_cli/formats/aff/bundle.ts` · `src/abap_cli/flows/edit/aff-shared.ts` · `flows/edit/{create,pull,push,delete}-aff.ts`
- schema 来源：[`src/abap_cli/schema/README.md`](../../src/abap_cli/schema/README.md)
- 相关决策：[002 — DDIC 走自建 ICF](002-icf-bypass-ddic.md) · [007 — 单一路由表](007-explicit-type-routing.md) · [010 — AFF 原生扁平布局](010-aff-flat-layout.md) · [012 — ICF 服务形态](012-icf-dev-global-release-merged.md)
- 对象类型总览：[`wiki/object-types.md`](../object-types.md)
