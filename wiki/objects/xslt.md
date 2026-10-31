---
type: object-type
title: XSLT — 转换程序（Transformation / XSLT Program）
description: XSLT 对象的路由、AFF 两件套布局、字段映射、行尾规范化、更新语义（删除+重建）与命令示例
tags: [abap-cli, object-type, xslt, icf, abap-file-format, transformation]
created at: 2026-10-31 17:50:00
changed at: 2026-10-31 18:06:00
---

# XSLT — 转换程序（Transformation / XSLT Program）

## 路由

**ICF 自建**（`/sap/abap_cli/xslt/<name>`）。XSLT 程序是 O2 仓库对象，**没有 ADT 端点**；SAP 侧通过 `CL_O2_API_XSLTDESC` 读写。

| method | 作用 | CLI |
|---|---|---|
| `GET` | 读活动版本源码 + header 元数据 | `abap pull <name> --type XSLT` |
| `POST` / `PUT` | upsert（不存在则创建，存在则**删除后重建**） | `abap create XSLT <name> --file ...`、`abap push` |
| `DELETE` | 删除（删除标记 + save 落库） | `abap delete <name> --type XSLT --yes` |

对应路由表：`XSLT` 的 `create` / `pull` / `push` 均为 `channel: 'icf'`；`delete` 在 `flows/edit/delete.ts` 里走独立 ICF 分支。CLI 类型注册：`ObjectSource = 'ICF'`、`requiresFile: true`（`create` 必须 `--file`）。

## 本地文件形态（两件套）

```
src/
├── <name>.xslt.json   # AFF 元数据（xslt-v1）
└── <name>.xslt.xml    # XSLT 程序源码，1:1
```

- `<name>.xslt.json` 是 vendored 上游 `xslt-v1.json` 校验的 AFF 文档，只有 `formatVersion` + `header{description, originalLanguage}`。
- `<name>.xslt.xml` 是源码本体，`pull` 写规范化后的 LF + 单个结尾换行；`create` / `push` 读取时同样规范化。
- 命名空间对象用 AFF 括号 token：`/ZNS/MY_XSLT` → `src/(zns)my_xslt.xslt.{json,xml}`。
- 两件缺一不可：只有 JSON 时 `create` / `push` 报 `VALIDATION_ERROR`（`XSLT companion file missing`），只有 XML 时按同一规则解析同目录 JSON。

## 字段映射

| AFF | ICF wire | SAP API / 存储 | 说明 |
|---|---|---|---|
| 对象名（文件名） | `name` | `O2XSLTATTR-XSLTDESC` / `CXSLTDESC`（≤30，类常量 `c_maximal_trnsfmtn_name_length`） | 超过 30 或含空格 → `XSLT_NAME_INVALID` |
| `header.description`（≤60） | `header.description` | `O2XSLTATTR-DESCRIPT`（60） | 必填；超出 AFF/CXSLT 上限 → `XSLT_DESCRIPTION_TOO_LONG` |
| `header.originalLanguage`（ISO 2 位） | `header.originalLanguage` | `O2XSLTATTR-LANGU`（SAP 1 位） | ABAP 侧用 `T002` 做 ISO↔SAP 换算；未知语言回退当前语言 / 读回回退 `EN` |
| `<name>.xslt.xml` 全文 | `source` | `get_source_string()` / `create_new_from_string( p_source )` | 行尾规范化见下节 |
| — | `package` | `O2XSLTATTR-DEVCLASS` | 写：payload 的 package，缺省沿用既有包（新建默认 `$TMP`）；读：GET 回带 `devclass` 供 delete 判 transport |
| — | `transportRequest` | `save( CHANGING p_transport_request )` / `activate( CHANGING i_transport_request )` | 非 `$TMP` 包写入/删除必须带 `--tr`，否则 `XSLT_TRANSPORT_REQUIRED` |

只支持 **XSLT program**（`generalInformation.transformationType` 缺省 `xsltProgram`）；Simple Transformation（STRANS）不在本类型范围内。

## 行尾规范化（gotcha）

`CL_O2_API_XSLTDESC->get_source_string()` 用 `CRLF` 拼接内部行表，并在**末尾多补一个 CRLF**，因此读回源码永远比写入多一个空行（abapGit 在 `create_new_from_string` 前也剥掉尾部 CRLF 规避）。

本仓库的单一实现对在 `formats/xslt/json.ts#normalizeXsltSource()`：

- `CRLF` / `CR` → `LF`
- 去掉尾部所有换行
- `pull` 比较、写 `.xslt.xml`、`push` 载荷、`create` 输入全部走这一个函数；`sameXsltSource()` 在其上做比较。

所以：**不要**在其它地方再写一份行尾 trim；本地 `.xslt.xml` 永远是 LF + 单个结尾换行，pull 不会因为 SAP 多一个 CRLF 而反复产生 diff。

## 写语义（SAP 侧，真机验证）

`POST` / `PUT` 是 upsert，两条路径都已在 S/4HANA 8.134 真机验证：

**创建**（对象不存在）：
1. handler 按 LF 把源码拆成 `O2PAGELINE_TABLE` 行表（单行 >255 字符 → `XSLT_SOURCE_LINE_TOO_LONG`）。
2. `cl_o2_api_xsltdesc=>create_new( p_source = 行表, p_attr )`：`p_attr` 填 `xsltdesc` / `devclass` / `langu` / `descript`。
3. `save( i_suppress_dialog = abap_true, CHANGING p_transport_request )` → **`COMMIT WORK AND WAIT`** → `activate( e_error_list, CHANGING i_transport_request )` → `set_changeable( abap_false )` → `COMMIT WORK AND WAIT`。
4. 返回 `{ status: 'success', data: { name, action: 'created' } }`。

**更新**（对象已存在，**原地更新，保留版本历史**）：
1. `load( p_desired_state = 'A' )` 读活动版本（无活动版本时回退默认解析）。
2. `set_changeable( abap_true )` → 需要时 `set_attributes` 更新 `descript`。
3. `set_source( 行表 )` → `save(...)` → **`COMMIT WORK AND WAIT`** → `activate(...)` → `set_changeable( abap_false )` → `COMMIT WORK AND WAIT`。
4. 返回 `action: 'updated'`；激活失败返回 `XSLT_ACTIVATION_FAILED`（`details` 为 `O2XSLTERR` 行号/文本），对象保留 inactive 版本，修正后重新 push 即可恢复（真机 TC14 验证）。

具体坑（都是真机踩出来的，已在 handler 里处理）：

- **save 与 activate 之间必须 commit**：O2 API 用 `EXPORT TO DATABASE` 落源码，`activate` 内部会重新读取 inactive 版本；未 commit 时读取可能为空，产生“`O2XSLTDESC` 有 active 行但源码不可读（`load` 返回 not_existing）”的幽灵对象。handler 在 save 后显式 `COMMIT WORK AND WAIT`。
- **不要用 `create_new_from_string`**：它内部 `derive_transformation_source()` 按 `"." CRLF "."` 拆行，CRLF-less 源码会整体成为一行并在 `O2PAGELINE-LINE`（CHAR 255）处截断（真机实测 347 字节源码被截）。handler 自己拆行并调用 `create_new`。
- **不要在同一 LUW 内 delete + 重建同名对象**：会留下源码 cluster 不可读的幽灵对象（`exists='1'` 但 `load` not_existing，且 `delete`/`create` 都进不去），只能清 `O2XSLTDESC`/`O2XSLTOTR`/`TADIR` 行。更新走 `set_source` 原地路径。
- 删除：`load` → `set_changeable( abap_true )` → `delete( )` → `save( )`（`delete` 只打删除标记，必须 `save` 才真正删除）→ `set_changeable( abap_false )` → commit。

## 错误码（SAP 侧 → CLI/退出码）

| code | exit | 触发 |
|---|---|---|
| `XSLT_OBJECT_NOT_FOUND` | 8 | GET/DELETE 的转换不存在（对应 CLI `OBJECT_NOT_FOUND`） |
| `XSLT_NAME_INVALID` | 7 | 名称 >30 字符 / 含空格 |
| `XSLT_INVALID_PAYLOAD` | 7 | POST body 空或非法 JSON |
| `XSLT_DESCRIPTION_REQUIRED` / `XSLT_DESCRIPTION_TOO_LONG` | 7 | header.description 缺失 / >60 |
| `XSLT_SOURCE_REQUIRED` | 7 | source 为空 |
| `XSLT_SOURCE_LINE_TOO_LONG` | 7 | 单行源码 >255 字符（`O2PAGELINE-LINE` 上限），需先拆行 |
| `XSLT_NAME_MISMATCH` | 7 | payload.name 与 URL 名称不一致 |
| `XSLT_TRANSPORT_REQUIRED` | 7 | 非 `$TMP` 包缺 transportRequest |
| `XSLT_CREATE_FAILED` / `XSLT_LOAD_FAILED` / `XSLT_DELETE_FAILED` / `XSLT_WRITE_CANCELLED` / `XSLT_OBJECT_EXISTS` | 6 | SAP API 返回错误 |
| `XSLT_NOT_AUTHORIZED` | 5 | `create_new_from_string` 的 `not_authorized` |
| `XSLT_ACTIVATION_FAILED` | 7 | `activate` 返回语法/生成错误（对象保留 inactive，需修正后重推） |
| `XSLT_SERVICE_INVALID` | 7 | URL 缺名称 |

CLI 本地错误：`--file` 不是 `.xslt.json` → `INVALID_ARGUMENT`；缺 XML 伴生 / 空源码 → `VALIDATION_ERROR`；`pull` 文件已存在且未 `--overwrite` → `OVERWRITE_REQUIRED`（exit 2）。

## 命令示例

```bash
# 创建（AFF 两件套必须同时存在）
abap create XSLT ZMY_XSLT --file src/zmy_xslt.xslt.json --package '$TMP' --yes

# 拉取（写 .xslt.json + .xslt.xml；已存在时加 --overwrite）
abap pull ZMY_XSLT --type XSLT --overwrite

# 修改源码后推送（更新既有对象；push 不创建）
abap push src/zmy_xslt.xslt.json --tr <TRANSPORT>

# 删除（$TMP 无需 --tr）
abap delete ZMY_XSLT --type XSLT --yes
```

最小合法源码（`<name>.xslt.xml`）：

```xml
<?xml version="1.0" encoding="utf-8"?>
<xsl:transform version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:template match="/">
    <out><xsl:value-of select="/root/value"/></out>
  </xsl:template>
</xsl:transform>
```

对应 `<name>.xslt.json`：

```json
{
  "formatVersion": "1",
  "header": {
    "description": "My transformation",
    "originalLanguage": "EN"
  }
}
```

## gotcha

- **push 只更新**：对象不存在时 `push` 报 `OBJECT_NOT_FOUND`（exit 8，提示先 `abap create`），不会让 ICF upsert 隐式创建；这与 DDIC/TRAN 的 push 语义一致（HTTP 例外）。
- **两件套去重**：显式 `abap push a.xslt.json a.xslt.xml` 只会推一次（`push-dedup.ts` 归并到 `.json`）；`push --all` 的扫描器只枚举 `.abap` / `.xml`，所以工作区里成对的 `.xslt.xml` 会被扫描到、同样经 JSON 伴生读取后推送。
- **`--check-only` 对 XSLT 是本地校验**（读两件套 + schema 校验，零 SAP 调用），不是 SAP 语法检查；SAP 语法检查在 `activate` 阶段，失败返回 `XSLT_ACTIVATION_FAILED` 并带行号。
- **激活失败留 inactive 版本**：`create` / `push` 返回错误后对象可能已存在但未激活；修正源码后重新 push 即可（更新路径会先删除旧版本再重建）。
- **版本历史**：更新走删除+重建，`SE80` 的版本历史不会保留本次更新前的版本。
- **单行 ≤255 字符**：O2 行表 `O2PAGELINE-LINE` 是 CHAR 255；handler 在拆分时拒绝超长行（`XSLT_SOURCE_LINE_TOO_LONG`），不会静默截断。
- **对象语言**：`create_new` 内部固定 `attribs-langu = sy-langu`，创建时 payload 的 `originalLanguage` 不会改变 SAP 对象语言；以 `pull` 读回值为准。
- **名称长度**：SAP 类常量限制 30 字符；AFF 文件名经过 `(ns)name` token 后仍按对象名计长。
- **文件名 = 对象名**：`abap create XSLT <name> --file ...` 要求 `--file` 的 basename 等于 AFF token（`(zns)my_xslt.xslt.json`），不一致时本地 `INVALID_ARGUMENT`（exit 2），避免创建出的对象与后续 pull 的落盘名不同。
- **ICF 端点需要 `abap deploy` 后生效**：改 ABAP 后必须重新 deploy；复用旧会话可能命中内存里的旧 class load，真机命令建议 `ABAP_CLI_SESSION_POLICY=always-logout`。

## 真机证据

- **API 探针（S/4HANA 8.134.214.7:44300，profile `test`，$TMP）**：`CL_O2_API_XSLTDESC` 的 `exists` / `load` / `create` / `save` / `activate` / `get_attributes` / `get_source_string` / `delete` 全链路 rc=0；读回源码以 CRLF 拼接且末尾多一个换行。证据：`tmp/research/261031-api-probes/xslt.md` 与 `evidence/xslt-api-class/`（本地，不入库）。
- **CLI + ICF `/xslt` 六阶段（真机 PASS）**：S/4HANA 8.134.214.7:44300（profile `test`）上 deploy release form（17 merged classes）→ 真机 TC01–TC18 全 PASS：create/upsert、pull 两件套与行尾规范化、push 修改、激活失败恢复、delete、404、清理。关键结论：**update = 原地 `set_source`（保留版本历史）**；create 用 `create_new` 行表；save↔activate 之间 commit。证据：`tests/261031008-realsap-xslt/`（本地，不入库）。
- **mock 集成测试**：`test/integration/xslt-lifecycle.test.ts` 覆盖 create → pull（CRLF 读回规范化）→ push 修改 → pull → 两件套去重 → delete → 404 全链路。

# references

- 路由矩阵：[`wiki/object-types.md`](../object-types.md)
- 类型目录：[`wiki/objects/index.md`](index.md)
- vendored schema：[`src/abap_cli/schema/xslt-v1.json`](../../src/abap_cli/schema/xslt-v1.json)
- 上游 AFF：[`file-formats/xslt/xslt-v1.json`](https://github.com/SAP/abap-file-formats/blob/main/file-formats/xslt/xslt-v1.json)
