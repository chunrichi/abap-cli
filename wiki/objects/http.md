---
type: object-type
title: HTTP — SICF 服务节点（ICF Tree Node）
description: HTTP 类型的 SICF 节点管理；走 ICF 自建通道
tags: [abap-cli, object-type, http, sicf, icf, abap-file-format]
created at: 2026-09-01 00:00:00
changed at: 2026-11-03 00:10:00
---

# HTTP — SICF 服务节点（ICF Tree Node）

## 路由

**ICF 自建**（`/sap/abap_cli/http/<name>`）。

## 名称说明

> **类型码是 `HTTP`；`SICF` 是已弃用别名**（commit `ad007c8`）。写 `--type SICF` / `create SICF` 会映射到 `HTTP` 并给出 deprecation warning，不再降级为 `OBJECT_NOT_FOUND`。新脚本请直接写 `HTTP`。

## 本地文件形态

```
src/
└── zmy_service.http.json
```

## `<name>.http.json` 形状（abap-file-format）

```json
{
  "formatVersion": "1",
  "header": {
    "description": "My service",
    "originalLanguage": "en",
    "abapLanguageVersion": "standard"
  },
  "generalInformation": {
    "handlerClass": "ZCL_MY_HANDLER",
    "servicePath": "/sap/zmy_service"
  }
}
```

CLI 同时接受**扁平写法**（方便手写）：

```json
{
  "formatVersion": "1",
  "description": "My service",
  "originalLanguage": "en",
  "handlerClass": "ZCL_MY_HANDLER",
  "servicePath": "/sap/zmy_service"
}
```

`localToWire` / `wireToLocal` 在 `src/abap_cli/formats/http/json.ts` 内做 abap-file-format → wire 双向兼容。SICF 路径在 AFF 里叫 `servicePath`，而真实 SAP ICF handler 按 `ty_http_service_data` 契约仍用 `url`，转换只在 CLI 侧发生；`package` / `transportRequest` 只作为 POST 顶层信封，不落盘。

## 关键字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `name` | — | 不在 AFF 文档内：对象名由命令行参数 / 文件名决定；`pull` 不写 `name` |
| `handlerClass` | 推荐 | 处理类，必须存在并实现 IF_HTTP_EXTENSION |
| `servicePath` | ✅ | 完整 SICF 路径（须 `/` 开头；上游 AFF 的 `url` 重命名而来） |
| `tokenHandling` | 可选 | AFF 的 CSRF token 开关；当前 ICF handler 未实现，不下发 |
| `description` | ✅ | 描述（SE80 显示） |
| `originalLanguage` | 推荐 | 原始语言（`EN` / `DE` / ...） |
| `abapLanguageVersion` | 可选 | `standard` / `cloudDevelopment` |

## 命令示例

```bash
# 拉一个已有 SICF 节点（写出的 .http.json 是严格 AFF 形态，可直接用于 push/create）
abap pull ZMY_SERVICE --type HTTP --json

# 建 SICF 节点：必须带 --file（abap-file-format JSON；只支持 $ 前缀本地包）
abap create HTTP ZMY_SERVICE --file src/zmy_service.http.json --package '$TMP' --json

# 或者手写 .http.json 后直接 push —— HTTP push 允许 create-on-push（同样只支持本地包）
abap push src/zmy_service.http.json --yes --json

# 改完推回（pulled 文件不带 package，handler 会保留节点现有的本地包）
abap push src/zmy_service.http.json --yes --json

# 删除本地（$ 前缀包）SICF 节点；根节点 / 有子节点 / 可传输节点请在 SICF 里删
abap delete ZMY_SERVICE --type HTTP --yes --json
```

> **写入范围**：SICF 节点的 `create` / `push` 只支持 `$` 前缀本地包——内置 ICF 服务无法把新建/修改记录到传输请求，可传输包会返回 `HTTP_PACKAGE_NOT_SUPPORTED`（exit 7）。可传输节点请在事务 SICF 维护，并用 `abap pull` 只读查看。

## 删除

`abap delete <name> --type HTTP --yes` 走 ICF `DELETE /http/<name>`（SICF 节点不是 ADT 对象，通用 lock→delete→unlock 路径无法寻址）。内置 handler 的规则：

- 只允许删除 TADIR 包为 `$` 前缀本地包的节点；可传输节点返回 `HTTP_DELETE_UNSUPPORTED`（exit 7），请在事务 SICF 删除，以便删除进入传输请求。
- 根节点返回 `HTTP_SERVICE_ROOT_NODE`；仍有子节点的节点返回 `HTTP_SERVICE_HAS_CHILDREN`（先删子节点）；SICF 权限不足返回 `HTTP_SERVICE_NOT_AUTHORIZED`（exit 5）。节点不存在映射为 `OBJECT_NOT_FOUND`（exit 8）。
- 删除前会清理 `ICFAPPLCUST` 应用定制行（SAP API 不自动清），再调用 `cl_icf_tree` 的 `delete_node`；TADIR 行随节点删除。
- 名称上限 15 字符（ICFNAME）；`/` 开头的输入按 SICF 路径解析。

## abap-file-format 合规性

✅ 与上游 `http-v1.json` 对齐（本地文件用 AFF 的 `servicePath`；wire 侧的 `url` 转换见上）。真实 SAP create 曾报 `HTTP_SERVICE_INVALID`，commit `7fd13ec` 修复了嵌套形态。

## 已知坑

- **本地文件从 `url` 改名为 `servicePath`**：上游 AFF 重写了 `http-v1.json`（`url` → `servicePath`，新增 `tokenHandling`）。旧文件的 `generalInformation.url` / 顶层 `url` 现在会被 `validate:aff` / `push` / `create` 以 VALIDATION_ERROR 拒绝，迁移即改名。
- **SICF 描述超过 AFF 60 字符上限会被截断**：`ICFDOCU.ICF_DOCU` 是定长 CHAR（尾部空格），且真实 SICF 节点的描述可能是 `节点名 + GUID + 文本` 的长串（真机 `test` 环境实测 >60）。`pull` 会 `trim` 后截断到 60 字符以满足 `http-v1.json` 的 `header.description` `maxLength`；若 push 回去，SAP 侧描述会变成截断后的文本，需要修改节点描述时请先在本地编辑 `header.description`（≤60）。
- **pull 写出严格 AFF 文件，对象名在文件名里**：`generalInformation` 之外的 `name` 不是 AFF 字段，`pull` 不落盘；`push` / `create` 会用文件名 / 命令行参数补上名字再校验，所以 pull 出来的文件可以改完直接推回（早期版本要求文件里带 `name`，从 pull 结果 push 会报 `Missing required field: name`）。
- **删除只看 TADIR 包**：handler 用 `TADIR`（`OBJECT='SICF'`，obj_name = 15 字符节点名 + 父节点 GUID）判定包；没有 TADIR 行的节点返回 `HTTP_DELETE_UNSUPPORTED`，退回 SICF 删除。
- **`serviceId` / `descriptionByLang[]` 不落盘**：ABAP handler 的 `GET /http/<name>` 会回传 `service_id`（节点 URL）与 `description_by_lang`（ICFDOCU 多语言行），但 `http-v1.json` 是 `additionalProperties:false`，把它们写进本地文件会让 pull 的写前校验报 `AFF_FIXTURE_INVALID`。现在本地 `.http.json` 只保留 AFF 字段（`servicePath` / `tokenHandling` 等）；旧文件里若残留这些字段（含 CLI 信封 `name`），push/`validate:aff` 会拒绝，删掉或重新 `abap pull --overwrite` 即可。
- **pull 落盘 `originalLanguage` 取登录语言**：ABAP GET 按 `sy-langu` 推导（如登录语言 ZH 则落 `ZH`），不一定等于创建时的值；两次 pull 间一致，不影响 push/pull 幂等闭环。
- **`create HTTP` 必须带 `--file`**：032 US10 曾支持"无 `--file` 落最小骨架（`action: local`，不调 SAP，已有同名文件返回 `OVERWRITE_REQUIRED`）"，该路径已按重构决策 1A 删除，与 DDIC / DDLS 行为对齐。要起本地草稿请手写 `.http.json`（见 `abap create --schema HTTP` 的 `exampleJson`），或先 `abap pull` 一个同类节点再改；`abap create local HTTP` 不支持 HTTP。
- **`servicePath` 必须以 `/` 开头**：不写 `/` 时 SAP 端会拒；CLI 不做前缀校验
- **`handlerClass` 必须存在**：push 时 SAP 端会校验；不存在的类会报 `CLASS_NOT_FOUND`
- **BTP Steampunk 上 ICF 节点不在本地**：Steampunk SaaS 的 ICF 服务由 BTP 平台管理；CLI 走 source-only + CF destination 提示

# references

- 类型索引：[`wiki/objects/index.md`](index.md)
- 通用 abap-file-format 合规性：[`src/abap_cli/schema/README.md`](../../src/abap_cli/schema/README.md)
