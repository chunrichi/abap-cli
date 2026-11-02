---
type: object-type
title: NROB — 编号范围对象（Number Range Object）
description: NROB 对象的 ICF 路由、interval / configuration 字段契约、Z/Y 命名规则
tags: [abap-cli, object-type, nrob, icf, abap-file-format, number-range, tnro, tnrot]
created at: 2026-09-16 00:00:00
changed at: 2026-11-03 00:20:00
---

# NROB — 编号范围对象（Number Range Object）

## 路由（单通道 ICF）

| 操作 | 端点 |
|---|---|
| create | `POST /sap/abap_cli/ddic/nrob` |
| pull | `GET /sap/abap_cli/ddic/nrob/<name>` |
| push | `GET`（存在性探测）→ `POST /sap/abap_cli/ddic/nrob` |
| delete | `DELETE /sap/abap_cli/ddic/nrob/<name>`（仅 `$TMP`） |

`abap-adt-api` 没有 NROB 端点（NW 7.93 / S/4HANA 上的 ADT collection 是只读，2026-09-16 实测），ICF 是唯一读写路径。registry 里标 `source: 'ADT'` 并不代表 NROB 有 ADT 写通道：`routing.ts` 里 NROB 的 create / push 固定 `icf`，pull 是 `auto`（ADT 优先 + ICF fallback）。`resolveFile` 给出 `route: 'adt'`，但 `pushOne` 用 `PUSH_ROUTES.NROB`（`aff-json`）在通用源码分支**之前**拦截。pull 路径有 ADT 优先 + ICF fallback（`fallbackReason: 'ECC_EHP6_NO_ADT_NROB'`，2026-09-17 之前是硬编码在 `pull-nrob.ts` 里的字面量；registry 字段已删）。

ICF handler 由 `zcl_abap_vibe_icf` 的 `/ddic/nrob` 分支 + `zcl_abap_vibe_nrob_format` 提供。

## 本地文件形态

```
src/
└── znr_doc_id.nrob.json
```

单文件，无侧车。

## `ZNR_DOC_ID.nrob.json` 形状

```json
{
  "formatVersion": "1",
  "header": {
    "description": "Document ID",
    "originalLanguage": "en"
  },
  "interval": {
    "numberLengthDomain": "ZNR_DOC_ID",
    "percentWarning": 10,
    "subType": "ZDE_DOC_ID",
    "untilYear": false,
    "rolling": true,
    "prefix": false
  },
  "configuration": {
    "buffering": "mainBuffer",
    "bufferedNumbers": 10
  }
}
```

## 关键字段

### `interval`（键全部必填）

AFF schema 要求 `interval` 的六个键都存在；`subType` 的值允许是空字符串——空值表示编号范围对象**没有子对象**（SAP 的普通 NRIV 编号，SE11 里 Subobject 留空），ICF 创建接受该形态。

| 字段 | 类型 | 说明 |
|---|---|---|
| `numberLengthDomain` | string | 决定编号长度的域（NUMC/CHAR，1–20 位）——与编号范围对象名是两个概念 |
| `percentWarning` | number | 剩余编号告警阈值，0.1–99.9，步长 0.1 |
| `subType` | string | 子对象绑定用的数据元素（需有检查表，域长 1–6）；空字符串 = 无子对象 |
| `untilYear` | boolean | 是否按会计年度区分区间 |
| `rolling` | boolean | 区间用尽后是否回卷 |
| `prefix` | boolean | 编号是否带子对象前缀 |

### `configuration`

| 字段 | 类型 | 说明 |
|---|---|---|
| `buffering` | string | 缓冲模式枚举：`mainBuffer` / `parallel` / `none`，默认 `mainBuffer` |
| `bufferedNumbers` | integer | 缓冲区预留编号数，0–99999999，默认 10 |
| `transactionId` | string | 可选，应用专用事务码（≤ 20 字符） |

## 命名规则

编号范围对象名必须以 `Z` / `Y` / `/` 开头，否则 `create` 在本地即报 `INVALID_ARGUMENT`（exit 2），不发起 SAP 调用。

名称长度上限是 **10 字符**：名字是 `TNRO-NROBJ` 键，域 `NROBJ` 为 CHAR 10（2026-11-03 在 S/4HANA 上通过 ADT 读取域定义实测，与 `TNRO` DDL 的 `object : nrobj` 一致）。超长名字不会被 SAP 拒绝，而是静默截断到前 10 字符（实测传入 12 字符 `ZCLI_TCNROBX` 时创建出 `ZCLI_TCNRO`）；`create` 与 `delete` 现在都在本地预检，超长抛 `NROB_NAME_INVALID`（exit 7），不会发出 SAP 调用。

## 当前实现状态

**完整 round-trip 已验证**（commit `cb6ff30`，vhcala4hci 2026-09-17）。

### AFF → TNRO / TNROT 映射（实测数据元素长度）

| 数据元素  | 类型  | 长度 |
|---------|-------|------|
| nrobj   | CHAR  | 10   |
| nrobjtxt | CHAR  | 60   |
| nrobjstxt | CHAR | 20   |
| nrlendom / nrsobjnam / nrnrname / nrnrsubobj / nrnrelem | CHAR | 30 |
| nrperc  | DEC   | 3,1  |
| nrswap / nryearind / nrtextind / nrignore / nrcheckascii | AS4FLAG (CHAR) | 1 |
| nrbuffer | NRBUFFERTYPE | 1 |
| nrivbuffer | NUMC | 8 |

### 字段映射

| AFF 路径 | 写入 TNRO/TNROT 列 | 转换 |
|---|---|---|
| `header.description` | TNROT.txt | 直接赋 |
| `header.description`（≤20 字符时） | TNROT.txtshort | 直接赋 |
| `header.description`（>20 字符时） | TNROT.txtshort | `description(20)`（先 strlen 防 dump） |
| `header.originalLanguage` | TNROT.langu | `language_key_from_code('en'/'de'/...)` 反查 |
| `interval.numberLengthDomain` | TNRO.domlen | `to_upper(...)` |
| `interval.percentWarning` | TNRO.percentage | `CONV nrperc(string)` |
| `interval.subType` | TNRO.dtelsobj | `to_upper(...)` |
| `interval.untilYear` | TNRO.yearind | `COND abap_bool( WHEN true THEN 'X' )` |
| `interval.rolling` | TNRO.nonrswap | **反义**：`nonrswap='X'` iff `rolling=false`（SAP 语义：`nonrswap` = "no rollover"） |
| `interval.prefix` | — | 不映射（SNRO element group） |
| `configuration.buffering` | TNRO.buffer | `mainBuffer→'X'` / `parallel→'P'` / `none→' '`（NRBUFFERTYPE 域 fixed values） |
| `configuration.bufferedNumbers` | TNRO.noivbuffer | `CONV nrivbuffer(...)` |
| `configuration.transactionId` | TNRO.rfcdest | `to_upper(...)`（如果非空） |

### 不进 SAP 的字段

- `interval.prefix` —— TNRO 无对应列，SNRO 通过 element group 配置
- `nrtab` / `nrintfld` / `nrextfld` / `nrfld` / `nrsobjfld` / `nrelefld` / `nreltxt*` / `code` / `textind` / `nrcheckascii` / `ignore_group` / `abap_language_version` / `status` / `changed_at/by` / 审计字段 —— 留 SAP 默认值

### 只在 SAP GUI 维护的字段

- **NRIV interval 数据**（fromnumber / tonumber / nrlevel / externind / toyear / subobject / nrrangenr）—— AFF schema `nrob-v1.json` 不暴露 interval 行；CLI 只创建 object 声明，intervals 走 SNRO GUI 维护
- **textind / code / element group prefix** —— SE11 / SNRO GUI 维护

## 实施细节（踩过的坑）

1. **`NUMBER_RANGE_OBJECT_UPDATE` 在非 dialog 模式下不会 MODIFY 表** —— FM 全文（`/sap/bc/adt/functions/groups/snr2/fmodules/number_range_object_update/source/main`）只在内存里 `g_tnro_act = object_attributes; xtnrot = object_text;`，实际写表由 SAPMSNR2 / SAPMSNUM dialog driver 做。ICF 路径走 batch，必须自己 `INSERT tnro / INSERT tnrot / COMMIT WORK AND WAIT`。
2. **`nrobjstxt` 是 CHAR 20 不是 30** —— `description(30)` 在 description 短时 substr 表达式本身 dump "Subfield access offset=0 length=30 on size-28 data object"。先 strlen 再分支。
3. **CLI 必须把 `name` 放进 wire body** —— ABAP 路径正则 `^/ddic/(...)/(.+)?$` 把 `/ddic/nrob` 的 name 段视为可选；CLI POST `/ddic/nrob`（无名字段）→ `lv_match_name` 空；body 里也得有 `name`，否则 `INVALID_ARGUMENT`。
4. **`lv_name TYPE nrobj` = CHAR 10** —— 客户端送 12 字符名字，ABAP 自动截到 10，CLI 显示用 SAP 实际写的名字。
5. **`subType` 非空时必须有检查表、域长 1–6** —— `EBELP`(NUMC 5) / `BUKRS`(CHAR 4) / `KOSAR`(CHAR 1) 都能过；`MATNR`(CHAR 18) / `KUNNR`(CHAR 10) / `BANKN`(无 value table) / `RSNUM`(CHAR 10) 都过不了。空字符串合法：表示不绑定子对象，ICF 创建不要求 `subType` 非空（2026-11-01 起）。
6. **CLI 预检 name 长度** —— `nrobj` 是 CHAR 10，超长名字 SAP 会静默截断；`create` / `delete` 现在在本地就拒绝（`NROB_NAME_INVALID`，exit 7），不再把截断后的名字写进 SAP。

## Round-trip 验证结果

| 测试用例 | 创建 | 拉取 | 关键字段保持 |
|---|---|---|---|
| `ZNR_VIBE` (mainBuffer / 10% / rolling / EBELP) | ✓ | ✓ | buffering, percentWarning, rolling, subType, numberLengthDomain |
| `subType` 为空（无子对象，`""`） | ✓（2026-11-01 真机） | ✓（ICF 兜底） | 创建后 TNRO.dtelsobj 为空，pull 回 `subType: ""`；对象无删除通道，测试残留需临时报表清理 |
| `ZNR_EDGE` (none / 50% / rolling=false / untilYear=true / BUKRS / transactionId=ZTEST_TXN) | ✓ | ✓ | rolling→nonrswap 反义正确，transactionId 写入了 rfcdest，untilYear 写入了 yearind，none buffering 写入 ' ' |
| Missing `numberLengthDomain` | ✗（CLI pre-flight） | — | AFF schema validation 拦截 |
| `--package ZPKG_FAKE`（非本地包） | ✗（本地校验） | — | `transportRequest is required when package is not a local package` |

## 删除

`DELETE /ddic/nrob/<name>` 只处理 `$TMP` 本地对象：

1. `SELECT` NRIV 的 interval 行（不调用 `NUMBER_RANGE_INTERVAL_LIST`——该 FM 在 ICF 上下文会触发 SNRO 屏幕）；
2. 用 `NUMBER_RANGE_INTERVAL_UPDATE` + `NUMBER_RANGE_UPDATE_CLOSE` 删除区间；
3. `NUMBER_RANGE_OBJECT_DELETE` 必须传 `ohne_tp_flag = 'X'`，否则 FM 的传输检查会打开 `SAPLSTRD 0100` 对话框；
4. 最后清理 TADIR 行。

可传输对象仍请在 SNRO 删除；ICF 对非本地包返回 `NROB_DELETE_UNSUPPORTED`。

## 当前限制

- **ICF 服务端接受 `$` 前缀本地包**（旧 ICF 部署只认 `$TMP`，升级后执行一次 `abap deploy`）—— transport-bound NROB 仍不支持：需要额外的 `TR_TADIR_INTERFACE` + `RS_CORR_INSERT` 写 TADIR，本轮没实现。
- **`$` 前缀本地包（2026-11-01 真机）**：非本地包 + `--tr` 被新 handler 拒绝（`NROB_PACKAGE_NOT_SUPPORTED`，消息改为 "supports local packages (name starts with $) only"）。
- **不写 NRIV** —— 创建 object 声明后，interval 数据需要 `SNRO` 维护。
- **不读 NRIV** —— pull 时 `nrobFormat.generate` 不输出 intervals 数组（schema 没暴露）。
- **name 上限 10 字符** —— `nrobj` 只有 CHAR 10；CLI 已在 create / delete 前预检并拒绝超长名称（`NROB_NAME_INVALID`，exit 7）。
- **runtime dump 在 CLI 不报 NROB_NOT_FOUND 后** —— NROB_NOT_FOUND 是正常错误（对象不存在），runtime dump 是 5xx 的 SAP HTML；如果看到 5xx 而非 4xx JSON，说明是 ABAP 端缺激活或代码 bug，需要查 `tmp/scripts/probe-icf-incl2.mjs` 重新抓 implementations include 确认部署内容。
- **删除的 500 dynpro 错误** —— 若看到 `Sending of dynpro SAPLSTRD 0100 ... No window system type`，说明 `NUMBER_RANGE_OBJECT_DELETE` 没传 `ohne_tp_flag='X'`（传输检查试图打开对话框），不是对象损坏。
