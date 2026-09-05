---
type: reference
title: DDIC 走自建 ICF 而非 ADT
description: 源对象（CLAS/INTF/PROG/FUGR）走 ADT；DDIC 对象（DOMA/DTEL/TABL/STRU）走自建 ICF 服务 `/sap/zabap_vibe/ddic/...`
tags: [abap-cli, design-decisions, ddic, icf, adt]
created at: 2026-09-01 00:00:00
changed at: 2026-09-01 00:00:00
---

# 002 — DDIC 走自建 ICF 而非 ADT

## 决策

部分对象的 CRUD **不走 ADT REST API**，而是打我们自己在 SAP 端部署的 ICF 服务（`/sap/zabap_vibe/...`）：

| 路由 | 对象类型 | 原因 |
|---|---|---|
| ADT（`abap-adt-api`） | CLAS、INTF、PROG、FUGR | ADT 写源对象稳定；abap-adt-api 库已封好 |
| **ICF 自建**（`/sap/zabap_vibe/ddic/...`） | DOMA、DTEL、TABL、STRU | ADT 写 DDIC 不支持 / 不稳（详见 spec 014） |
| **ICF 自建**（`/sap/zabap_vibe/http/...`） | HTTP（SICF 节点） | SICF 节点本来就在 ICF 树上，自然走 ICF |
| **ICF 自建**（`/sap/zabap_vibe/tran/...`） | TRAN（SE93） | SE93 没 ADT 端点；走 ICF 自托管 |

## 上下文

源对象（CLAS/INTF/PROG/FUGR）的写路径 SAP 提供完整 ADT REST API，社区已有成熟库 `abap-adt-api`。DDIC 对象的写路径要么不存在（DTEL、DOMA），要么需要一段精巧的 `R3TR` XML 包（TTYP、TABL 激活），要么会撞 `abapLanguageVersion` / `CLIENT`/`MANDT` 自动注入等 SAP 端 magic。简单直白地"用 ADT 写 DDIC"在 BTP trial 与 ECC EHP7 上的成功率不可接受。

## 被否决方案

- **纯 ADT 写 DDIC**：需手工构造完整的 `R3TR DTEL` 包，复杂且易碎
- **跑 abapGit 在 SAP 侧做序列化**：abapGit 不暴露写 API
- **走 RFC/RAP/BAPI**：DDIC 创建没有标准 BAPI
- **直接 `INSERT` 系统表（DD01L 等）**：破坏 SAP 一致性，强烈反对

## 当前代价

- 用户必须先 `abap deploy` 一次（把 ICF 服务部署到 SAP）
- ICF 服务本身的 ABAP 代码（`abap/src/clas/zcl_abap_vibe_icf.clas.abap`）需要独立维护
- 增加了"DDIC 走 ICF"的认知负担（`wiki/object-types.md` 顶部专门标注了路由矩阵）

## 后果

- **正面**：DDIC 写成功率提升到 ~99%；CLI 与 SAP 端的契约变成我们自己定义（不依赖 SAP 何时改 ADT）
- **负面**：首装流程多一步；ICF 服务升级需要 `deploy`

# references

- 规范来源：[`specs/013-icf-interface-implementation/`](../../specs/013-icf-interface-implementation/)
- 实现：[`src/abap_cli/clients/icf-client.ts`](../../src/abap_cli/clients/icf-client.ts)、[`abap/src/clas/zcl_abap_vibe_icf.clas.abap`](../../abap/src/clas/zcl_abap_vibe_icf.clas.abap)
- 文档：[`wiki/object-types.md`](../object-types.md)
