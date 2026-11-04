---
type: object-type
title: SUSO — 授权对象（SU21 Authorization Object）
description: SUSO 对象的路由、本地 suso-v1 文档（TOBJ/TOBJT/TACTZ/TOBJVOR* /DOKU）、SAP_ALL 重生成 opt-in、where-used 删除保护与真机证据
tags: [abap-cli, object-type, suso, icf, abap-file-format, su21, authorization, security]
created at: 2026-11-04 01:00:00
changed at: 2026-11-04 01:30:00
---

# SUSO — 授权对象（SU21 Authorization Object）

SU21 维护的授权对象（authorization object）。数据分布在 `TOBJ`（10 个有序授权
字段 + 对象类 + `FBLOCK`/`CONVERSION`）、`TOBJT`（短文本，按语言）、`TACTZ`
（许可活动）、`TOBJVORFLG`（SAP_NEW / SU22 trace / 关键性 / CDS 分类标志）、
`TOBJVOR` + `TOBJVORDAT`（按 release 的 SAP_NEW proposal 数据）、`TOBJ_ATTR`
（ABAP 语言版本）和 DOKU `UO` 长文本。TADIR 对象 `R3TR SUSO`。

上游 AFF 的 `suso-v1.json` 无法表达 DOKU 长文本、按 release 的 SAP_NEW 数据、
`TOBJ-FBLOCK`/`CONVERSION` 以及第三种（未设置）关键性状态，因此本地
`suso-v1.json` 是**本地扩展**：保留可精确映射的 AFF 段名/枚举名，补齐缺失数据。

## 路由（单通道 ICF）

| method | 作用 | CLI |
|---|---|---|
| `GET` | 读 `TOBJ*` / `TACTZ` / `TOBJ_ATTR` / DOKU + TADIR package → 文档 | `abap pull <name> --type SUSO` |
| `POST` | 创建（已存在 → `SUSO_ALREADY_EXISTS`） | `abap create SUSO <name> --file ... --package ... [--regenerate-profiles]` |
| `PUT` | 更新（全量文档语义） | `abap push <file>.suso.json [--regenerate-profiles]` |
| `DELETE` | 删除（where-used / 交付对象校验；可显式重生成权限配置） | `abap delete <name> --type SUSO [--tr] [--regenerate-profiles]` |

**SAP_ALL / SAP_NEW 权限配置重生成是显式 opt-in**：只有传
`--regenerate-profiles`（→ query `regenerateProfiles=true`）才会在写入/删除成功后
调用 `PRGN_AFTER_IMP_SUSO_SAP_ALL`。默认完全跳过，避免隐式改写系统权限数据。
参考系统 in-handler 实测约 11 秒（create）/ 12 秒（delete）。结果通过
`--json` 的 `data.profilesRegenerated`（push 时为文件条目的 `profilesRegenerated`）
返回；非 SUSO 类型传该参数会被拒绝。

## 本地文件形态

```
src/
└── <token>.suso.json
```

对象名是 `XUOBJECT` CHAR 10：普通 `Z...` 名小写（`ZCLI_SUSO1` →
`zcli_suso1`），命名空间用 AFF `(ns)name`（`/AIF/CDLOG` → `(aif)cdlog`）。
文档不写 `name` / `package`，`package` 只在 GET wire 上作为读侧元数据。

## `<token>.suso.json` 形状

```json
{
  "formatVersion": "1",
  "header": {
    "description": "AIF application log",
    "originalLanguage": "en",
    "abapLanguageVersion": "standard"
  },
  "generalInformation": {
    "objectClass": "AIFC",
    "fieldBlock": "",
    "conversion": false
  },
  "authorizationFields": [{ "authorizationField": "ACTVT" }],
  "permittedActivities": [{ "activity": "70" }],
  "objectAttributes": { "criticality": "notCritical", "classCopyToDefaultData": "withoutRestriction" },
  "sapNewRelevance": {
    "isRelevantToSapNew": false,
    "values": []
  },
  "classificationForCdsBdef": {
    "usageInOwnAuthContext": "notSpecified",
    "usageInPrivilegedBdefMode": "notSpecified"
  },
  "longText": "&DEFINITION&\nline one\n\nline three"
}
```

| 文档路径 | SAP | 说明 |
|---|---|---|
| `header.description` | `TOBJT-TTEXT`（原文语言） | ≤60 |
| `header.originalLanguage` | `TOBJT` / DOKU 语言（`T002` ISO） | 两位 ISO，小写 |
| `header.abapLanguageVersion` | `TOBJ_ATTR-ABAP_LANGUAGE_VERSION` | `standard` / `keyUser` / `cloudDevelopment` |
| `generalInformation.objectClass` | `TOBJ-OCLSS` | 4 字符，必须存在于 `TOBCT` |
| `generalInformation.fieldBlock` / `.conversion` | `TOBJ-FBLOCK` / `-CONVERSION` | 交付对象遗留标志 |
| `authorizationFields[]` | `TOBJ-FIEL1..FIEL0` | 1..10，有序 |
| `permittedActivities[]` | `TACTZ-ACTVT` | 2 字符；需要 `ACTVT` 在字段列表 |
| `objectAttributes.criticality` | `TOBJVORFLG-FLAG3` | `critical` / `notCritical` / `notSpecified` |
| `objectAttributes.classCopyToDefaultData` | `TOBJVORFLG-FLAG2` | `withoutRestriction` / `ifInSameApplComponent` / `ifInSameSoftwareComponent` / `ifInSameSoftwarePackage` / `notCopiedFromTraceData` |
| `sapNewRelevance.isRelevantToSapNew` | `TOBJVORFLG-FLAG1` | 布尔 |
| `sapNewRelevance.values[]` | `TOBJVORDAT`（release/lineNumber/field/low/high） | 服务端按文档合成 `TOBJVOR` 头 |
| `classificationForCdsBdef.*` | `TOBJVORFLG-FLAG4` / `FLAG5` | CDS 自有授权上下文 / privileged bdef |
| `longText` | DOKU id `UO`，object = 名字 | 原始文本行 `\n` 拼接，行 ≤72；SAPscript 指令（`&DEFINITION&`）原样保留 |

## 名称 / 文件名 / URL

- CLI 名：大写，≤10 字符，`^[A-Z0-9_]+$` 或 `/NS/NAME`；命名空间总长同样 ≤10。
- 非法名 → `SUSO_NAME_INVALID`（exit 7）。
- 文件 token：AFF `(ns)name` / 小写普通名，`nameFromToken` 反向还原。
- URL：`/auth/suso/<encodeURIComponent(name)>`。

## 写入语义（SAP 侧）

- 创建：校验文档 + SAP `CHECK_SUSO_GEN` 语义 → transport 规则 → `RS_CORR_INSERT`
  （TADIR + 请求）→ `SUSO_DARK_UPDATE(no_cts)`（写 `TOBJ`/`TOBJT`/`TACTZ`/
  `TOBJVORFLG`/`TOBJVOR*`/`TOBJ_ATTR`）→ DOKU `DOCU_UPD` → 可选重生成。
- 更新：先做 `CHECK_SUSO_GEN` 预检 → `corr_insert` 记录 → 全量 `SUSO_DARK_UPDATE`
  → 更新长文本与 FBLOCK/CONVERSION/FLAG3-5 → 可选重生成。
- 删除：`GET_SUSO_EDIT_MODE(id,'06')`（abapGit pre_check）拒绝被引用/交付对象
  （409 `SUSO_DELETE_REFUSED`，带 SAP 消息），通过后 `SUSO_DARK_DELETE(no_cts)`，
  按包归属删 TADIR，可选重生成。
- 长文本可 `\n` 保留空行；行长度受 `DOKTL-DOKTEXT` CHAR 72 限制。
- 无激活步骤；`--no-activate` / `--description` 被拒绝。

## 命令示例

```bash
# 读标准授权对象（只读）
abap pull /AIF/CDLOG --type SUSO --json

# 建（默认不重生成权限配置）
abap create SUSO ZCLI_SUSO1 --package '$TMP' --file src/zcli_suso1.suso.json --yes

# 改完推回，并显式要求重生成 SAP_ALL / SAP_NEW
abap push src/zcli_suso1.suso.json --regenerate-profiles --yes

# 删（引用中的对象会被拒绝；--regenerate-profiles 可选）
abap delete ZCLI_SUSO1 --type SUSO --regenerate-profiles --yes
```

## 已知限制 / 已知坑

- 重生成耗时约 11-12 秒（参考系统），客户端为 opt-in 路径放宽了超时；默认不执行。
- 被角色/事务/程序引用的授权对象删除被拒绝（返回 SAP 原文），需先解除引用。
- 交付对象（如 `/AIF/CDLOG`）不可编辑/删除，SAP 的 edit-mode 检查会拒绝。
- 长文本按 DOKU 行模型保存，超过 72 字符的行在写入前被拒绝。
- `TOBJVORFLG-ATTRIBUTES`（0 行非空）不往返；`ABAP_LANGUAGE_VERSION='X'` 归一为
  `standard`（有损但等价）。
- 文档只维护一种语言的原文本；其他语言的 `TOBJT` 行按 SAP 现有数据保留。

## 真机证据

参考系统 S/4HANA（SAP_BASIS 757，profile `test`）（`tmp/auth-family/evidence/suso.md`）：

- ICF `GET/POST/PUT/DELETE /auth/suso/<name>` 打通：创建后 GET 文档完整往返
  （含 `&DEFINITION&` 与空行的长文本）、PUT 全量更新成功、DELETE 成功且
  `TOBJ`/`TOBJT`/`TACTZ`/`TOBJVOR*`/`DOKU`/TADIR 无残留。
- 删除保护：被 `$TMP` 测试事务的起始授权引用时返回 `SUSO_DELETE_REFUSED`
  （SAP 原文 “used in programs”），解除引用后删除成功；交付对象 `/AIF/CDLOG`
  的 edit-mode 直接拒绝。
- 权限配置重生成：`regenerateProfiles=true` 时 create 实测 11,323 ms、delete
  11,870 ms，响应 `profilesRegenerated:true`；不带参数时完全跳过。
- 否例：404 `SUSO_NOT_FOUND`、400 payload / transport 负数、`SUSO_ALREADY_EXISTS`。
- mock 集成矩阵覆盖完整生命周期 + 重生成 opt-in；release-form ICF 部署与真实 CLI
  端到端由 Lead 的发布验证收口。

# references

- [对象类型矩阵](../object-types.md)
- [schema 说明（local extension 约定）](../../src/abap_cli/schema/README.md)
- 实现探针与完整命令输出：`tmp/auth-family/evidence/suso.md`（本地证据，不入库）
