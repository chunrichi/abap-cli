---
type: reference
title: 支持的对象类型
description: abap CLI 支持的 ABAP 对象类型总览 — 类型码 × 命令 × 路由（ADT / ICF）
tags: [abap-cli, object-types, ddic, http, sicf, reference]
created at: 2026-08-29 10:00:00
changed at: 2026-09-02 22:06:00
---

# 支持的对象类型

abap CLI 的类型注册表（`src/abap_cli/types/registry.ts`，commit `89b331f`）覆盖 **10 个对象类型**（4 源 + 4 DDIC + HTTP + TRAN），分两条路由：**ADT**（`abap-adt-api` 走标准 ADT REST API）与 **ICF**（自建服务 `/sap/zabap_vibe`，需先 `abap extension deploy`）。

`create <type>` 的 `--schema` 参数 `allowedValues` 即这 10 个类型码：`CLAS, INTF, PROG, FUGR, TABL, STRU, DOMA, DTEL, HTTP, TRAN`。先查能力再动手：`abap create --schema <TYPE>` 会给出某个类型的字段契约。

## 类型 × 命令矩阵

| 类型码 | 对象 | 路由 | `create` | `pull` | `push` | `create local` | 本地文件 |
|---|---|---|---|---|---|---|---|
| `CLAS` | 类 | ADT | ✅ | ✅ | ✅ | ✅ | `clas/*.clas.abap` |
| `INTF` | 接口 | ADT | ✅ | ✅ | ✅ | ✅ | `intf/*.intf.abap` |
| `PROG` | 报表程序 | ADT | ✅ | ✅ | ✅ | ✅ | `prog/*.prog.abap` |
| `FUGR` | 函数组 | ADT | ✅ | ✅ | ✅ | ✅ | `fugr/*` |
| `TABL` | 透明表 | ICF | ✅ | ✅ | ✅ | ❌ | `tabl/*.tabl.json` + `.tabl.ddic` |
| `STRU` | 结构 | ICF | ✅ | ✅ | ✅ | ❌ | `stru/*.tabl.json` + `.tabl.ddic` |
| `DOMA` | 域 | ICF | ✅ | ✅ | ✅ | ❌ | `doma/*.doma.json` |
| `DTEL` | 数据元素 | ICF | ✅ | ✅ | ✅ | ❌ | `dtel/*.dtel.json` |
| `HTTP` | **ICF / SICF 节点** | ICF | ✅ | ✅ | ✅ | ❌ | `http/*.http.json` |

DDIC 三件套（TABL / STRU）与 DOMA / DTEL 的详细字段契约见 [create](commands/create.md) 与 [pull](commands/pull.md)。

## HTTP —— 就是 SICF 节点

> **类型码是 `HTTP`；`SICF` 是已弃用别名**（commit `ad007c8`）。写 `--type SICF` / `create SICF` 会映射到 `HTTP` 并给出 deprecation warning，不再降级为 `OBJECT_NOT_FOUND`。新脚本请直接写 `HTTP`。

`HTTP` 类型管理的就是 SICF 事务里的 ICF 服务节点（`icfservice`），可读可写：handler class、URL、描述、父节点校验。

```bash
# 拉一个已有 SICF 节点
abap pull ZMY_SERVICE --type HTTP --json

# 创建 / 更新（--file 走真实 SAP；无 --file 自动落最小骨架）
abap create HTTP ZMY_SERVICE --file src/http/zmy_service.http.json --package $TMP --description "My service"

# 改完推回
abap push src/http/zmy_service.http.json --tr <TR>
```

`.http.json` 遵循 abap-file-format（`http-v1.json`）的嵌套结构，同时也接受扁平写法：

```json
{
  "formatVersion": "1",
  "header": {
    "description": "My service",
    "originalLanguage": "EN"
  },
  "generalInformation": {
    "handlerClass": "ZCL_MY_HANDLER",
    "url": "/sap/zmy_service"
  }
}
```

`create HTTP` 无 `--file` 时自动落最小骨架（`src/http/<name>/<name>.http.json`，含 `name`，`action: local`，不调 SAP，commit `7fd13ec`）；有 `--file` 走真实 SAP create/push。`create local` 命令仍不支持 HTTP。

## 两种 "ICF" 的区别

仓库里 "ICF" 指两件不同的事，别混淆：

| | 含义 | 对应 |
|---|---|---|
| **ICF 作为通道** | 自建服务 `/sap/zabap_vibe` 旁路 ADT，承载 DDIC CRUD / textpool / `select` / `tcode` / `run` | `abap extension deploy` / `extension status` |
| **ICF 作为对象** | 被管理的 SICF 服务节点本身 | `--type HTTP` |

也就是说：**用 ICF（通道）来管理 ICF（节点）**。前者是前提，后者是能力——`--type HTTP` 依赖扩展已部署。

## 明确不支持

| 类型 | 状态 | 替代 |
|---|---|---|
| `TTYP` 表类型 | 显式 deferred | — |
| `DDLS` / CDS | 无 create / pull 策略（`.asddls` 等扩展名虽在解析表中，但无实现） | 用 ADT / Eclipse |
| `TRAN` 事务码 | 只读（ABAP `/tran/*` GET-only） | [tcode](commands/tcode.md) 解析；虽在 `create` 的 `allowedValues` 内，服务端不接受写 |
| `ENHO` 增强 | 不支持 | — |

## 常见误判

- `abap pull X --type SICF` / `abap create SICF ...` → 自动映射 `HTTP` + deprecation warning（commit `ad007c8`）；新脚本请直接写 `HTTP`。
- `create <type>` 的 `--schema` `allowedValues` 已是全 10 类（commit `89b331f`）：`CLAS, INTF, PROG, FUGR, TABL, STRU, DOMA, DTEL, HTTP, TRAN`。
- `DDIC_NOT_SUPPORTED` (exit 7) → 类型在 DOMA/DTEL/TABL/STRU 之外。
- 所有 ICF 路由类型在扩展未部署时都会失败 → 先 `abap extension status`。

# More

## todo

- [x] `SICF` → `HTTP` 别名解析，避免降级为 `OBJECT_NOT_FOUND`（commit `ad007c8`）
- [x] `create <type>` `--schema` 补全 `allowedValues` 全 10 类（commit `89b331f`）
- [ ] `create` 的 help/description 文案（"(CLAS, INTF, PROG, FUGR)"）随 registry 动态化

# references

- [create](commands/create.md)
- [pull](commands/pull.md)
- [push](commands/push.md)
- [extension](commands/extension.md)
- [abap-file-format 导出与兼容](abap-file-format-export.md)
