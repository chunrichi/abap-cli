---
type: command
title: abap search
description: 在 SAP 中按名称搜索 ABAP 对象（类、程序、DDIC 等），支持类型/包过滤、通配符、精确匹配与全量抓取
tags: [abap-cli, command, search, quickSearch, adt]
created at: 2026-08-07 00:33:34
changed at: 2026-09-02 23:09:01
---

# abap search

在 SAP 中按名称搜索 ABAP 对象（类、接口、程序、函数组、DDIC 对象等），返回名称、类型、对象 URL、描述与所属包。搜索结果可直接用于后续 `abap pull` / `abap push` / `abap create` 定位对象。底层走 ADT quickSearch（`/sap/bc/adt/repository/informationsystem/search`）。

## Usage

```bash
abap search <query> [options]

# 全量抓取所有匹配（单次请求，上限 = --page-all-max × --limit）
abap search <query> --page-all [--page-all-max <n>]

# 打印参数契约 JSON（不调 SAP）
abap search --schema
```

## Options

- `<query>`: 搜索词，支持 `*` 通配符（如 `ZCL_*`）；透传给 SAP，不做本地解释
- `--type <type>`: 按对象类型过滤（服务端过滤，如 `CLAS`、`PROG`；`CLAS/OC` 自动取 `CLAS`）
- `--limit <n>`: 每页最大结果数（默认 20）
- `--page <n>`: 页码（1-based，默认 1）；底层 quickSearch 无 offset，`--page` 为「取 limit×page 条再本地切片」的假分页
- `--exact`: 精确名称匹配（与 `--fuzzy` 互斥）。查询中的 `*` 会被剥除后比较；裸名自动拓宽为 `*NAME*`（真实 ADT 对裸名常返回 0 命中）
- `--fuzzy`: 子串匹配（默认行为，声明存在）
- `--package <pkg>`: 按所属包过滤（客户端过滤，不区分大小写）
- `--max <n>`: 已废弃，`--limit` 的别名；使用时会输出 `DEPRECATED_OPTION` 警告
- `--page-all`: 一次请求抓取所有匹配，请求量 = `--page-all-max × --limit`（默认 50×20=1000；实测 SAP 支持到 5000 无截断）。返回条数达到请求量时输出 `PAGINATION_LIMITED` 警告并标记 `truncated: true`。与 `--page` 互斥
- `--page-all-max <n>`: `--page-all` 的页数上限（默认 50），用于计算单次请求量
- `--schema`: 打印命令参数契约 JSON 后退出，不发起 SAP 调用
- 全局: `--json` 结构化输出、``

## 行为规则

- **空结果不是错误**：无匹配退出码 0，附 `hint` 提示放宽条件；此时成功 envelope 的 `data` 不含 `items` 键（空数组被剥离，见下文「空结果 JSON 契约」）
- **空/全空白 query** → `USAGE` 错误（exit 2），不发起搜索
- **非法 `--limit`/`--page`/`--page-all-max`**（非正整数）→ `INVALID_ARGUMENT`（exit 2），不发起搜索
- **`--exact` + `--fuzzy`、`--page` + `--page-all`** 互斥 → `INVALID_ARGUMENT`
- **连接/SAP 失败** → 结构化错误（`SAP_ERROR` 等，含 HTTP 状态），退出码非零，不自动重试
- 底层 quickSearch **无 offset**：每次调用返回同一批前 N 条，故 `--page-all` 用单次大请求而非多轮抓取
- `--exact` 裸名拓宽为 `*NAME*` 后，精确对象可能不在前 `--limit` 条内；需要可靠定位时用 `--page-all --exact`

## Examples

```bash
# 通配符搜索所有 Z 类
abap search 'ZCL_*' --type CLAS

# 精确匹配单个对象（裸名自动加通配符）
abap search ZCL_DEMO --exact

# 精确匹配 + 包过滤
abap search '*ZCL_DEMO*' --exact --package Z_PACKAGE

# 分页浏览（第二页）
abap search 'ZCL_*' --type CLAS --limit 20 --page 2

# 一次抓取全部匹配
abap search 'ZCL_*' --type CLAS --page-all

# Agent 无人值守：结构化输出
abap search 'ZCL_*' --json
```

## Expected Output

```json
{
  "status": "success",
  "meta": {
    "command": "abap search",
    "version": "0.2.0",
    "timestamp": "2026-08-07T00:33:34.000Z",
    "durationMs": 311,
    "warnings": []
  },
  "data": {
    "items": [
      {
        "name": "ZCL_ABAP_VIBE_ICF",
        "type": "CLAS/OC",
        "uri": "/sap/bc/adt/oo/classes/zcl_abap_vibe_icf",
        "description": "ICF handler for zabap_vibe.",
        "packageName": "$TMP"
      }
    ],
    "page": 1,
    "limit": 20,
    "truncated": true,
    "hint": "Result truncated. Narrow with --type/--package/--exact, or use --page 2."
  }
}
```

`--page-all` 模式下的 `data` 差异：`pageAll: true`、`requested`（单次请求量）、`total`，无 `page`；`truncated: true` 时 `meta.warnings` 含 `PAGINATION_LIMITED`。

### 空结果 JSON 契约

**无匹配时成功 envelope 的 `data` 不含 `items` 键**——空数组/空对象为 token 经济性被全局剥离（见 `cli-output.schema.json` 对 `data` 的描述），Agent 必须把「缺失 `items`」视为零结果，而非错误：

```json
{
  "status": "success",
  "meta": { "command": "abap search", "warnings": [] },
  "data": {
    "page": 1,
    "limit": 20,
    "truncated": false,
    "hint": "No matches. Broaden the query, drop --package, or use --fuzzy."
  }
}
```

`--page-all` 空结果同理：`data` 含 `pageAll: true`、`requested`、`limit`、`total: 0`、`hint`，无 `items`（亦无 `truncated`）。两种模式下空结果退出码均为 0。

# More

## fixme

- [ ] **C** — `--page` 的"假分页"语义（quickSearch 无 offset，取 limit×page 再本地切片）易误导 Agent：跨页结果会重复。文档已注明，但 `--schema` 的 option 描述可补充一句"优先用 `--page-all`"。

## todo

- [ ] **本地结果缓存** — roadmap 建议加 `--stale N` 过期提示（高频 agent 调用提速）；缓存键为 `type + query + filters`，存 `~/.abap-cli/cache/`。
- [ ] **结果结构稳定化** — 增加 `name` 归一化（namespaced `/UI2/CL_JSON` 与 `#ui2#cl_json` 归一）供 Agent 直接用于 `abap pull`。

# references

- 实现：`src/abap_cli/commands/search.ts`、`src/abap_cli/clients/adt-client.ts`（`searchObject`）、`src/abap_cli/core/limits.ts`（`SEARCH_RESULT_LIMIT`）
- 底层：`abap-adt-api` `api/search.js`（quickSearch 无 offset，maxResults 实测支持至 5000）
- 测试：`test/unit/search-pagination.test.ts`、`test/unit/search-page-all.test.ts`
- 相关：`src/abap_cli/core/resolve.ts`（对象解析的裸名 `*NAME*` 重试逻辑）
- 文档：见 wiki 顶层 `abap-search` 历史回顾（设计文档不入 git，详见仓库 wiki）
