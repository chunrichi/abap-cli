---
type: object-type
title: TRAN — 事务码（SE93 Transaction Code）
description: TRAN 对象的路由、5 种 transactionType、读写映射、已知限制与真机证据
tags: [abap-cli, object-type, tran, icf, abap-file-format, transaction, se93]
created at: 2026-09-01 00:00:00
changed at: 2026-10-31 16:30:00
---

# TRAN — 事务码（SE93 Transaction Code）

## 路由

**ICF 自建**（`/sap/abap_cli/tran/<name>`）。SE93 没有 ADT 端点。

| method | 作用 | CLI |
|---|---|---|
| `GET` | 读 TSTC/TSTCT/TSTCP/TSTCC/TSTCA + TADIR package → `tran-v1` wire | `abap pull <code> --type TRAN`、`abap tcode` |
| `POST` / `PUT` | 创建或覆盖（同一路径：已存在则替换定义） | `abap create TRAN <code> --file ...`、`abap push *.tran.json` |
| `DELETE` | 删除（仅 `$TMP` 事务） | `abap delete <code> --type TRAN --yes` |

## 本地文件形态

```
src/
└── <code>.tran.json
```

`.tran.json` 是 AFF 文档，`pull` 会额外写入 CLI 信封字段 `name`（来自文件名）
与 `package`（来自 TADIR），二者在 AFF 校验前被剥离，`push` 用它们定位对象与包。

## 写入语义（SAP 侧）

`POST`/`PUT` 按 SE93 的数据模型执行：

1. 已存在的事务码先清空 TSTC / TSTCT / TSTCP / TSTCC / TSTCA 五张事务表——
   规范删除 FM `RPY_TRANSACTION_DELETE` 需要 GUI dynpro，不能在 ICF 上下文调用。
2. `RS_CORR_INSERT`（`object_class = 'TRAN'`，`devclass` / `korrnum` 来自
   `package` / `transportRequest`，`suppress_dialog`）写 TADIR 与请求绑定。
3. `RPY_TRANSACTION_INSERT`（`suppress_corr_insert = abap_true`）重建事务定义：
   程序/屏幕、短文本、被调用事务、variant、GUI 三个开关。
4. 覆盖 TSTCC 的其余属性（`S_WEBGUI` 的 `1`/`2`、`S_PERVAS`、`S_SERVICE`）、
   补 report variant 的 CINFO x'10' 位、写入 TSTCA 起始授权对象并置 CINFO x'04'。
5. 返回 `{ name, type: 'TRAN', action: 'created' | 'updated' }`。

`DELETE` 删除五张事务表 + 本地 TADIR 行；可传输事务（非 `$TMP`）返回
`TRAN_DELETE_UNSUPPORTED`，请在 SE93 删除，让删除动作进入请求。

## 5 种 transactionType 与 TSTC-CINFO

| `transactionType` | CINFO | 关键字段 | TSTCP-PARAM 编码 |
|---|---|---|---|
| `dialogTransaction` | x'00' | `programName` / `programDynnr` / `stvMaintenanceMode` | 无 |
| `reportTransaction` | x'80'（带 variant x'90'） | `reportName` / `reportDynnr` / `reportVariantName` | variant 名（无前缀） |
| `parameterTransaction` | x'02' | `parParentTransactionCode` / `skipInitialScreenMode` / `parameterValues[]` | `/*<core> NAME=VALUE;...`（`/*` = skip，`/` = show） |
| `variantTransaction` | x'02' + TSTCP `@` | `varParentTransactionCode` / `transactionVariantCiIndi` / `transactionCiVariantName` / `transactionVariantName` | `@<core> <variant>`（client-specific）或 `@@<core> <variant>`（cross-client） |
| `ooTransaction` | x'08' | `className` / `methodName` / `updateMode` 等 | `\PROGRAM=...\CLASS=...\METHOD=...\UPDATE_MODE=S` |

> **OO 事务只读**：`RPY_TRANSACTION_INSERT` 没有 class/method 参数（abapGit 用
> SE93 BDC，ICF 上下文无法跑 dynpro），写入返回 `TRAN_OO_NOT_SUPPORTED`（exit 7）。
> `pull` 可正常读取 OO 事务码。

## `<code>.tran.json` 形状（abap-file-format）

```json
{
  "name": "ZMY_TRAN",
  "formatVersion": "1",
  "package": "$TMP",
  "header": {
    "description": "My parameter transaction",
    "originalLanguage": "en",
    "abapLanguageVersion": "standard"
  },
  "generalInformation": {
    "transactionType": "parameterTransaction",
    "lockStatus": "notLocked",
    "parameterTransaction": {
      "parParentTransactionCode": "SE16",
      "skipInitialScreenMode": "skip",
      "parameterValues": [
        { "parameterName": "DATABROWSE-TABLENAME", "parameterValue": "TSTC" }
      ]
    }
  },
  "userInterface": {
    "uiAttributes": { "webguiMode": "supported", "platinMode": "supported", "win32Mode": "notSupported" }
  }
}
```

`generalInformation` 中只应出现与 `transactionType` 匹配的那一个块；`pull`
写盘时会自动丢弃 ICF GET 返回的其余默认块（ABAP 侧无法按条件省略结构）。

## AFF 字段 → SAP 存储

| AFF | SAP |
|---|---|
| `header.description` / `header.originalLanguage` | TSTCT-TTEXT / TSTCT-SPRSL（2 位 ISO ↔ 1 位 SAP 语言键，经 T002 映射） |
| `dialogTransaction.programName/programDynnr` | TSTC-PGMNA / TSTC-DYPNO |
| `reportTransaction.*` | TSTC-PGMNA/DYPNO + TSTCP（variant 名） |
| `parameterTransaction.parParentTransactionCode` / `skipInitialScreenMode` / `parameterValues[]` | RSSTCD-CALL_TCODE / RSSTCD-ST_SKIP_1 / `PARAM_VALUES` 表 |
| `variantTransaction.*` | RSSTCD-CALL_TCODE / S_IND_VARI / VARIANT |
| `userInterface.uiAttributes.webguiMode` | TSTCC-S_WEBGUI（supported → `1`，easyWeb → `2`） |
| `userInterface.uiAttributes.platinMode` / `win32Mode` | TSTCC-S_PLATIN / S_WIN32（`X`/空） |
| `userInterface.uiAttributes.pervasiveMode` | TSTCC-S_PERVAS（`X`/空） |
| `userInterface.uiAttributes.iacServiceName` | TSTCC-S_SERVICE |
| `authorizations.startAuthorizationObject` | TSTCA 行 + CINFO x'04' |
| `package` / `transportRequest`（信封） | RS_CORR_INSERT 的 `devclass` / `korrnum`（TADIR） |

## 已知限制

- `lockStatus` 恒为 `notLocked`：当前版本没有对应的 TSTC/TADIR 列可读。
- `dialogTransaction.stvMaintenanceMode` 读取恒为 `notAllowed`（未找到存储列）。
- `authorizations.authorizationDefaults`（USOBHASH 角色缺省值）不读不写；
  仅起始授权对象（TSTCA）参与读写。
- `transactionServices` / `transactionRelationships` / `serviceRelationships`
  读取为空数组，写入忽略。
- 覆盖是"先清空再重建"：TSTC 版本历史（VRSD）不会记录中间态；失败窗口内
  事务码可能缺失（所有可校验项在清空前完成，剩下只有 SAP 写错误才会触发）。

## 命令示例

```bash
# 读
abap pull ZMY_TRAN --type TRAN --json
abap tcode ZMY_TRAN --json

# 建 / 覆盖（$TMP：不需要 --tr）
abap create TRAN ZMY_TRAN --file src/zmy_tran.tran.json --package $TMP --yes --json
# 可传输包：create 需要 --tr；push 会沿文件里的 package / 对象绑定请求
abap create TRAN ZMY_TRAN --file src/zmy_tran.tran.json --package ZPKG --tr NDK900123 --yes --json

# 推
abap push src/zmy_tran.tran.json --yes --json

# 删（仅 $TMP）
abap delete ZMY_TRAN --type TRAN --yes --json
```

## 已知坑

- **名称**：≤20 字符；`Z/Y`/命名空间（`/NS/NAME`）均可。
- **`programDynnr` 必须是 1–4 位数字**（`0100`），写入前 CLI/SAP 侧都会校验。
- **类型块必须与 `transactionType` 一致**：填 `parameterTransaction` 但缺
  `parameterTransaction` 块 → 服务端 400/`TRAN_TYPE_INVALID`。
- **`description` ≤ 80 字符**（AFF `tran-v1` 上限）。
- **可传输包**：写事务前必须给出 transport（`create --tr` / `push` 的对象绑定或
  `--tr`）；`$TMP` 对象不需要。
- **ICF 必须已部署且与 CLI 版本匹配**（`abap deploy status`）；维护者改 ICF 源码后
  需要 SICF 节点 deactivate→activate（或重新 `abap deploy`）才会加载新类。
- `pull` 出来的文件可直接 `push`；手工写的旧文件若缺 `header.abapLanguageVersion`
  或仍带空的类型块，建议直接重新 `pull --overwrite`。

## 真机证据

S/4HANA `8.134.214.7:44300`（profile `test`，client 100）：
`create` → `pull` → `push` → `pull` → `delete` 全闭环，dialog / report /
report+variant / parameter / variant 五种形状，23/23 TC PASS，TSTC/TSTCP/TSTCC/TADIR
逐项核对（例如 parameter：`/*SE16 DATABROWSE-TABLENAME=TSTC;`；variant：
`@@SLG1 /BOBF/LOG`；CINFO：x00/x02/x02/x80/x90）。证据：`tests/261031003-realsap-tran/`
（本地，不入库）。OO 事务写入在真机返回 `TRAN_OO_NOT_SUPPORTED`（exit 7）。

# references

- 类型索引：[`wiki/objects/index.md`](index.md)
- `abap tcode` 命令：[`wiki/commands/tcode.md`](../commands/tcode.md)
- `create` / `pull` / `push` / `delete`：[`wiki/commands/`](../commands/index.md)
