---
type: command
title: abap dumps
description: 通过只读 ADT Atom feed 列出近期 ST22 ABAP runtime dump 的紧凑摘要
tags: [abap-cli, command, dumps, st22, adt, read-only]
created at: 2026-08-31 22:00:00
changed at: 2026-08-31 22:00:00
---

# abap dumps

列出当前 SAP 连接中近期的 ST22 ABAP runtime dump。命令请求 ADT 的 `GET /sap/bc/adt/runtime/dumps` Atom feed；不会创建 lock、transport 或 SAP 数据变更。结果只保留适合 Agent 判断的稳定 ID、runtime error、分类、发生用户和已归一化的摘要，不输出 ADT 详情 URL。

## Usage

```bash
abap dumps [--limit <n>] [--user <name>] [--json]
abap dumps --schema [--json]
```

## Options

- `--limit <n>`: 最大返回条目数，范围为 1 到 100，默认 20。该限制作为 ADT 的 `$top` 查询参数在 SAP 端应用，避免先传输完整 feed 再裁剪。
- `--user <name>`: SAP 用户过滤条件。省略时使用当前连接的登录用户；传入空值 `--user ""` 时不发送 user 过滤，查询所有用户。
- `--json`: 输出统一 JSON 信封，供 Agent 消费。
- `--schema`: 输出机器可读的参数 schema，不访问 SAP。

## Examples

```bash
# 查看近期 dump 摘要
abap dumps

# 仅获取五条紧凑 JSON 结果
abap dumps --limit 5 --json

# 查询所有用户的近期 dump
abap dumps --user "" --limit 5 --json

# Agent 自省：当前命令的参数契约
abap dumps --schema
```

## Expected Output

```json
{
  "status": "success",
  "meta": {
    "command": "abap dumps",
    "version": "0.2.3"
  },
  "data": {
    "updatedAt": "2026-08-31T13:45:00.000Z",
    "total": 3,
    "returned": 3,
    "dumps": [
      {
        "id": "20260831124545DEVELOPER001",
        "runtimeError": "TIME_OUT",
        "category": "ABAP runtime error",
        "author": "DEVELOPER",
        "summary": "Runtime error TIME_OUT occurred in program ZCL_TEST->RUN"
      }
    ]
  }
}
```

人类模式：

```
3 of 3 recent dump(s); updated 2026-08-31T13:45:00.000Z
  20260831124545DEVELOPER001: TIME_OUT | DEVELOPER - Runtime error TIME_OUT occurred in program ZCL_TEST->RUN
  20260831120412DEVELOPER002: CONVT_NO_NUMBER | DEVELOPER - ...
  20260831095801DEVELOPER003: DUMP_IN_ITAB | DEVELOPER - ...
```

## 关键错误码

| 错误 | 类别 / exit | 含义 | 恢复 |
|---|---|---|---|
| `INVALID_ARGUMENT` | USAGE / 2 | `--limit` 越界或 `--user` 格式不合法 | 重设参数（参考 `example`） |
| `CONFIG_ERROR` | CONFIG_ERROR / 2 | 未配置 SAP profile 或 `.abap.json` | `abap init` 或 `abap profile add` |
| `AUTH_ERROR` | AUTH_ERROR / 5 | SAP 返回 401/403 | `abap doctor` 检查凭据与 mTLS 证书 |
| `SAP_ERROR` | SAP_ERROR / 6 | ADT 5xx 或 ICF 端点不可达 | `abap doctor` 诊断 |

## 关联命令

- **`abap run`**: 程序崩溃时拿 dump 摘要
- **`abap doctor`**: SAP 不可达或鉴权失败时排查
- **`abap inspect`**: 查某个对象元数据，不查 dump

## 实现要点

- 只读命令：不创建 lock、不触发 transport、不修改 SAP 数据
- ABAP 侧零改动：复用 `/sap/bc/adt/runtime/dumps` 标准 ADT Atom feed
- 走 `AdtClientWrapper.dumps(limit?, user?)` 包装层直接发 `$top` + `$filter` 查询参数（绕过 library 的 `$query=` 封装，让 SAP 端一次裁剪）
- `DumpsFeed` / `Dump` 类型复用 `abap-adt-api@8.4.1`，XML 解析由 library 完成
- 摘要字段空白合并 + 500 字符截断，避免 Agent 拿到大段无用 XML

# references

- 设计：见 wiki 顶层 `abap-dumps` 历史回顾
- ABAP 侧无需改动
- ADT 端点：`GET /sap/bc/adt/runtime/dumps`（接受 `application/atom+xml;type=feed`）