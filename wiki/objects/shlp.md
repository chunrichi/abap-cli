---
type: object-type
title: SHLP — 搜索帮助（Search Help）
description: SHLP 对象的 ICF 路由、自建 shlp-v1 字段契约（DD30V/DD31V/DD32P/DD33V）、elementary/collective 写路径与 $TMP-only 删除
tags: [abap-cli, object-type, shlp, icf, abap-file-format, search-help]
created at: 2026-10-31 18:50:00
changed at: 2026-10-31 19:05:00
---

# SHLP — 搜索帮助（Search Help）

DDIC 搜索帮助（SE11 → 搜索帮助）。`SHLP` 是 abap-cli 的**本地扩展类型**：
SAP 上游 `abap-file-formats` 没有搜索帮助格式，本仓库自建 `shlp-v1.json`
（见 [`schema/README.md`](../../src/abap_cli/schema/README.md) 的 local extension 说明），
字段来源是 DDIC 维护结构 `DD30V` / `DD31V` / `DD32P` / `DD33V`。

支持两种形态：

- **elementary**（DD30V-ISSIMPLE='X'）：选择方法（表/视图）+ 字段清单；
- **collective**（DD30V-ELEMEXI='X'）：包含其它搜索帮助（DD31V）+ 接口参数到子搜索帮助的参数映射（DD33V）。

## 路由（单通道 ICF）

| 操作 | 端点 |
|---|---|
| create | `POST /sap/abap_cli/ddic/shlp`（body 带 `name`；PUT 同语义） |
| pull | `GET /sap/abap_cli/ddic/shlp/<name>` |
| push | `GET`（存在性探测）→ `POST /sap/abap_cli/ddic/shlp` |
| delete | `DELETE /sap/abap_cli/ddic/shlp/<name>`（仅 `$TMP`） |

ADT 没有搜索帮助资源，所以 `registry` 里 `source: 'ICF'`：四类操作全部走自建
ICF 服务，需要先 `abap deploy`。SAP 侧 handler 在
`abap/src/zcl_abap_vibe_icf_ddic.clas.abap` 的 `/ddic/shlp` 分支
（`create_ddic_shlp` / `get_ddic_object` 的 `SHLP` 分支 / `delete_ddic_object`）。

## 本地文件形态

```
src/
└── zcli_tc_shlp.shlp.json
```

单文件，无侧车。`abap pull ZCLI_TC_SHLP --type SHLP` 写
`src/zcli_tc_shlp.shlp.json`；`abap push src/zcli_tc_shlp.shlp.json` 反向读同一文件。

## `ZCLI_TC_SHLP.shlp.json` 形状（elementary）

```json
{
  "formatVersion": "1",
  "header": {
    "description": "Language key",
    "originalLanguage": "en"
  },
  "name": "ZCLI_TC_SHLP",
  "package": "$TMP",
  "kind": "elementary",
  "selectionMethod": "T002",
  "selectionMethodType": "table",
  "textTable": "T002T",
  "dialogType": "displayValuesList",
  "parameters": [
    { "fieldName": "SPRAS", "rollName": "SPRAS", "input": true, "output": true },
    { "fieldName": "LAISO", "rollName": "LAISO", "output": true }
  ]
}
```

collective 形态把 `kind` 改为 `collective`，去掉 `selectionMethod` 等 elementary
专属字段，并补上：

```json
{
  "kind": "collective",
  "parameters": [
    { "fieldName": "SPRAS", "rollName": "SPRAS", "input": true, "output": true }
  ],
  "includedSearchHelps": [
    { "searchHelp": "ZCLI_TC_SHLP", "position": 1 }
  ],
  "parameterMappings": [
    { "fieldName": "SPRAS", "subSearchHelp": "ZCLI_TC_SHLP", "subFieldName": "SPRAS", "valueDirection": "import" }
  ]
}
```

## 关键字段

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `formatVersion` | `"1"` | ✅ | 固定 |
| `name` | string | ✅ | 搜索帮助名，**≤30 字符** |
| `header.description` | string | ✅ | DD30V-DDTEXT，≤60 |
| `header.originalLanguage` | string | ✅ | 两位 ISO 语言码 |
| `package` | string | — | 读路径写出的 TADIR 包；create/push 以命令行 `--package` 为准 |
| `kind` | enum | ✅ | `elementary` / `collective` |
| `selectionMethod` | string | elementary ✅ | DD30V-SELMETHOD：选择方法表/视图 |
| `selectionMethodType` | enum | — | `table`（写 X，读回 T） / `view`（V），缺省 `table` |
| `textTable` | string | — | DD30V-TEXTTAB：提供描述文本的文本表 |
| `dialogType` | enum | — | `displayValuesList`（D，缺省）/ `dialog`（C） |
| `hotkey` | string | — | DD30V-HOTKEY 单字符快捷键 |
| `parameters[]` | array | ✅ | DD32P，至少 1 项；`fieldName` 必填，`position` 缺省按数组序 |
| `parameters[].rollName` | string | — | 缺省由服务端推导（elementary 取选择方法字段，collective 取被映射子 SHLP 参数） |
| `parameters[].input/output` | boolean | — | DD32P-SHLPINPUT / SHLPOUTPUT |
| `parameters[].selectionPosition/listPosition` | int | — | DD32P-SHLPSELPOS / SHLPLISPOS；input/output 为 true 时缺省=参数位置 |
| `includedSearchHelps[]` | array | collective ✅ | DD31V；子搜索帮助必须已存在（DD30L），`viaSearchHelp` 缺省为自身 |
| `parameterMappings[]` | array | collective ✅ | DD33V；`fieldName` 必须是接口参数、`subSearchHelp` 必须在 included 列表 |

### kind ↔ DD30V 标志

| 本地 `kind` | DD30V 标志 | 其它 |
|---|---|---|
| `elementary` | `ISSIMPLE='X'` | 需要 `selectionMethod`；`DD31V`/`DD33V` 空 |
| `collective` | `ELEMEXI='X'` | 需要 `includedSearchHelps[]` + `parameterMappings[]`；`DD32P` 为接口参数 |

读路径按 `ISSIMPLE='X'` 判定 elementary（不是看 `SELMETHOD` 是否为空）。

## 写路径（SAP 侧）

`create` / `push` 走同一个 upsert 语义：

1. `RS_CORR_INSERT`（`object_class='SHLP'`、`devclass`、`korrnum`、`mode='I'`、
   `global_lock='X'`、`suppress_dialog='X'`）——插入 TADIR / 绑定包与请求。
2. `DDIF_SHLP_PUT`——elementary 只命名 `dd32p_tab`；collective 命名
   `dd31v_tab` / `dd32p_tab` / `dd33v_tab`（只传需要的表，未命名的表不参与写入）。
3. `DDIF_SHLP_ACTIVATE`——`DDIF_SHLP_PUT` 只写 inactive 版本，不激活则
   `GET state='A'` 读不到。

服务端校验：elementary 的 `selectionMethod` 必须在 DD02L 存在；collective 的
每个 `includedSearchHelps[]` 必须在 DD30L 存在（否则 `SHLP_INCLUDED_NOT_FOUND`），
`parameterMappings[]` 的 `fieldName` / `subSearchHelp` 必须分别对上参数与包含项
（否则 `SHLP_FIELD_INVALID`）；`rollName` 缺省自动推导，推导失败返回
`SHLP_FIELD_INVALID` 并提示显式指定。

## 删除

`abap delete <name> --type SHLP` → `DELETE /ddic/shlp/<name>`：

- handler 先 `SELECT SINGLE FROM dd30l` 判断对象是否存在，再查 TADIR 判定包；
- 非 `$TMP` → `SHLP_DELETE_UNSUPPORTED`（exit 7）：ICF 上下文无法把删除记录进
  传输请求，请在 SE11 删除；
- `$TMP`：若只有 inactive 版本，先 `DDIF_SHLP_ACTIVATE` 激活，再
  `RS_DD_DELETE_OBJ(objtype='H', no_ask='X')`（**不要**用会弹 dynpro 的
  `RS_DD_DELETE`）。对象与 TADIR 行一并清除。

## 命令示例

```bash
# elementary：选择方法 T002 + 两个参数
cat > src/zcli_tc_shlp.shlp.json <<'JSON'
{
  "formatVersion": "1",
  "header": { "description": "Language key", "originalLanguage": "en" },
  "name": "ZCLI_TC_SHLP",
  "kind": "elementary",
  "selectionMethod": "T002",
  "textTable": "T002T",
  "parameters": [
    { "fieldName": "SPRAS", "input": true, "output": true },
    { "fieldName": "LAISO", "output": true }
  ]
}
JSON
abap create SHLP ZCLI_TC_SHLP --file src/zcli_tc_shlp.shlp.json --package '$TMP' --yes --json

# 拉回 / 改描述 / 推回
abap pull ZCLI_TC_SHLP --type SHLP --overwrite --json
abap push src/zcli_tc_shlp.shlp.json --json

# collective：包含上面的 elementary
cat > src/zcli_tc_shlpc.shlp.json <<'JSON'
{
  "formatVersion": "1",
  "header": { "description": "Language key (collective)", "originalLanguage": "en" },
  "name": "ZCLI_TC_SHLC",
  "kind": "collective",
  "parameters": [{ "fieldName": "SPRAS", "input": true, "output": true }],
  "includedSearchHelps": [{ "searchHelp": "ZCLI_TC_SHLP", "position": 1 }],
  "parameterMappings": [
    { "fieldName": "SPRAS", "subSearchHelp": "ZCLI_TC_SHLP", "subFieldName": "SPRAS", "valueDirection": "import" }
  ]
}
JSON
abap create SHLP ZCLI_TC_SHLC --file src/zcli_tc_shlpc.shlp.json --package '$TMP' --yes --json

# 删除（仅 $TMP；先删 collective 再删 elementary）
abap delete ZCLI_TC_SHLC --type SHLP --yes --json
abap delete ZCLI_TC_SHLP --type SHLP --yes --json
```

## 错误码

| code | category / exit | 触发 |
|---|---|---|
| `SHLP_NAME_INVALID` | VALIDATION_ERROR / 7 | 名字为空 / >30 字符 / 含空白 / payload 与 URL 名字不一致 |
| `SHLP_KIND_INVALID` | VALIDATION_ERROR / 7 | `kind` 不是 elementary / collective |
| `SHLP_REQUIRED_FIELD` | VALIDATION_ERROR / 7 | 缺 `header.description` / `parameters[]` / collective 的 includes+mappings / 相关必填子字段 |
| `SHLP_SELECTION_METHOD_NOT_FOUND` | NOT_FOUND / 8 | `selectionMethod` 在 DD02L 不存在 |
| `SHLP_FIELD_INVALID` | VALIDATION_ERROR / 7 | 参数 rollName 无法推导 / mapping 引用未声明参数或包含项 |
| `SHLP_INCLUDED_NOT_FOUND` | NOT_FOUND / 8 | `includedSearchHelps[]` 引用的搜索帮助在 DD30L 不存在 |
| `SHLP_INVALID_PAYLOAD` | VALIDATION_ERROR / 7 | body 不是合法 shlp-v1 JSON |
| `SHLP_INCONSISTENT` / `SHLP_WRITE_REFUSED` | VALIDATION_ERROR / 7 | `DDIF_SHLP_PUT` 的 `shlp_inconsistent` / `put_refused` |
| `SHLP_WRITE_FAILED` / `SHLP_ACTIVATION_FAILED` | SAP_ERROR / 6 | PUT / ACTIVATE 失败 |
| `SHLP_TRANSPORT_REQUIRED` | VALIDATION_ERROR / 7 | 非 `$TMP` 写未给有效 transport |
| `SHLP_NOT_AUTHORIZED` | AUTH_ERROR / 5 | `RS_CORR_INSERT` 权限不足 |
| `SHLP_DELETE_UNSUPPORTED` | VALIDATION_ERROR / 7 | 删除可传输搜索帮助 |
| `SHLP_DELETE_FAILED` | SAP_ERROR / 6 | `RS_DD_DELETE_OBJ` 失败 |

对象不存在统一返回 `DDIC_OBJECT_NOT_FOUND`（`pull`/`delete` 由 CLI 映射为
`OBJECT_NOT_FOUND`，exit 8）。

## 真机验证

已在 S/4HANA 8.134.214.7:44300（profile `test`，client 100，sap103）按
`abap-testing` 六阶段跑通（2026-10-31，18/18 TC PASS）：

- **create elementary**（`T002`/`T002T`，$TMP）→ `action=created`；
  DD30L：`ISSIMPLE=X, SELMETHOD=T002, SELMTYPE=T, TEXTTAB=T002T`；
  DD32S 2 行，`ROLLNAME` 自动推导、`SHLPSELPOS/SHLPLISPOS` 与 SE11 一致。
- **create collective**（include 上面的 elementary + `SPRAS` 映射）→ 成功；
  DD31S：`SUBSHLP=ZCLI_TC_SHLP, VIASHLP=ZCLI_TC_SHLC`；
  DD33S：`VALUEDIREC=C`（写 `I` 归一化）；DD30L `ELEMEXI=X, ATTACHEXI=X`。
- **pull** 两种形态均无损回读（kind/selectionMethod/textTable/参数/include/mapping）。
- **push** 修改 description + dialogType → 复拉与 `DD30T` 文本同步；**delete**
  先删 collective 再删 elementary，均 `deleted=true, lockReleased=true`；
  删除后 DD30L/DD31S/DD32S/DD33S 与 TADIR 0 残留，`pull` exit 8。
- 错误路径：selectionMethod 不存在（`SHLP_SELECTION_METHOD_NOT_FOUND`）、
  子 SHLP 不存在（`SHLP_INCLUDED_NOT_FOUND`）、rollName 无法推导
  （`SHLP_FIELD_INVALID`）、非 $TMP 无 `--tr`、删除可传输搜索帮助
  （`SHLP_DELETE_UNSUPPORTED`）、pull 不存在对象均返回预期错误码。

证据（本地，不入库）：`tests/261031007-realsap-shlp/`（`evidence/TC-*`、
`reports/phase-1..6`、`summary.md`）。

## Gotcha

- **elementary / collective 是两套结构**：elementary 必须有 `selectionMethod`，
  且不能带 `includedSearchHelps[]` / `parameterMappings[]`；collective 反之。
- **collective 的子搜索帮助必须已存在**：写 collective 前先建好被包含的
  elementary（DD30L 里必须有 active 版本），否则 `SHLP_INCLUDED_NOT_FOUND`。
- **PUT 不激活**：写成功但没 activate 时 `GET state='A'` 返回空（`gotstate=''`）。
- **inactive 版本**：只用 `DDIF_SHLP_PUT` 未激活的对象在删除前会先激活；
  直接 `RS_DD_DELETE_OBJ` 会抛 E2 341（plugin mode 500）。
- **删除只支持 `$TMP`**：可传输搜索帮助请在 SE11 删，否则删除无法记录到传输请求。
- **`SELMTYPE` 写 X / 读回 T**：写路径用 `'X'` 表示表选择方法，SAP 激活后
  DD30V 读回 `'T'`；本地都归一化为 `table`。
- **valueDirection 归一化**：本地 `import` 写 `'I'`，SAP 激活后读回 `'C'`
  （输入/检查）或 `'E'`（输出）；本地映射 `I`/`C` → `import`、`E` → `export`。
- **hotkey / dialogType** 等 UI 属性是可选覆盖；不填时 SAP 用默认值
  （`dialogType=D`）。

# references

- 本地 schema：[`src/abap_cli/schema/shlp-v1.json`](../../src/abap_cli/schema/shlp-v1.json)
- 格式映射：`src/abap_cli/formats/shlp/json.ts`
- SAP 侧 handler：`abap/src/zcl_abap_vibe_icf_ddic.clas.abap`（`create_ddic_shlp`）
- 类型矩阵：[`wiki/object-types.md`](../object-types.md)
- 命令文档：[create](../commands/create.md) / [pull](../commands/pull.md) / [push](../commands/push.md) / [delete](../commands/delete.md)
