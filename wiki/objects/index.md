---
type: reference
title: 对象类型详细文档索引
description: 每个 SAP 对象类型的字段契约、命令路径、本地文件形态与示例（51 个类型）
tags: [abap-cli, object-types, reference, clas, intf, prog, fugr, devc, tabl, stru, doma, dtel, enqu, view, shlp, jobd, nrob, http, tran, xslt, sm59, ttyp, msag, ddls, srvb, srvd, bdef, dcls, ddlx, ddla, chkc, chko, chkv, dtdc, dteb, dsfd, dsfi, drty, type, sajc, sajt, srfc, oa2p, auth, susc, sucu, sush, suso, aplo, chdo, evtb, smbc, enho, enhs]
created at: 2026-09-01 00:00:00
changed at: 2026-11-04 02:42:00
---

# 对象类型详细文档

每个对象类型一篇：字段契约 / 命令路径 / 本地文件形态 / abap-file-format 合规性 / 已知坑。

| 类型 | 路由 | 本地文件形态（平铺 `src/`） | 文档 |
|---|---|---|---|
| `APLO` | ADT（blueSource，AFF JSON 即 `source/main`） | `src/<name>.aplo.json`（应用日志对象） | [aplo.md](aplo.md) |
| `CHDO` | ADT（blueSource） | `src/<name>.chdo.json`（更改凭证对象） | [chdo.md](chdo.md) |
| `EVTB` | ADT（blueSource） | `src/<name>.evtb.json`（事件绑定） | [evtb.md](evtb.md) |
| `SMBC` | ADT（blueSource；参考系统无对象，未真机验证） | `src/<name>.smbc.json`（业务配置维护对象） | [smbc.md](smbc.md) |
| `ENHO` | ICF `/aff`（**仅 pull**） | `src/<name>.enho.json`（增强实现，仅 BAdI；只读） | [enho.md](enho.md) |
| `ENHS` | ICF `/aff`（**仅 pull**） | `src/<name>.enhs.json`（增强点，仅 BAdI；只读） | [enhs.md](enhs.md) |
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
| `SHLP` | ICF | `src/<name>.shlp.json`（搜索帮助，本地扩展 `shlp-v1.json`；elementary/collective） | [shlp.md](shlp.md) |
| `JOBD` | ICF（自建端点，无 ADT 资源） | `src/<name>.jobd.json`（应用作业定义，本地扩展 `jobd-v1.json`） | [jobd.md](jobd.md) |
| `NROB` | ICF | `src/<name>.nrob.json`（编号范围对象） | [nrob.md](nrob.md) |
| `HTTP` | ICF | `src/<name>.http.json`（SICF 节点） | [http.md](http.md) |
| `TRAN` | ICF | `src/<code>.tran.json`（SE93 事务码） | [tran.md](tran.md) |
| `XSLT` | ICF | `src/<name>.xslt.{json,xml}` 两件套（转换程序） | [xslt.md](xslt.md) |
| `SM59` | ICF | `src/<name>.sm59.json`（SM59 HTTP 目标，RFCTYPE='G'，本地扩展 `sm59-v1.json`） | [sm59.md](sm59.md) |
| `SRFC` | ICF | `src/<name>.srfc.json`（UCON RFC service，本地扩展 `srfc-v1.json`） | [srfc.md](srfc.md) |
| `OA2P` | ICF | `src/<name>.oa2p.json`（OAuth 2.0 client profile，本地扩展 `oa2p-v1.json`） | [oa2p.md](oa2p.md) |
| `AUTH` | ICF | `src/<token>.auth.json`（SU20 授权字段，本地扩展 `auth-v1.json`） | [auth.md](auth.md) |
| `SUSC` | ICF | `src/<token>.susc.json`（SU21 授权对象类，本地扩展 `susc-v1.json`） | [susc.md](susc.md) |
| `SUCU` | ICF | `src/<group>~<object>.sucu.json`（SU21 授权组，本地扩展 `sucu-v1.json`） | [sucu.md](sucu.md) |
| `SUSH` | ICF | `src/<name>_<type>.sush.json`（SU22 授权缺省值分配，上游 AFF `sush-v1`） | [sush.md](sush.md) |
| `SUSO` | ICF | `src/<token>.suso.json`（SU21 授权对象，本地扩展 `suso-v1.json`） | [suso.md](suso.md) |
| `TTYP` | ADT + ICF 兜底 | `src/<name>.ttyp.json`（纯元数据） | [ttyp.md](ttyp.md) |
| `TYPE` | ADT（无兜底） | `src/<name>.type.json` + `src/<name>.type.abap` | [type.md](type.md) |
| `SAJC` | ADT（无兜底） | `src/<name>.sajc.json`（应用作业目录条目，AFF 单 JSON） | [sajc.md](sajc.md) |
| `SAJT` | ADT（无兜底） | `src/<name>.sajt.json`（应用作业模板，AFF 单 JSON） | [sajt.md](sajt.md) |
| `MSAG` | ADT + ICF 兜底 | `src/<name>.msag.json` | [msag.md](msag.md) |
| `DDLS` | ADT（无兜底） | `src/<name>.ddls.{json,acds}` 两件套 | [ddls.md](ddls.md) |
| `SRVB` | ADT（无兜底） | `src/<name>.srvb.json`（Service Binding 元数据；create / pull / delete，无 push） | [srvb.md](srvb.md) |
| `SRVD` | ADT（无兜底） | `src/<name>.srvd.{json,acds}` 两件套（Service Definition） | [srvd.md](srvd.md) |
| `BDEF` | ADT（无兜底） | `src/<name>.bdef.{json,abdl}` 两件套（Behavior Definition；create / pull / push / delete） | [bdef.md](bdef.md) |
| `DCLS` | ADT（无兜底） | `src/<name>.dcls.{json,acds}` 两件套（CDS Access Control） | [dcls.md](dcls.md) |
| `DDLX` | ADT（无兜底） | `src/<name>.ddlx.{json,acds}` 两件套（CDS Metadata Extension） | [ddlx.md](ddlx.md) |
| `DDLA` | ADT（无兜底） | `src/<name>.ddla.{json,acds}` 两件套（CDS Annotation Definition） | [ddla.md](ddla.md) |
| `CHKC` | ADT（无兜底） | `src/<name>.chkc.json`（ATC 检查类别） | [chkc.md](chkc.md) |
| `CHKO` | ADT（无兜底） | `src/<name>.chko.json`（ATC 检查） | [chko.md](chko.md) |
| `CHKV` | ADT（无兜底） | `src/<name>.chkv.json`（ATC 检查变体） | [chkv.md](chkv.md) |
| `DTDC` | ADT（无兜底） | `src/<name>.dtdc.{json,acds}` 两件套（CDS 动态缓存） | [dtdc.md](dtdc.md) |
| `DTEB` | ADT（无兜底） | `src/<name>.dteb.{json,acds}` 两件套（CDS 实体缓冲） | [dteb.md](dteb.md) |
| `DSFD` | ADT（无兜底） | `src/<name>.dsfd.{json,acds}` 两件套（CDS 标量函数定义） | [dsfd.md](dsfd.md) |
| `DSFI` | ADT（无兜底） | `src/<name>.dsfi.json` 单 JSON（标量函数实现引用） | [dsfi.md](dsfi.md) |
| `DRTY` | ADT（无兜底） | `src/<name>.drty.{json,acds}` 两件套（CDS 简单类型） | [drty.md](drty.md) |

## 路由速查

- **ADT**（源对象）：无需 ICF 部署；直接打 SAP ADT REST API；走 `abap-adt-api` 库
- **ICF** 自建（DDIC/HTTP/TRAN/VIEW/SHLP/XSLT/JOBD/授权族）：需要先 `abap deploy`；走 `/sap/abap_cli/<domain>/<type>/<name>`（VIEW 为 `/ddic/view/<name>`，SHLP 为 `/ddic/shlp/<name>`，XSLT 为 `/xslt/<name>`，授权族为 `/auth/<sub>/<name>`）
- **ADT blueSource（AFF）**（APLO/CHDO/EVTB/SMBC）：对象的 `source/main` 就是官方 AFF JSON，ADT 负责 lock / 激活 / transport；create / pull / push / delete 全支持（SMBC 参考系统无对象未验证）
- **ICF `/aff`（AFF 只读）**（ENHO/ENHS）：需要先 `abap deploy`；`GET /aff/<TYPE>/<name>` 由 SAP AFF 框架序列化，**仅 pull**；这两类的 AFF handler 写/删实现不完整，`create` / `push` / `delete` 不支持
- **ADT + ICF 兜底**（TTYP/MSAG）：优先 ADT；ECC EHP5/6 内核（< 753）自动切 ICF，现代内核缺 ADT 端点时运行时降级，envelope 写 `data.channel` + `data.fallbackReason`
- **ADT 无兜底**（DDLS / SRVD / BDEF / DCLS / DDLX / DDLA / SRVB）：不发起 ICF 调用；DDLS 在旧内核直接硬错 `DDLS_NOT_SUPPORTED_ON_ECC`（exit 64）

## 详细决策

AFF 原生扁平布局的「为什么」见 [design-decisions/010-aff-flat-layout.md](../design-decisions/010-aff-flat-layout.md)（[003](../design-decisions/003-typesubdir-layout.md) 是已被取代的历史决策）；DDIC 走 ICF 而非 ADT 的「为什么」见 [design-decisions/002-icf-bypass-ddic.md](../design-decisions/002-icf-bypass-ddic.md)；AFF 对象按能力拆分 ADT blueSource / ICF 只读的「为什么」见 [design-decisions/016-aff-over-icf-vs-adt-bluesource.md](../design-decisions/016-aff-over-icf-vs-adt-bluesource.md)。

# references

- 路由矩阵：[`wiki/object-types.md`](../object-types.md)
- abap-file-format 规范来源（vendored schema）：[`src/abap_cli/schema/README.md`](../../src/abap_cli/schema/README.md)
