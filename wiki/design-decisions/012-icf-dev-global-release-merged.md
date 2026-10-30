---
type: reference
title: ICF 服务开发期全局类树 / 发布期合并单类
description: abap/src 以全局类开发仓形态维护，abap/deploy.json 是清单；abap deploy 推送前把 helper 降级为 lcl_* 合并进 handler，SAP 上只装 3 个全局类
tags: [abap-cli, design-decisions, icf, deploy, abap]
created at: 2026-10-30 21:40:00
changed at: 2026-10-30 21:40:00
---

# 012 — ICF 服务开发期全局类树 / 发布期合并单类

## 决策

`abap/src/` 里的 ICF 服务按 abapGit 式**开发仓形态**维护：handler 和每个 helper 都是普通全局类（AFF 扁平，一个 `<name>.clas.abap` 定义一个类，definition + implementation 同文件）。

`abap/deploy.json` 是唯一清单：`handler`、`merged[]`（开发期全局类名 → 发布期本地类名 `lcl_*`）、`standalone[]`。

`abap deploy`（默认）产出**发布形态**：读取开发源码，把 16 个 merged helper 的类头降级为 `lcl_*`、按依赖拓扑排序后合并进 handler 的 definitions / implementations 两个 include，并把 handler main 里的 `zcl_*` 引用机械改名为 `lcl_*`。SAP 上最终只装 3 个全局类：`ZCL_ABAP_VIBE_ICF` + `ZCL_ABAP_VIBE_ICF_SETUP` + `ZCL_ABAP_VIBE_RUNNER`。

`abap deploy --dev` 产出**开发形态**：跳过合并，按依赖顺序把 19 个类逐个安装为全局对象，供本仓库在真机上做单类语法检查、激活、ABAP Unit 与端点迭代。

## 上下文

- **ABAP 硬约束**：一个类只有一份 definitions include 和一份 implementations include；local class 不能跨全局类复用。因此"拆分"只能发生在推送 SAP 之前的文件层，运行时的形状必须是单类。
- **旧形态**：handler 的两个 include 是 1,015 / 5,099 行的巨石（549 行共享 TYPES 前导 + 10 个 `CLASS lcl_*`）。整类才能语法检查 / 激活，agent 定位与 review 成本高，单点改动也要整包回归。
- **分发面**：安装方只需要 3 个对象；开发方需要单个 helper 能独立检查、激活、在真机上调用。两种需求不能靠同一种形态满足。
- **共存要求**：开发形态与发布形态要能在同一台 SAP 系统上共存，才能在 A4H 上用 dev 形态迭代的同时验证发布形态。

## 被否决方案

- **fragments 方案（仓库内按域拆文件、deploy 时纯拼接回两个 include）**：能把巨石拆小且可证逐字节还原，但产物仍是"两个 include + 10 个 local class"，单个 helper 不能当全局类做语法检查 / 激活 / 真机调用，开发期粒度没变。被本方案取代。
- **abapmerge 式同名 local class 合并**：开发期也用 `lcl_*` 名写进待合并文件，发布时原样输出。形态只有一种，dev 形态没有可单独安装的全局类 → 无法单类迭代；且两种形态共用同一套名字和同一个对象，无法在同一系统共存对照。
- **把 19 个全局类直接发布**：每个对象都要创建 / 激活 / 传输 / 授权，安装与升级面从 3 个对象涨到 19 个，正是要避免的分发成本。
- **保留两个 include 巨石**：不引入清单与合并器，但继续支付整类编辑 / 检查 / review 的成本，与 Agent 使用优化相悖。

## 当前代价

- `abap/deploy.json` 成为必须维护的清单：新增、改名、删除 ICF helper 都要同步登记；清单与 `abap/src` 不一致时 deploy 直接报 `DEPLOY_MANIFEST_INVALID`，不会静默少装。
- 发布形态多一步纯文本合并：类头降级、全局名改名、按 definition 引用做稳定拓扑排序、残留全局名检查。合并器 `src/abap_cli/flows/edit/deploy-merge.ts` 是纯字符串模块（不碰 ADT / 文件系统），由单测覆盖；它不编译 ABAP，SAP 侧语法错误仍要到真机激活时才暴露。
- 发布形态的 definitions / implementations 是 deploy 时生成的，**不进仓库**：不能把 release handler `abap pull` 回来再 push（会生成 include 文件），`abap/src` 的契约由 deploy 强制——handler 只允许 main，merged helper 只允许 main + 可选 definitions prelude，违反时报 `DEPLOY_MANIFEST_INVALID`。
- 两种形态在同一系统会留下对侧残留：release 部署后 dev 全局类还在但不再被引用；dev 部署后旧的生成 include 里是 `lcl_*` 死代码（能自洽编译）。都不需要清理，也不能靠清理来切换形态。
- 清单缺失时 deploy 降级为"每个类都当全局类安装、不合并"，并给 `DEPLOY_MANIFEST_MISSING` warning：安装方仍能拿到可用的（但更大的）服务，而不是硬失败。

## 后果

- **仓库侧**：19 个可单独 review / 激活的全局类；共享类型集中到 `ZCL_ABAP_VIBE_ICF_TYPES` 的 PUBLIC SECTION（约 100 个 `ty_*` / `tt_*`），10 个域 helper 一律用 `zcl_abap_vibe_icf_types=>ty_*` 引用（5 个 format 类保留自己的类型定义）；`ZCL_ABAP_VIBE_ICF_MIME` 自带 `TYPE-POOLS: skwf, wbmr.` 的 definitions prelude。
- **发布侧**：3 个全局类；handler 3 个 part（main + 生成的 definitions / implementations）。`DeploymentSummary` 用 `mode: 'dev' | 'release'` 区分形态，release 额外带 `mergedClasses`；ICF 端点与 service version 不变，CLI 客户端无感知。
- **开发循环**：`abap deploy --dev --yes` 在开发系统安装全部全局类（依赖拓扑序：共享类型最先、format 先于 ddic、handler 在全部 helper 之后、setup/runner 最后），改单类后可只推 / 只激活该类；发布前用 `abap deploy --yes` 装发布形态并用 `abap deploy --diff` 验幂等。
- **后续改动**：新增 ICF helper = 新全局类 + `abap/deploy.json` 的 `merged` 一行（分配新的 `lcl_*` 本地名）；不需要合并的类登记到 `standalone`。

# references

- 实现：[`src/abap_cli/flows/edit/deploy.ts`](../../src/abap_cli/flows/edit/deploy.ts)（release/dev 装配 + 清单校验）、[`src/abap_cli/flows/edit/deploy-flow.ts`](../../src/abap_cli/flows/edit/deploy-flow.ts)、[`src/abap_cli/commands/deploy.ts`](../../src/abap_cli/commands/deploy.ts)；合并器 `src/abap_cli/flows/edit/deploy-merge.ts`，清单 `abap/deploy.json`
- SAP 后端：`abap/src/zcl_abap_vibe_icf.clas.abap`（handler）· `abap/src/zcl_abap_vibe_icf_types.clas.abap`（共享类型）· `abap/src/zcl_abap_vibe_icf_setup.clas.abap` · `abap/src/zcl_abap_vibe_runner.clas.abap`
- 相关决策：[001 — 三层架构](001-3layer-architecture.md) · [002 — DDIC 走自建 ICF](002-icf-bypass-ddic.md) · [010 — AFF 原生扁平布局](010-aff-flat-layout.md)
- 文档：[`docs/architecture.md`](../../docs/architecture.md) · [`docs/development.md`](../../docs/development.md) · [`wiki/commands/deploy.md`](../commands/deploy.md)
