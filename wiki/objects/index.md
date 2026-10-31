---
type: reference
title: 对象类型详细文档索引
description: 每个 SAP 对象类型的字段契约、命令路径、本地文件形态与示例
tags: [abap-cli, object-types, reference, clas, intf, prog, fugr, devc, tabl, stru, doma, dtel, enqu, view, nrob, http, tran, ttyp, msag, ddls]
created at: 2026-09-01 00:00:00
changed at: 2026-10-31 18:00:00
---

# 对象类型详细文档

每个对象类型一篇：字段契约 / 命令路径 / 本地文件形态 / abap-file-format 合规性 / 已知坑。

| 类型 | 路由 | 本地文件形态（平铺 `src/`） | 文档 |
|---|---|---|---|
| `CLAS` | ADT | `src/<name>.clas.json` + 各 include `src/<name>.clas.<subtype>.abap` | [clas.md](clas.md) |
| `INTF` | ADT | `src/<name>.intf.json` + `src/<name>.intf.abap` | [intf.md](intf.md) |
| `PROG` | ADT | `src/<name>.prog.json` + `src/<name>.prog.abap` | [prog.md](prog.md) |
| `FUGR` | ADT | `src/<group>.fugr.json` + `.fugr.sapl<group>.reps.*` + `.fugr.l<group>top.reps.*` + 每 FM `.fugr.<fm>.func.*` | [fugr.md](fugr.md) |
| `DEVC` | ADT | `src/<name>.devc.json`（包；pull / create-then-pull，push 不支持） | [devc.md](devc.md) |
| `TABL` | ICF | `src/<name>.tabl.{json,ddic,settings.json}` 三件套 | [tabl.md](tabl.md) |
| `STRU` | ICF | `src/<name>.stru.{json,ddic,settings.json}` 三件套 | [stru.md](stru.md) |
| `DOMA` | ICF | `src/<name>.doma.json`（嵌套）+ 可选 `<name>.doma.docu.json`（长文本 0..1） | [doma.md](doma.md) |
| `DTEL` | ICF | `src/<name>.dtel.json`（嵌套）+ 可选 `<name>.dtel.docu.json`（长文本 0..1） | [dtel.md](dtel.md) |
| `ENQU` | ICF | `src/<name>.enqu.json`（锁对象） | [enqu.md](enqu.md) |
| `VIEW` | ICF | `src/<name>.view.json`（数据库视图，本地扩展 `view-v1.json`） | [view.md](view.md) |
| `NROB` | ICF | `src/<name>.nrob.json`（编号范围对象） | [nrob.md](nrob.md) |
| `HTTP` | ICF | `src/<name>.http.json`（SICF 节点） | [http.md](http.md) |
| `TRAN` | ICF | `src/<code>.tran.json`（SE93 事务码） | [tran.md](tran.md) |
| `TTYP` | ADT + ICF 兜底 | `src/<name>.ttyp.json` + 可选 `src/<name>.type.abap` | [ttyp.md](ttyp.md) |
| `MSAG` | ADT + ICF 兜底 | `src/<name>.msag.json` | [msag.md](msag.md) |
| `DDLS` | ADT（无兜底） | `src/<name>.ddls.{json,acds}` 两件套 | [ddls.md](ddls.md) |

## 路由速查

- **ADT**（源对象）：无需 ICF 部署；直接打 SAP ADT REST API；走 `abap-adt-api` 库
- **ICF** 自建（DDIC/HTTP/TRAN）：需要先 `abap deploy`；走 `/sap/abap_cli/<domain>/<type>/<name>`（VIEW 为 `/ddic/view/<name>`）
- **ADT + ICF 兜底**（TTYP/MSAG）：优先 ADT；ECC EHP5/6 内核（< 753）自动切 ICF，envelope 写 `data.channel` + `data.fallbackReason`
- **ADT 无兜底**（DDLS）：旧内核直接硬错 `DDLS_NOT_SUPPORTED_ON_ECC`（exit 64），不发起任何 SAP 调用

## 详细决策

AFF 原生扁平布局的「为什么」见 [design-decisions/010-aff-flat-layout.md](../design-decisions/010-aff-flat-layout.md)（[003](../design-decisions/003-typesubdir-layout.md) 是已被取代的历史决策）；DDIC 走 ICF 而非 ADT 的「为什么」见 [design-decisions/002-icf-bypass-ddic.md](../design-decisions/002-icf-bypass-ddic.md)。

# references

- 路由矩阵：[`wiki/object-types.md`](../object-types.md)
- abap-file-format 规范来源（vendored schema）：[`src/abap_cli/schema/README.md`](../../src/abap_cli/schema/README.md)
