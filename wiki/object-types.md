---
type: reference
title: 支持的对象类型
description: abap CLI 支持的 ABAP 对象类型总览 — 51 个类型码 × create/pull/push/delete 路由（ADT / ICF）与本地 AFF 文件布局
tags: [abap-cli, object-types, ddic, http, sicf, reference]
created at: 2026-08-29 10:00:00
changed at: 2026-11-04 02:42:00
---

# 支持的对象类型

abap CLI 的类型注册表（`src/abap_cli/types/registry.ts`）覆盖 **51 个对象类型**：4 个 ABAP 源对象、1 个 ADT 包（DEVC）、8 个 DDIC 对象（含 VIEW / SHLP）、6 个 ICF 事务/转换/目标对象（HTTP / TRAN / XSLT / SM59 / SRFC / OA2P）、3 个双通道 DDIC/CDS 对象、6 个 CDS/RAP 对象、3 个 ATC 检查配置对象（CHKC / CHKO / CHKV）、5 个 CDS 技术对象（DTDC / DTEB / DSFD / DSFI / DRTY）、1 个类型池（TYPE）、3 个应用作业对象（SAJC / SAJT / JOBD）、5 个授权对象类型（AUTH / SUSC / SUCU / SUSH / SUSO）、6 个 AFF 对象（APLO / CHDO / EVTB / SMBC 走 ADT blueSource 读写；ENHO / ENHS 走 ICF 只读 pull）。分两条路由：**ADT** 与 **ICF**（含本地扩展格式）。

## 类型 × 命令矩阵

| 类型码 | 对象 | 路由 | `create` | `pull` | `push` | `delete` | `create local` | 本地文件（平铺 `src/`） |
|---|---|---|---|---|---|---|---|---|
| `CLAS` | 类 | ADT | 骨架 | ✅ | ✅ | ✅ | ✅ | `<name>.clas.json` + `<name>.clas.abap` + 各 include `.clas.<subtype>.abap` |
| `INTF` | 接口 | ADT | 骨架 | ✅ | ✅ | ✅ | ✅ | `<name>.intf.json` + `<name>.intf.abap` |
| `PROG` | 报表程序 | ADT | 骨架 | ✅ | ✅ | ✅ | ✅ | `<name>.prog.json` + `<name>.prog.abap`（include 为 `.prog.include.abap`） |
| `FUGR` | 函数组 | ADT | 骨架 | ✅ | ✅ | ✅ | ✅ | `<group>.fugr.json` + `.fugr.sapl<group>.reps.*` + `.fugr.l<group>top.reps.*` + 每 FM `.fugr.<fm>.func.*` |
| `DEVC` | 包（Package） | ADT | 包参数（`--package` = 父包，无需 `--file`） | ✅ | ❌（ADT 无更新端点） | ✅（不加锁） | ❌ | `<name>.devc.json` |
| `TABL` | 透明表 | ICF | `--file` | ✅ | ✅ | ✅ | ❌ | `<name>.tabl.{json,ddic,settings.json}` |
| `STRU` | 结构 | ICF | `--file` | ✅ | ✅ | ✅ | ❌ | `<name>.stru.{json,ddic}`（`.settings.json` 仅 TABL 有） |
| `DOMA` | 域 | ICF | `--file` | ✅ | ✅ | ✅ | ❌ | `<name>.doma.json`（可选伴生 `<name>.doma.docu.json`，长文本 0..1） |
| `DTEL` | 数据元素 | ICF | `--file` | ✅ | ✅ | ✅ | ❌ | `<name>.dtel.json`（可选伴生 `<name>.dtel.docu.json`，长文本 0..1） |
| `ENQU` | 锁对象 | ICF | `--file` | ✅ | ✅ | ✅（仅 `$TMP`） | ❌ | `<name>.enqu.json` |
| `VIEW` | 数据库视图 | ICF | `--file`（`view-v1.json`，本地扩展） | ✅ | ✅ | ✅（仅 `$TMP`） | ❌ | `<name>.view.json` |
| `SHLP` | 搜索帮助 | ICF | `--file`（`shlp-v1.json`，本地扩展；elementary/collective） | ✅ | ✅ | ✅（仅 `$TMP`） | ❌ | `<name>.shlp.json` |
| `SM59` | HTTP 目标（RFCDES RFCTYPE=G） | ICF | `--file`（`sm59-v1.json`，本地扩展） | ✅ | ✅ | ✅（无 package/传输，拒绝 `--package` / `--tr`） | ❌ | `<name>.sm59.json` |
| `SRFC` | UCON RFC service | ICF | `--file`（`srfc-v1.json`，本地扩展） | ✅ | ✅ | ✅（TADIR 对象，`--package` / `--tr` 适用） | ❌ | `<name>.srfc.json` |
| `OA2P` | OAuth 2.0 client profile | ICF | `--file`（`oa2p-v1.json`，本地扩展） | ✅ | ✅ | ✅（TADIR 对象，`--package` / `--tr` 适用；被 client 分配时拒绝删除） | ❌ | `<name>.oa2p.json` |
| `NROB` | 编号范围对象 | ICF（pull 主 ADT + ICF 兜底） | `--file` | ✅ | ✅ | ✅（仅 `$TMP`） | ❌ | `<name>.nrob.json` |
| `HTTP` | **ICF / SICF 节点** | ICF | `--file`（仅 `$` 前缀本地包） | ✅ | ✅（仅 `$` 前缀本地包） | ✅（仅 `$` 前缀本地包；根节点/有子节点/可传输节点除外） | ❌ | `<name>.http.json` |
| `TRAN` | 事务码 (SE93) | ICF | `--file` | ✅ | ✅ | ✅（仅 `$TMP`） | ❌ | `<code>.tran.json` |
| `XSLT` | 转换程序（XSLT Program） | ICF | `--file` | ✅ | ✅ | ✅ | ❌ | `<name>.xslt.{json,xml}` 两件套 |
| `TTYP` | 表类型 | auto（ADT 主 / ECC ICF 兜底） | `--file` | ✅ | ✅ | ✅ | ❌ | `<name>.ttyp.json`（纯元数据，无 ABAP 侧车） |
| `MSAG` | 消息类 | auto（ADT 主 / ECC ICF 兜底） | `--file` | ✅ | ✅ | ✅ | ❌ | `<name>.msag.json` |
| `DDLS` | CDS 视图 | ADT | `--file` | ✅ | ✅ | ✅ | ❌ | `<name>.ddls.{json,acds}` |
| `SRVB` | Service Binding (metadata only) | ADT | `--file` | ✅ | ❌ | ✅ | ❌ | `<name>.srvb.json` |
| `SRVD` | Service Definition | ADT | `--file` | ✅ | ✅ | ✅ | ❌ | `<name>.srvd.{json,acds}` |
| `BDEF` | Behaviour Definition | ADT | `--file` | ✅ | ✅ | ✅ | ❌ | `<name>.bdef.{json,abdl}` |
| `DCLS` | CDS Access Control | ADT | `--file` | ✅ | ✅ | ✅ | ❌ | `<name>.dcls.{json,acds}` |
| `DDLX` | CDS Metadata Extension | ADT | `--file` | ✅ | ✅ | ✅ | ❌ | `<name>.ddlx.{json,acds}` |
| `DDLA` | CDS Annotation Definition | ADT | `--file` | ✅ | ✅ | ✅ | ❌ | `<name>.ddla.{json,acds}` |
| `CHKC` | ATC Check Category | ADT | `--file` | ✅ | ✅ | ✅ | ❌ | `<name>.chkc.json` |
| `CHKO` | ATC Check | ADT | `--file` | ✅ | ✅ | ✅ | ❌ | `<name>.chko.json` |
| `CHKV` | ATC Check Variant | ADT | `--file` | ✅ | ✅ | ✅ | ❌ | `<name>.chkv.json` |
| `DTDC` | Dynamic Cache | ADT | `--file` | ✅ | ✅ | ✅ | ❌ | `<name>.dtdc.{json,acds}` |
| `DTEB` | CDS Entity Buffer | ADT | `--file` | ✅ | ✅ | ✅ | ❌ | `<name>.dteb.{json,acds}` |
| `DSFD` | Scalar Function Definition | ADT | `--file` | ✅ | ✅ | ✅ | ❌ | `<name>.dsfd.{json,acds}` |
| `DSFI` | Scalar Function Impl. Reference | ADT | `--file` | ✅ | ✅ | ✅ | ❌ | `<name>.dsfi.json` |
| `DRTY` | CDS Type (simple type) | ADT | `--file` | ✅ | ✅ | ✅ | ❌ | `<name>.drty.{json,acds}` |
| `TYPE` | Type Pool | ADT | `--file` | ✅ | ✅ | ✅ | ❌ | `<name>.type.{json,abap}` |
| `SAJC` | 应用作业目录条目 | ADT | `--file` | ✅ | ✅ | ✅ | ❌ | `<name>.sajc.json` |
| `SAJT` | 应用作业模板 | ADT | `--file` | ✅ | ✅ | ✅ | ❌ | `<name>.sajt.json` |
| `JOBD` | 应用作业定义（SM36） | ICF | `--file`（`jobd-v1.json`，本地扩展） | ✅ | ✅ | ✅ | ❌ | `<name>.jobd.json` |
| `AUTH` | 授权字段（SU20） | ICF | `--file`（`auth-v1.json`，本地扩展） | ✅ | ✅ | ✅ | ❌ | `<token>.auth.json` |
| `SUSC` | 授权对象类（SU21） | ICF | `--file`（`susc-v1.json`，本地扩展） | ✅ | ✅ | ✅ | ❌ | `<token>.susc.json` |
| `SUCU` | 授权组（TBRG_AUTH） | ICF | `--file`（`sucu-v1.json`，本地扩展；名称 `<GROUP>~<OBJECT>`） | ✅ | ✅ | ✅（仅 `$` 本地包） | ❌ | `<group>~<object>.sucu.json` |
| `SUSH` | SU22 授权缺省值分配 | ICF | `--file`（上游 AFF `sush-v1`；`create` 仅 `RF`） | ✅ | ✅ | ✅ | ❌ | `<name>_<type>.sush.json` |
| `SUSO` | 授权对象（SU21） | ICF | `--file`（`suso-v1.json`，本地扩展） | ✅ | ✅ | ✅ | ❌ | `<token>.suso.json` |
| `AUTH` | 授权字段（SU20） | ICF | `--file`（`auth-v1.json`，本地扩展） | ✅ | ✅ | ✅ | ❌ | `<token>.auth.json` |
| `SUSC` | 授权对象类（SU21） | ICF | `--file`（`susc-v1.json`，本地扩展） | ✅ | ✅ | ✅ | ❌ | `<token>.susc.json` |
| `SUCU` | 授权组（TBRG_AUTH） | ICF | `--file`（`sucu-v1.json`，本地扩展；名称 `<GROUP>~<OBJECT>`） | ✅ | ✅ | ✅（仅 `$` 本地包） | ❌ | `<group>~<object>.sucu.json` |
| `SUSH` | SU22 授权缺省值分配 | ICF | `--file`（上游 AFF `sush-v1`；`create` 仅 `RF`） | ✅ | ✅ | ✅ | ❌ | `<name>_<type>.sush.json` |
| `SUSO` | 授权对象（SU21） | ICF | `--file`（`suso-v1.json`，本地扩展） | ✅ | ✅ | ✅ | ❌ | `<token>.suso.json` |
| `AUTH` | 授权字段（SU20） | ICF | `--file`（`auth-v1.json`，本地扩展） | ✅ | ✅ | ✅ | ❌ | `<token>.auth.json` |
| `SUSC` | 授权对象类（SU21） | ICF | `--file`（`susc-v1.json`，本地扩展） | ✅ | ✅ | ✅ | ❌ | `<token>.susc.json` |
| `SUCU` | 授权组（TBRG_AUTH） | ICF | `--file`（`sucu-v1.json`，本地扩展；名称 `<GROUP>~<OBJECT>`） | ✅ | ✅ | ✅（仅 `$` 本地包） | ❌ | `<group>~<object>.sucu.json` |
| `SUSH` | SU22 授权缺省值分配 | ICF | `--file`（上游 AFF `sush-v1`；`create` 仅 `RF`） | ✅ | ✅ | ✅ | ❌ | `<name>_<type>.sush.json` |
| `SUSO` | 授权对象（SU21） | ICF | `--file`（`suso-v1.json`，本地扩展） | ✅ | ✅ | ✅ | ❌ | `<token>.suso.json` |
| `AUTH` | 授权字段（SU20） | ICF | `--file`（`auth-v1.json`，本地扩展） | ✅ | ✅ | ✅ | ❌ | `<token>.auth.json` |
| `SUSC` | 授权对象类（SU21） | ICF | `--file`（`susc-v1.json`，本地扩展） | ✅ | ✅ | ✅ | ❌ | `<token>.susc.json` |
| `SUCU` | 授权组（TBRG_AUTH） | ICF | `--file`（`sucu-v1.json`，本地扩展；名称 `<GROUP>~<OBJECT>`） | ✅ | ✅ | ✅（仅 `$` 本地包） | ❌ | `<group>~<object>.sucu.json` |
| `SUSH` | SU22 授权缺省值分配 | ICF | `--file`（上游 AFF `sush-v1`；`create` 仅 `RF`） | ✅ | ✅ | ✅ | ❌ | `<name>_<type>.sush.json` |
| `SUSO` | 授权对象（SU21） | ICF | `--file`（`suso-v1.json`，本地扩展） | ✅ | ✅ | ✅ | ❌ | `<token>.suso.json` |
| `APLO` | 应用日志对象 | ADT（blueSource） | `--file` | ✅ | ✅ | ✅ | ❌ | `<name>.aplo.json` |
| `CHDO` | 更改凭证对象 | ADT（blueSource） | `--file` | ✅ | ✅ | ✅ | ❌ | `<name>.chdo.json` |
| `EVTB` | 事件绑定 | ADT（blueSource） | `--file` | ✅ | ✅ | ✅ | ❌ | `<name>.evtb.json` |
| `SMBC` | 业务配置维护对象 | ADT（blueSource；参考系统未验证） | `--file` | ✅ | ✅ | ✅ | ❌ | `<name>.smbc.json` |
| `ENHO` | 增强实现（仅 BAdI） | ICF（**仅 pull**） | ❌（只读） | ✅ | ❌（只读） | ❌（只读） | ❌ | `<name>.enho.json` |
| `ENHS` | 增强点（仅 BAdI） | ICF（**仅 pull**） | ❌（只读） | ✅ | ❌（只读） | ❌（只读） | ❌ | `<name>.enhs.json` |

> **`create local` 只支持 `CLAS` / `INTF` / `PROG` / `FUGR`**（`formats/templates.ts` 只有这四类模板），其余类型一律 `TYPE_NOT_SUPPORTED`（exit 7）。`SRVD` / `DCLS` / `DDLX` / `DDLA` 在 SAP 侧可创建（`createObjtype`），但没有本地骨架模板；`create local` 会拒绝它们并提示改用 `abap create <type> --file <aff.json>`。
> **`create` 的 `--file` 是数据驱动必填项**（`types/registry.ts` 的 `ObjectTypeEntry.requiresFile`）：`TABL` / `STRU` / `DOMA` / `DTEL` / `ENQU` / `JOBD` / `NROB` / `HTTP` / `TRAN` / `XSLT` / `TTYP` / `MSAG` / `DDLS` / `BDEF` / `SRVB` / `SRVD` / `DCLS` / `DDLX` / `DDLA` / `CHKC` / `CHKO` / `CHKV` / `DTDC` / `DTEB` / `DSFD` / `DSFI` / `DRTY` / `TYPE` / `SAJC` / `SAJT` / `SM59` / `SRFC` / `OA2P` 缺 `--file` 直接 `USAGE`（exit 2）。`BDEF` 还需同目录的 `.bdef.abdl` 源码；`SRVB` 创建后可用 `--publish` 发布（publish job 受系统 transport 设置约束），push/update 不支持。`SM59` 的 `--file` 文件名必须与目标名一致（`<name>.sm59.json`），因为没有 `name` 字段承载身份。`ENHO` / `ENHS` 是只读类型，没有 `create` 路径（见「AFF 对象：ADT blueSource 与 ICF 只读」）。
> **`ENQU` / `NROB` 的 create/delete 仅支持本地包（`$` 前缀）**：可传输创建/删除需要额外写 TADIR 记录，ICF 服务对非本地包直接拒绝（`ENQU_PACKAGE_NOT_SUPPORTED` / `NROB_PACKAGE_NOT_SUPPORTED`、`ENQU_DELETE_UNSUPPORTED` / `NROB_DELETE_UNSUPPORTED`）。`ENQU` 删除先回填本地 TADIR 行再走 `RS_DD_DELETE_OBJ`；`NROB` 删除清空区间后走 `NUMBER_RANGE_OBJECT_DELETE`。可传输对象请在 SE11（ENQU）/ SNRO（NROB）删除。`TEST...` 前缀的包不视为本地。（真机：`$` 前缀本地包中 ENQU/NROB create → delete 通过，TADIR/DD25L/TNRO 无残留；证据 `tests/261102013-enqu-nrob-delete/`，本地不入库。）

> **`TRAN` 写路径已实现**：ABAP `/tran/<code>` 支持 GET / POST / PUT / DELETE，覆盖 dialog / report（含 report variant）/ parameter / variant 四种事务；OO 事务返回 `TRAN_OO_NOT_SUPPORTED`（规范 FM 没有 class/method 参数，仍用 SE93 维护）。`delete` 只支持 `$TMP` 事务（可传输事务请在 SE93 删除以便记录到请求）。类型页面：[tran](objects/tran.md)。
> **`XSLT` 两件套**：`<name>.xslt.json`（AFF xslt-v1 元数据）+ `<name>.xslt.xml`（源码）必须成对存在；SAP 侧走 ICF `/xslt/<name>` + `CL_O2_API_XSLTDESC`，更新语义是**原地更新并保留版本历史**（`load` → `set_source` → `save` → `activate`）。行尾统一规范化（SAP 读回多一个 CRLF）。类型页面：[xslt](objects/xslt.md)。

> **`SM59` HTTP 目标新增**：ABAP `/sm59/<name>` 支持 GET / POST / DELETE，覆盖 SM59 的 HTTP connection to external server（RFCTYPE='G'）：target host / port / protocol / path prefix / 描述。本地格式 `sm59-v1.json` 是**本地扩展**（上游 AFF 无 SM59 格式）；目标写在 client-independent 系统表 `RFCDES`（描述在 `RFCDOC`），没有 package、无法进 CTS 传输请求——`--package` / `--tr` 显式拒绝（exit 7），需要在每个系统单独 create。SAP 侧走标准维护 API `SRFC_DESTAPI`；create 使用 API 默认值，push 保留 API 已加载的选项值，但维护 API 会在 save 时重建 `RFCOPTIONS`，因此对 SAP 自带目标 push 会丢掉 API 不认识的 legacy option 代码（v1 自己 create 的目标 pull→push 稳定）。描述按语言存 `RFCDOC`（≤72 字符，pull 回退任意语言行）。GUI 确认弹窗保留名被拒绝（`SM59_NAME_INVALID`，请在 SM59 维护）。其它 RFCTYPE（`3` / `I` / `T` / `L` …）在 pull / push / delete 时返回 `SM59_TYPE_NOT_SUPPORTED`（exit 7）。类型页面：[sm59](objects/sm59.md)。

> **`SRFC`（UCON RFC service）新增**：ABAP `/srfc/<name>` 支持 GET / POST / DELETE，本地扩展 `srfc-v1.json`（functionName / scope / defaultProfile / description）。读走公共 UCON RFC API，写走 `CL_UCONRFC_OBJECT_PERSIST`（UCONCOCKPIT 保存路径）+ `RS_CORR_INSERT`（TADIR / package / transport），写入后刷新 UCON RFC 运行时缓存；删除走 `CL_UCON_API_FACTORY=>DELETE_RFC_SERVICE`。function module 必须存在且 RFC-enabled，defaultProfile 必须存在于 `UCONPROFHEAD`；短文本按会话语言读写。communication assembly / RFC profile 不在范围。类型页面：[srfc](objects/srfc.md)。
>
> **`OA2P`（OAuth 2.0 client profile）新增**：ABAP `/oa2p/<name>` 支持 GET / POST / DELETE，本地扩展 `oa2p-v1.json`（type / noAuthCheck / scopes）。走 OA2P Workbench 持久化类 + `RS_CORR_INSERT`（TADIR / package / transport）；provider type 必须存在于 `OA2C_TYPES`；被 OAuth 2.0 client 分配的 profile 拒绝删除（`OA2P_PROFILE_IN_USE`）；没有描述字段与激活步骤。OAuth 2.0 client 与 profile 的分配仍在 `OA2C_CONFIG`。类型页面：[oa2p](objects/oa2p.md)。

> **`JOBD` 写路径已实现（本地扩展 + ICF）**：上游 AFF 没有 JOBD 格式、参考 release 也没有 ADT 资源，所以本地格式 `jobd-v1.json` 是**本地扩展**（镜像 `CL_JR_JOB_DEFINITION=>TY_JOB_DEFINITION`，去掉系统字段），SAP 侧走 ICF `/jobd/<name>`（GET/POST/PUT/DELETE）。写入即保存激活（`--no-activate` 被拒绝）；`create/push/delete` 用 `RS_CORR_INSERT` 记录 TADIR（可传输包带 `--tr`），类的 `CREATE_JD`/`MODIFY_JD` 负责落库，handler 再把写入时临时用的 `$TMP` 包改回真实包。名称上限 32 字符；不含 `CL_JR_JOB_DEFINITION` 的 release 返回 `JOBD_UNSUPPORTED`（exit 7）。类型页面：[jobd](objects/jobd.md)。

> **`SHLP` 写路径已实现（真机 18/18 TC 通过）**：ABAP `/ddic/shlp` 支持 GET / POST / PUT / DELETE（`DDIF_SHLP_GET` / `RS_CORR_INSERT` + `DDIF_SHLP_PUT` + `DDIF_SHLP_ACTIVATE`；删除 `$TMP` 搜索帮助用 `RS_DD_DELETE_OBJ(no_ask, objtype='H')`）。本地格式 `shlp-v1.json` 是**本地扩展**——覆盖 elementary（selectionMethod + 参数）与 collective（includedSearchHelps + parameterMappings）；名称上限 30 字符。类型页面：[shlp](objects/shlp.md)。

> **`VIEW` 写路径已实现（真机 17/17 TC 通过）**：ABAP `/ddic/view` 支持 GET / POST / PUT / DELETE（`DDIF_VIEW_GET` / `RS_CORR_INSERT` + `DDIF_VIEW_PUT` + `DDIF_VIEW_ACTIVATE`；删除 `$TMP` 视图用 `RS_DD_DELETE_OBJ(no_ask)`，可传输视图请在 SE11 删除）。本地格式 `view-v1.json` 是**本地扩展**——上游 abap-file-formats 没有 view 格式，字段按 DD25V/DD26V/DD27P/DD28J/DD28V 设计；视图名上限 16 字符。类型页面：[view](objects/view.md)。

本地产物一律平铺在 `src/` 下（无类型/对象子目录），文件名自带类型后缀；命名空间用 AFF 括号 token（`/UI2/CL_JSON` → `(ui2)cl_json`）。DDIC（TABL / STRU）与 DOMA / DTEL 的详细字段契约见 [create](commands/create.md) 与 [pull](commands/pull.md)。

> **DOMA / DTEL 长文本是伴生文件，不是新对象类型**：`<name>.doma.docu.json` / `<name>.dtel.docu.json` 遵循 AFF `docu-v1.json`，0..1 可选；`abap types` / `abap create` 不列 `DOCU`，pull / push 自动带出（`lines: []` = 删除远端长文本）。字段与行约束见 [doma](objects/doma.md) / [dtel](objects/dtel.md)。

## HTTP —— 就是 SICF 节点

> **类型码是 `HTTP`，它就是 SICF 事务里的 ICF 服务节点**。旧版 `SICF` 别名已在 1.0.0 删除（见 CHANGELOG 的 Removed 段）：`--type SICF` / `create SICF` 不再自动映射为 `HTTP`，会得到未知类型错误。新脚本请直接写 `HTTP`。

`HTTP` 类型可读可写：handler class、URL、描述、父节点校验。写入（create / push / delete）仅支持 `$` 前缀本地包——内置 ICF 服务无法把变更记录进传输请求；可传输 SICF 节点请在事务 SICF 维护，CLI 只读查看。

```bash
# 拉一个已有 SICF 节点（可传输节点也可以，用于只读查看）
abap pull ZMY_SERVICE --type HTTP --json

# 创建（必须 --file，走真实 SAP；只支持本地包）
abap create HTTP ZMY_SERVICE --file src/zmy_service.http.json --package '$TMP' --description "My service"

# 改完推回（pulled 文件不带 package 时保留节点现有的本地包）
abap push src/zmy_service.http.json --yes

# 删除本地 SICF 节点（根节点 / 有子节点 / 可传输节点请在 SICF 删除）
abap delete ZMY_SERVICE --type HTTP --yes
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

## AFF 对象：ADT blueSource 与 ICF 只读

六类官方 AFF 对象按**能力**分两条通道（用户命令面不变，仍是 `abap create/pull/push/delete <TYPE>` + 本地官方 AFF JSON）：

| 类型 | 通道 | 能力 | 说明 |
|---|---|---|---|
| `APLO` / `CHDO` / `EVTB` / `SMBC` | **ADT blueSource** | create / pull / push / delete | 对象的 ADT 资源把官方 AFF JSON 直接作为 `source/main`；lock / 保存即激活 / transport 由 ADT 生命周期承担，CLI 不做字段映射。`SMBC` 参考系统无对象，未真机验证（前置：SRVB service binding） |
| `ENHO` / `ENHS` | **ICF `/aff`（只读）** | 仅 pull | `GET /sap/abap_cli/aff/<TYPE>/<name>` 由 SAP AFF 框架序列化（需 `abap deploy`）。SAP 的 AFF handler 对这两类只读：create 门禁要求已存在 active 增强对象、persistence 的 save 是空实现、ENHS 删除实现是断言——因此 `create` / `push` / `delete` 不支持，写入需 SEEF API 适配（后续独立排期） |

- 本地文件都是 `<token>.<type>.json` 单文件（官方 schema 见 `src/abap_cli/schema/<type>-v1.json`）；`ENHO` / `ENHS` 的 pull 产物只用于阅读 / 比对，不能 push。
- `APLO` / `CHDO` / `EVTB` / `SMBC` 不需要 `abap deploy`；`ENHO` / `ENHS` 的 pull 需要。读操作都不需要 `--tr`；写操作按包是否 `$` 前缀决定是否要 `--tr`。
- 上游 AFF 的 `ENHO` / `ENHS` 格式只覆盖 BAdI 实现 / 定义。类型页：[aplo](objects/aplo.md) · [chdo](objects/chdo.md) · [evtb](objects/evtb.md) · [smbc](objects/smbc.md) · [enho](objects/enho.md) · [enhs](objects/enhs.md)。

## 两种 "ICF" 的区别

仓库里 "ICF" 指两件不同的事，别混淆：

| | 含义 | 对应 |
|---|---|---|
| **ICF 作为通道** | 自建服务 `/sap/abap_cli` 旁路 ADT，承载 DDIC CRUD / textpool **读** / `select` / `tcode` / `run` / `mime` / AFF 只读端点（`/aff/<TYPE>/<name>`，仅 ENHO/ENHS pull） | `abap deploy` / `deploy status` |
| **ICF 作为对象** | 被管理的 SICF 服务节点本身 | `--type HTTP` |

也就是说：**用 ICF（通道）来管理 ICF（节点）**。前者是前提，后者是能力——`--type HTTP` 依赖扩展已部署。

## 明确不支持

| 类型 | 状态 | 去向 |
|---|---|---|
| `ENHO` / `ENHS` 写入（create / push / delete） | 不支持（已知限制） | SAP AFF handler 对这两类只读（空保存 / 删除断言）；写入需 SEEF API 适配，后续独立排期；pull 已支持 |
| 非 BAdI 的增强（source-code plug-in 等） | 不支持 | 官方 AFF 增强格式只覆盖 BAdI |
| AMDP、CDS Table Function | 不支持 | 来源对象可用 `where-used` 查引用 |
| SAPscript / Smart Forms / Adobe Form | 不支持 | — |
| Web Dynpro / ITS / BSP | 不支持 | — |
| IDoc / ALE 配置、Workflow | 不支持 | — |
| Package（`DEVC`）更新/推送 | 不支持 | ADT 资源控制器拒绝 `PUT /sap/bc/adt/packages/<name>`；`create DEVC` / `pull DEVC` / `delete` 已支持，改包请在 SAP GUI 操作或删除后重建 |
| `TRAN` 写入 | OO 事务不支持 | 其余 4 类支持 `create` / `push` / `delete`（`$TMP`）；见 [tran](objects/tran.md) |
| Pool / Cluster Table | 不支持 | 仅 TABL / STRU |

> 注：原 0.2.x 文档中曾把 `TTYP`/`DDLS` 列为"显式 deferred"或"无实现"。实际后续演进中两者已完整支持 `pull` + `create`（`--file`）；但 **`create local` 从未支持过它们**——`create local` 仅 `CLAS` / `INTF` / `PROG` / `FUGR`。

## 常见误判

- `abap pull X --type SICF` / `abap create SICF ...` → **不会**再映射为 `HTTP`（别名已在 1.0.0 删除）；请直接写 `HTTP`。
- `create <type>` 的 `--schema` `allowedValues` 已是全 51 类：`CLAS, INTF, PROG, FUGR, DEVC, TABL, STRU, DOMA, DTEL, ENQU, VIEW, SHLP, JOBD, NROB, HTTP, TRAN, XSLT, SM59, SRFC, OA2P, AUTH, SUSC, SUCU, SUSH, SUSO, TTYP, MSAG, DDLS, SRVB, SRVD, BDEF, DCLS, DDLX, DDLA, CHKC, CHKO, CHKV, DTDC, DTEB, DSFD, DSFI, DRTY, TYPE, SAJC, SAJT, APLO, CHDO, EVTB, SMBC, ENHO, ENHS`（顺序以 `abap create --schema` 输出为准；`ENHO` / `ENHS` 虽在列表里，create 会在本地拒绝）。
- `DDIC_NOT_SUPPORTED` (exit 7) → 文件按 ICF 路由、但类型不在 `types/registry.ts` 的 51 类内时触发；已注册类型不会命中。
- `APLO` / `CHDO` / `EVTB` / `SMBC` 走 ADT blueSource，**不需要** `abap deploy`；`SM59` / `SRFC` / `OA2P` / `JOBD` / 授权族与 `ENHO` / `ENHS` 的 pull 需要 ICF 服务已部署 → 先 `abap deploy status`。
- `ENHO` / `ENHS` **只读**：`create` / `push` / `delete` 不支持（AFF handler 只读）。`abap pull` 正常工作，产物不能 push 回系统；维护请在 SE80 / SE11 / SEEF。
- CDS 家族（`DDLS`/`DCLS`/`DDLX`/`DDLA`）+ RAP 三件套（`SRVB`/`SRVD`/`BDEF`）走 ADT，**不**经 ICF。`SRVB` 支持 create/pull/delete，`create --publish` 可发布（push/update 不支持；publish 受系统 transport 设置约束）；`DDLS` / `SRVD` / `BDEF` / `DCLS` / `DDLX` / `DDLA` 支持 create/pull/push；`BDEF` 的 create 需要 `.bdef.json` + `.bdef.abdl` 两件套并激活。

# More

## todo

- [x] `SICF` → `HTTP` 别名在 1.0.0 删除（旧文档里的"自动映射"描述已同步删除）
- [x] `create <type>` `--schema` 补全 `allowedValues` 全 51 类（含 `ENQU`/`NROB`/`VIEW`/`SHLP`/`CHKC`/`CHKO`/`CHKV`/`DTDC`/`DTEB`/`DSFD`/`DSFI`/`DRTY`/`TYPE`/`SAJC`/`SAJT`/`SM59`/`SRFC`/`OA2P`/`AUTH`/`SUSC`/`SUCU`/`SUSH`/`SUSO`/`APLO`/`CHDO`/`EVTB`/`SMBC`/`ENHO`/`ENHS`）
- [x] 矩阵补全 `ENQU`/`NROB` 行、修正 `create local` 列（CDS/RAP 伴生对象不再落错误骨架）
- [x] AFF 对象按能力拆分通道：`APLO`/`CHDO`/`EVTB`/`SMBC` 走 ADT blueSource 读写，`ENHO`/`ENHS` 走 ICF 只读 pull
- [ ] `ENHO` / `ENHS` 写入路径（SEEF API 适配）→ 独立排期
- [ ] `SMBC` 真机验证（需先有 SRVB service binding 前置对象）
- [ ] 候选补充类型（BGQC / STRANS / UIAD…）的取舍与排期 → [roadmap](roadmap.md)
- [ ] `create` 的 help/description 文案随 registry 动态化

# references

- [create](commands/create.md)
- [pull](commands/pull.md)
- [push](commands/push.md)
- [deploy](commands/deploy.md)
- [roadmap（对象类型补充路线）](roadmap.md)
- [abap-file-format 规范来源（vendored schema）](../src/abap_cli/schema/README.md)
