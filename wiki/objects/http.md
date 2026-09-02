---
type: object-type
title: HTTP — SICF 服务节点（ICF Tree Node）
description: HTTP 类型的 SICF 节点管理；走 ICF 自建通道
tags: [abap-cli, object-type, http, sicf, icf, abap-file-format]
created at: 2026-09-01 00:00:00
changed at: 2026-09-01 00:00:00
---

# HTTP — SICF 服务节点（ICF Tree Node）

## 路由

**ICF 自建**（`/sap/zabap_vibe/http/<name>`）。

## 名称说明

> **类型码是 `HTTP`，不是 `SICF`**。写 `--type SICF` 不会被识别，会被当成 ADT 类型下传，最终报 `OBJECT_NOT_FOUND`（对象不存在），而不是"类型不支持"。这是目前最容易踩的坑。

## 本地文件形态

```
src/http/zmy_service/
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
    "url": "/sap/zmy_service"
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
  "url": "/sap/zmy_service"
}
```

`localToWire` / `wireToLocal` 在 `src/abap_cli/formats/http/json.ts` 内做 abap-file-format → wire 双向兼容。**wire 即文件本身的嵌套形态**（真实 SAP ICF handler 按 `ty_http_service_data` 契约反序列化）；`package` / `transportRequest` 只作为 POST 顶层信封，不落盘。

## 关键字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `name` | ✅ | SICF 节点名（自动大写） |
| `handlerClass` | ✅ | 处理类，必须存在并实现 IF_HTTP_EXTENSION |
| `url` | ✅ | 完整 URL 路径（须 `/` 开头） |
| `description` | ✅ | 描述（SE80 显示） |
| `originalLanguage` | 推荐 | 原始语言（`EN` / `DE` / ...） |
| `abapLanguageVersion` | 可选 | `standard` / `cloudDevelopment` |

## 命令示例

```bash
# 拉一个已有 SICF 节点
abap pull ZMY_SERVICE --type HTTP --json

# 无 --file：落最小骨架（action local，不调 SAP），编辑后 push
abap create HTTP ZMY_SERVICE --package $TMP --description "My service" --json

# 有 --file：直接在 SAP 建 SICF 节点（--package $TMP 无需 --tr）
abap create HTTP ZMY_SERVICE --file src/http/zmy_service.http.json --package $TMP --json

# 改完推回
abap push src/http/zmy_service.http.json --tr DEVK900001 --json
```

## abap-file-format 合规性

✅ 与 `http-v1.json` 对齐；CLI 接受两种写法。

## 已知坑

- **`serviceId` / `descriptionByLang[]` 仅 CLI 透传**：032 US10 落盘字段。当前 ABAP handler（0.5.0 结构）不含这两字段——POST 忽略、GET 不回传，真实 SAP 上无法 round-trip（标准 http-v1 字段已闭环）。本地手写文件若含扩展字段，push 后再次 pull 会丢失，属预期（待 ABAP 端扩展）。
- **pull 落盘 `originalLanguage` 取登录语言**：ABAP GET 按 `sy-langu` 推导（如登录语言 ZH 则落 `ZH`），不一定等于创建时的值；两次 pull 间一致，不影响 push/pull 幂等闭环。
- **`create HTTP` 无 `--file` 落最小骨架**：`src/http/<name>/<name>.http.json`（含 `name`；`action: local`，不调 SAP）；编辑 `url` / `handlerClass` 后即可 `abap push`。已有同名文件返回 `OVERWRITE_REQUIRED`。
- **`url` 必须以 `/` 开头**：不写 `/` 时 SAP 端会拒；CLI 不做前缀校验
- **`handlerClass` 必须存在**：push 时 SAP 端会校验；不存在的类会报 `CLASS_NOT_FOUND`
- **BTP Steampunk 上 ICF 节点不在本地**：Steampunk SaaS 的 ICF 服务由 BTP 平台管理；CLI 走 source-only + CF destination 提示

# references

- 类型索引：[`wiki/objects/index.md`](index.md)
- 通用 abap-file-format 合规性：[`wiki/abap-file-format-export.md`](../abap-file-format-export.md)
