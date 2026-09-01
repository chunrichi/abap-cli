---
type: reference
title: 对象类型详细文档索引
description: 每个 SAP 对象类型的字段契约、命令路径、本地文件形态与示例
tags: [abap-cli, object-types, reference, clas, intf, prog, fugr, tabl, stru, doma, dtel, http, tran]
created at: 2026-09-01 00:00:00
changed at: 2026-09-01 00:00:00
---

# 对象类型详细文档

每个对象类型一篇：字段契约 / 命令路径 / 本地文件形态 / abap-file-format 合规性 / 已知坑。

| 类型 | 路由 | 本地文件形态 | 文档 |
|---|---|---|---|
| `CLAS` | ADT | `clas/<name>/<name>.clas.json` + 各 include | [clas.md](clas.md) |
| `INTF` | ADT | `intf/<name>/<name>.intf.json` + `*.intf.abap` | [intf.md](intf.md) |
| `PROG` | ADT | `prog/<name>/<name>.prog.json` + `*.prog.abap` | [prog.md](prog.md) |
| `FUGR` | ADT | `fugr/<group>/<group>.fugr.json` + `sapl<group>.reps.*` + `l<group>top.reps.*` + 每 FM `.func.*` | [fugr.md](fugr.md) |
| `TABL` | ICF | `tabl/<name>/<name>.tabl.{json,ddic,settings.json}` 三件套 | [tabl.md](tabl.md) |
| `STRU` | ICF | `stru/<name>/<name>.stru.{json,ddic,settings.json}` 三件套 | [stru.md](stru.md) |
| `DOMA` | ICF | `doma/<name>/<name>.doma.json`（嵌套） | [doma.md](doma.md) |
| `DTEL` | ICF | `dtel/<name>/<name>.dtel.json`（嵌套） | [dtel.md](dtel.md) |
| `HTTP` | ICF | `http/<name>/<name>.http.json`（SICF 节点） | [http.md](http.md) |
| `TRAN` | ICF | `tran/<code>/<code>.tran.json`（SE93 事务码） | [tran.md](tran.md) |

## 路由速查

- **ADT**（源对象）：无需 ICF 部署；直接打 SAP ADT REST API；走 `abap-adt-api` 库
- **ICF** 自建（DDIC/HTTP/TRAN）：需要先 `abap extension deploy`；走 `/sap/zabap_vibe/<domain>/<type>/<name>`

## 详细决策

类型子目录布局的「为什么」见 [design-decisions/003-typesubdir-layout.md](../design-decisions/003-typesubdir-layout.md)；DDIC 走 ICF 而非 ADT 的「为什么」见 [design-decisions/002-icf-bypass-ddic.md](../design-decisions/002-icf-bypass-ddic.md)。

# references

- 路由矩阵：[`wiki/object-types.md`](../object-types.md)
- abap-file-format 导出约定：[`wiki/abap-file-format-export.md`](../abap-file-format-export.md)
