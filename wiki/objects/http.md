---
type: object-type
title: HTTP — SICF 服务节点（ICF Tree Node）
description: HTTP 类型的 SICF 节点管理；走 ICF 自建通道
tags: [abap-cli, object-type, http, sicf, icf, abap-file-format]
created at: 2026-09-01 00:00:00
changed at: 2026-10-31 15:05:00
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
| `name` | ✅ | SICF 节点名（自动大写） |
| `handlerClass` | ✅ | 处理类，必须存在并实现 IF_HTTP_EXTENSION |
| `servicePath` | ✅ | 完整 SICF 路径（须 `/` 开头；上游 AFF 的 `url` 重命名而来） |
| `tokenHandling` | 可选 | AFF 的 CSRF token 开关；当前 ICF handler 未实现，不下发 |
| `description` | ✅ | 描述（SE80 显示） |
| `originalLanguage` | 推荐 | 原始语言（`EN` / `DE` / ...） |
| `abapLanguageVersion` | 可选 | `standard` / `cloudDevelopment` |

## 命令示例

```bash
# 拉一个已有 SICF 节点
abap pull ZMY_SERVICE --type HTTP --json

# 建 SICF 节点：必须带 --file（abap-file-format JSON，--package $TMP 无需 --tr）
abap create HTTP ZMY_SERVICE --file src/zmy_service.http.json --package $TMP --json

# 或者手写 .http.json 后直接 push —— HTTP push 允许 create-on-push
abap push src/zmy_service.http.json --tr DEVK900001 --json

# 改完推回
abap push src/zmy_service.http.json --tr DEVK900001 --json
```

## abap-file-format 合规性

✅ 与上游 `http-v1.json` 对齐（本地文件用 AFF 的 `servicePath`；wire 侧的 `url` 转换见上）。真实 SAP create 曾报 `HTTP_SERVICE_INVALID`，commit `7fd13ec` 修复了嵌套形态。

## 已知坑

- **本地文件从 `url` 改名为 `servicePath`**：上游 AFF 重写了 `http-v1.json`（`url` → `servicePath`，新增 `tokenHandling`）。旧文件的 `generalInformation.url` / 顶层 `url` 现在会被 `validate:aff` / `push` / `create` 以 VALIDATION_ERROR 拒绝，迁移即改名。
- **`serviceId` / `descriptionByLang[]` 不落盘**：ABAP handler 的 `GET /http/<name>` 会回传 `service_id`（节点 URL）与 `description_by_lang`（ICFDOCU 多语言行），但 `http-v1.json` 是 `additionalProperties:false`，把它们写进本地文件会让 pull 的写前校验报 `AFF_FIXTURE_INVALID`。现在本地 `.http.json` 只保留 AFF 字段（`servicePath` / `tokenHandling` 等）；旧文件里若残留这两个字段，push/`validate:aff` 会拒绝，删掉或重新 `abap pull --overwrite` 即可。
- **pull 落盘 `originalLanguage` 取登录语言**：ABAP GET 按 `sy-langu` 推导（如登录语言 ZH 则落 `ZH`），不一定等于创建时的值；两次 pull 间一致，不影响 push/pull 幂等闭环。
- **`create HTTP` 必须带 `--file`**：032 US10 曾支持"无 `--file` 落最小骨架（`action: local`，不调 SAP，已有同名文件返回 `OVERWRITE_REQUIRED`）"，该路径已按重构决策 1A 删除，与 DDIC / DDLS 行为对齐。要起本地草稿请手写 `.http.json`（见 `abap create --schema HTTP` 的 `exampleJson`），或先 `abap pull` 一个同类节点再改；`abap create local HTTP` 不支持 HTTP。
- **`servicePath` 必须以 `/` 开头**：不写 `/` 时 SAP 端会拒；CLI 不做前缀校验
- **`handlerClass` 必须存在**：push 时 SAP 端会校验；不存在的类会报 `CLASS_NOT_FOUND`
- **BTP Steampunk 上 ICF 节点不在本地**：Steampunk SaaS 的 ICF 服务由 BTP 平台管理；CLI 走 source-only + CF destination 提示

# references

- 类型索引：[`wiki/objects/index.md`](index.md)
- 通用 abap-file-format 合规性：[`src/abap_cli/schema/README.md`](../../src/abap_cli/schema/README.md)
