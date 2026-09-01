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

`localToWire` 在 `src/abap_cli/dictionary/http-json.ts` 内做 abap-file-format → wire 双向兼容。

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

# 创建（必须 --file；没有 create local 骨架）
abap create HTTP ZMY_SERVICE --file src/http/zmy_service.http.json --package $TMP --description "My service" --tr $TMP --json

# 改完推回
abap push src/http/zmy_service.http.json --tr DEVK900001 --json
```

## abap-file-format 合规性

✅ 与 `http-v1.json` 对齐；CLI 接受两种写法。

## 已知坑

- **`url` 必须以 `/` 开头**：不写 `/` 时 SAP 端会拒；CLI 不做前缀校验
- **`handlerClass` 必须存在**：push 时 SAP 端会校验；不存在的类会报 `CLASS_NOT_FOUND`
- **BTP Steampunk 上 ICF 节点不在本地**：Steampunk SaaS 的 ICF 服务由 BTP 平台管理；CLI 走 source-only + CF destination 提示
- **没有 `create local`**：HTTP 必须有 handlerClass，CLI 无法离线构造合理骨架

# references

- 类型索引：[`wiki/objects/index.md`](index.md)
- 通用 abap-file-format 合规性：[`wiki/abap-file-format-export.md`](../abap-file-format-export.md)
