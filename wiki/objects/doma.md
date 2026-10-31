---
type: object-type
title: DOMA — 域（Domain）
description: DOMA 对象的字段契约、单 JSON 嵌套结构、长文本伴生文件与关键字段
tags: [abap-cli, object-type, doma, ddic, icf, abap-file-format, domain]
created at: 2026-09-01 00:00:00
changed at: 2026-10-31 17:05:00
---

# DOMA — 域（Domain）

## 路由

**ICF 自建**：对象读写 `/sap/abap_cli/ddic/DOMA/<name>`，长文本 `/sap/abap_cli/ddic/DOMA/<name>/docu`。

## 本地文件形态（嵌套结构）

```
src/
├── zmy_doma.doma.json        # 对象定义（必需）
└── zmy_doma.doma.docu.json   # 长文本（0..1，可选）
```

DOMA / DTEL 用**单文件 + 嵌套结构**（而非 TABL/STRU 的三件套）。这与 abap-file-format `domain-v1.json` / `dataelement-v1.json` 对齐。长文本单独落 `<name>.doma.docu.json`，见下方「长文本伴生文件」。

## `<name>.doma.json` 形状

```json
{
  "formatVersion": "1",
  "header": {
    "description": "My domain",
    "originalLanguage": "en"
  },
  "format": {
    "dataType": "CHAR",
    "length": 10,
    "decimals": 0
  },
  "fixedValues": [
    { "value": "01", "description": "Draft" },
    { "value": "02", "description": "Active" },
    { "value": "03", "description": "Closed" }
  ]
}
```

## 关键字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `format.dataType` | enum | `CHAR` / `NUMC` / `DEC` / `CURR` / `QUAN` / `CUKY` / `DATS` / `TIMS` / `INT1/2/4/8` / `FLTP16/34` / `RAW` / `LANG` / `CLNT` 等 |
| `format.length` | number | 主长度 |
| `format.decimals` | number | 小数位（CURR/QUAN/DEC 时） |
| `format.signFlag` | string | 是否带正负号（`'X'` / `''`，仅 `DEC`/`CURR`/`QUAN`；032 US9 起为 string） |
| `format.lowercase` | string | 是否小写转换（`'X'` / `''`，仅 `CHAR`） |
| `format.convExit` | string | 转换例程（如 `ALPHA`；空串保留） |
| `fixedValues` | array | 固定值清单（`fixedValue` + 多语言 `description`） |

## 长文本伴生文件（`<name>.doma.docu.json`）

域的长文本（SAP 端 DOKIL/DOKTL 文档）不在 `<name>.doma.json` 里，而是独立的 **0..1 伴生文件**，遵循 AFF `docu-v1.json`：

```json
{
  "formatVersion": "1",
  "lines": [
    { "format": "H1", "line": "Customer number" },
    { "format": "", "line": "Unique customer identifier. 72 chars max per line." }
  ]
}
```

| 规则 | 说明 |
|---|---|
| 文件位置 | 与主文件同目录：`<name>.doma.docu.json` |
| 行约束 | `line` ≤ 72 字符、`format` ≤ 2 字符；SAP 对超长行会**静默截断**，所以 CLI 在 push 前直接校验并拒绝（`AFF_FIXTURE_INVALID`） |
| `format` | SAPscript 段落格式（`""` = 纯文本段落）；`H1` 等格式码按 SAPscript 约定使用 |
| 语言 | 单语言：服务端按对象 TADIR 主语言读写（AFF docu-v1 无 language 字段） |
| SAPscript 标记 | 原样保留，CLI 不做转义或清洗 |
| `lines: []` | push 时删除远端长文本（省略 `lines` 等价于空数组） |
| 文件不存在 | 0..1：pull 不写空文件，push 不动远端长文本 |

```bash
# pull：有长文本才落 src/zmy_doma.doma.docu.json；--overwrite 时远端无文本会删掉本地陈旧伴生（meta.warnings: DOCU_LOCAL_STALE_REMOVED）
abap pull ZMY_DOMA --type DOMA --overwrite --json

# push 主文件：同目录存在伴生时，主对象写成功后再推送/删除长文本（data.results[].docu: saved|deleted）
abap push src/zmy_doma.doma.json --yes --json

# 单独校验伴生文件
abap validate:aff src/zmy_doma.doma.docu.json
```

`--dry-run` 的计划里，长文本是第二步：`["ddic-icf", "docu-icf"]`；`--atomic` 会在写主对象前先校验伴生。不要直接 `abap push <name>.doma.docu.json`——它会被拒绝并提示推送主文件。ICF 端点未部署（旧 handler）时 pull 静默视为无长文本，不阻塞主对象拉取。

## 命令示例

```bash
abap create DOMA ZMY_DOMA --package $TMP --description "domain" --tr $TMP --json
abap pull ZMY_DOMA --json
abap push src/zmy_doma.doma.json --tr DEVK900001 --json
```

## abap-file-format 合规性

✅ `fixedValues` 双向 round-trip（commit `941c20c`）；format 标志嵌套 `format.{signFlag, lowercase, convExit}` string 落盘（commit `2f1cdec`）。

## 已知坑

- **长文本行超 72 字符**：SAP 会静默截断；CLI 在 push 前校验并报 `AFF_FIXTURE_INVALID`（exit 7），且主对象不会被写入。先修 `.docu.json` 再 push。
- **伴生文件直接 push**：`abap push src/zmy_doma.doma.docu.json` 会以 `INVALID_ARGUMENT`（exit 2）拒绝——推送主文件 `src/zmy_doma.doma.json` 即可，伴生会自动跟随。
- **`fixedValues` 元素形态**：CLI 本地形态为 `fixedValue` + `description`（语言独立 / 多语言 `languageDependent[]`），也可放 `format.fixedValues`（abap-file-format 嵌套输入）；两者双向均可 round-trip
- **没有 `create local` 骨架**：DDIC 子集仅 `create` + `pull` + `push`，没有离线骨架生成（DDIC 需要 SAP 端激活）
- **`fixedValues` 重复值**：SAP 端会拒绝；CLI 不做去重校验（依赖 SAP 错误码）

# references

- 类型索引：[`wiki/objects/index.md`](index.md)
