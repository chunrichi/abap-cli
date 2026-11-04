---
type: object-type
title: SUSH — SU22 授权缺省值分配（Authorization Default Assignment）
description: SUSH 对象的路由、SU22 键 NAME.TYPE 与四种键类型、上游 AFF sush-v1 文档、RF-only 创建子集、TADIR 对象差异与真机证据
tags: [abap-cli, object-type, sush, icf, abap-file-format, su22, authorization]
created at: 2026-11-04 01:00:00
changed at: 2026-11-04 01:30:00
---

# SUSH — SU22 授权缺省值分配（Authorization Default Assignment）

SU22 的“应用”授权缺省值分配。键是 `USOBHASH` 的 `(NAME CHAR 30, TYPE CHAR 2)`，
`TYPE ∈ {RF, TR, HT, HS}`；数据分布在 `USOB_SM`（应用级维护模式）、`USOBX`
（分配的授权对象 + 维护状态）和 `USOBT`（字段值）。

`SUSH` 直接复用上游 SAP abap-file-formats 的 `sush-v1.json`（无本地扩展）：
上游模型正好对应当前 ADT SU22 模型，能无损覆盖必须往返的字段。

## 四种键类型与 TADIR 差异

| 键类型 | `NAME` 含义 | 前导对象 | TADIR 对象 |
|---|---|---|---|
| `RF` | RFC 函数模块名（≤30） | 函数模块/函数组 | `R3TR SUSH`（`NAME` padded 30 + `RF`） |
| `TR` | 事务码 | 事务 | 没有自己的 SUSH TADIR 记录（事务 `R3TR TRAN` 是前导对象） |
| `HT` | 前导 TADIR 对象的 30 字符 hash | TADIR 对象（`USOBHASH` 指向 `R3TR <object> <name>`） | `R3TR SUSH`（hash + `HT`） |
| `HS` | 外部服务的 30 字符 hash | 外部服务（`USOBHASH` 的 `SERVICE_TYPE` + `SERVICE`） | `R3TR SUSI`（hash + `HS`） |

`TR` / `HT` / `HS` 的键由 SAP 根据前导对象/事务/服务计算，CLI 无法在创建前命名，
因此 **`create` 只支持 `RF`**；其余键先维护前导对象，再 `abap pull` 取得键。
`pull` / `push` / `delete` 对四类已存在的键都可工作。

## 路由（单通道 ICF）

| method | 作用 | CLI |
|---|---|---|
| `GET` | 读 SU22 应用（四类键均可）→ 文档 + 读侧 `name` / `package` | `abap pull '<NAME>.<TYPE>' --type SUSH` |
| `POST` | 创建（仅 `RF`；其余 → `SUSH_UNSUPPORTED`） | `abap create SUSH '<NAME>.RF' --file ... --package ...` |
| `PUT` | 更新（前导应用不可变，只改维护模式/授权对象） | `abap push <name>_<type>.sush.json` |
| `DELETE` | 删除（SAP 的 SU22 依赖检查会拒绝“前导对象仍存在”的删除） | `abap delete '<NAME>.<TYPE>' --type SUSH [--tr]` |

## 本地文件形态

```
src/
└── <name>_<type>.sush.json
```

文件名 token 是 `<lower-name>_<lower-type>`（不带点，避免通用 AFF 路由把 `.TYPE`
切成类型后缀）：`zcli_tc_sush_fm_rf.sush.json`、`ocs_get_installed_comps_rf.sush.json`、
`(accgo)acmcm_mtm_build_rf.sush.json`。文档名是规范的 `<NAME>.<TYPE>`。

## `<name>_<type>.sush.json` 形状（上游 AFF `sush-v1`）

```json
{
  "formatVersion": "1",
  "header": {
    "description": "R3TR FUNC ZCLI_TC_SUSH_FM",
    "originalLanguage": "en",
    "abapLanguageVersion": "standard"
  },
  "generalInformation": {
    "applicationName": "ZCLI_TC_SUSH_FM",
    "applicationType": "FUNC",
    "maintenanceMode": "manual",
    "defaultValuesRequired": "yes"
  },
  "authorizationObjects": [
    {
      "authObjectName": "S_RFC",
      "maintenanceStatus": "defaultWithValues",
      "authObjectFieldValues": [
        { "authFieldName": "RFC_NAME", "authFieldLowValue": "ZCLI_TC_SUSH_FM" },
        { "authFieldName": "RFC_TYPE", "authFieldLowValue": "FUGR" },
        { "authFieldName": "ACTVT", "authFieldLowValue": "16" }
      ]
    }
  ]
}
```

| 文档字段 | SAP | 说明 |
|---|---|---|
| `generalInformation.applicationName` / `.applicationType` | 键 / 前导对象 | `RF` → `FUNC <函数模块>`；`TR` → `TRAN <事务码>`；`HT` → TADIR 对象类型 + 名；`HS` → `EXT_SERVICE` 类型 + 服务路径 |
| `generalInformation.maintenanceMode` | `USOB_SM-OKFLAG` | `manual` / `automatic` / `automaticBasisObjects` / `noDefaultValues` / `deprecated` / `obsolete` |
| `authorizationObjects[].maintenanceStatus` | `USOBX-OKFLAG` | `undefined` / `noDefault` / `defaultWithValues` / `defaultWithoutValues` / `inactiveValues` / `noAuthorizationCheck` |
| `authorizationObjects[].authObjectFieldValues[]` | `USOBT` 行 | 字段名 + low/high 值（≤40） |
| `header.abapLanguageVersion` | `USOB_SM-ABAP_LANGUAGE_VERSION` | `standard` / `cloudDevelopment` |
| `header.originalLanguage` | TADIR master language | 只在 pull 时提供，写入由会话语言决定 |

服务端把 AFF 枚举映射到 SAP 单字符值；`USOBX-OKFLAG='U'`（无 AFF 枚举）在 pull
时归一为 `undefined`（有损但语义一致）。

## 写入语义与已知限制

- 创建（仅 `RF`）：服务端校验前导函数模块存在且 RFC-enabled、函数组包与写入包
  一致 → `CL_SU22_ADT_OBJECT` 的 `CREATE(iv_no_cts=true)`（跳过对话态 authority
  check/enqueue）→ 记录 TADIR/transport → `UPDATE(iv_cts=false)` 写 `USOBX`/`USOBT`。
- 更新：先做 SU22 一致性预检（`CHECK` mode 03），再 `UPDATE`；前导应用字段只读，
  改了会返回 `SUSH_INVALID_PAYLOAD`；`TR` 的 `TSTC_SM` 头由 SAP 维护。
- 删除：SAP 的 SU22 `BEFORE_DEL` 会检查前导对象——前导对象仍存在时删除被拒绝
  （409 `SUSH_DELETE_REFUSED`，消息给出前导对象）。因此 CLI `delete` 实际只适用于
  “孤儿”应用（SUSH 数据还在、前导对象已不存在，例如跨系统导入残留）；正常清理
  请删除前导对象（会级联删除 SUSH 数据）。
- 无激活步骤；`--no-activate` / `--description` 被拒绝。
- `HT`/`HS` 的 hash 键、`TR` 的事务数据只读支持（`TR`/`HT`/`HS` create 返回
  `SUSH_UNSUPPORTED`）。

## 命令示例

```bash
# 读标准应用（只读）
abap pull OCS_GET_INSTALLED_COMPS.RF --type SUSH --json

# 建（只支持 RF；$TMP 免 --tr）
abap create SUSH ZCLI_TC_SUSH_FM.RF --package '$TMP' \
  --file src/zcli_tc_sush_fm_rf.sush.json --yes

# 改完推回（前导应用不可变）
abap push src/zcli_tc_sush_fm_rf.sush.json --yes

# 删（前导对象仍存在时 SAP 拒绝；先删前导对象）
abap delete ZCLI_TC_SUSH_FM.RF --type SUSH --yes
```

## 真机证据

参考系统 S/4HANA（SAP_BASIS 757，profile `test`）（`tmp/auth-family/evidence/sush.md`）：

- 读路径：标准 `OCS_GET_INSTALLED_COMPS.RF`、`TR`（`SMICM.TR`）、`HT` 对象
  （`USOBHASH` → TADIR 映射、`USOBT` 字段值）均能 pull 成 AFF 文档；非法名/
  未知键返回 `SUSH_NAME_INVALID` / `SUSH_NOT_FOUND`。
- 写路径：`$TMP` 测试应用 `ZCLI_TC_SUSH_FM.RF` 的 `PUT` 更新（维护模式 +
  `S_RFC` 维护状态/字段值）真实读写 `USOBX`/`USOBT` 并往返一致；
  `SUSH_ALREADY_EXISTS`（409）、非 `$` 包缺 transport（400）、`HT`/`TR` create
  `SUSH_UNSUPPORTED`、前导函数模块不存在/包不一致（400）均按契约返回。
- 删除：前导对象存在时返回 409 `SUSH_DELETE_REFUSED`；删除前导函数组后 SUSH
  数据级联清理、`USOBHASH`/`USOB_SM`/`USOBX`/`USOBT`/TADIR 无残留。
- mock 集成矩阵覆盖 `create → pull → push → pull → delete`（`RF`）与 RF-only
  创建子集；真实 SAP 的 CLI 端到端 create/delete 由 Lead 的发布验证收口。

# references

- [对象类型矩阵](../object-types.md)
- [schema 说明](../../src/abap_cli/schema/README.md)
- 实现探针与完整命令输出：`tmp/auth-family/evidence/sush.md`（本地证据，不入库）
