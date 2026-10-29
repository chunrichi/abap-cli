---
type: object-type
title: PROG — ABAP 报表程序
description: PROG 对象的字段契约、4 种 programType、本地文件形态
tags: [abap-cli, object-type, prog, abap-file-format, adt, textpool]
created at: 2026-09-01 00:00:00
changed at: 2026-09-02 22:06:00
---

# PROG — ABAP 报表程序

## 路由

**ADT**。PROG 是 ADT 写源对象中最常见的，写路径稳定。

## 本地文件形态

```
src/prog/zprog/
├── zprog.prog.json          # 元数据（含 programType）
├── zprog.prog.abap          # main source
├── zprog.prog.texts.en.properties        # 可选 — textpool
├── zprog.prog.selections.en.properties   # 可选 — textpool
└── zprog.prog.headings.en.properties    # 可选 — textpool
```

textpool 文件仅在 `pull --textpool` 时生成；`.en` 是语言后缀，按 profile 的 `language` 决定。

## `<name>.prog.json` 形状

```json
{
  "formatVersion": "1",
  "header": {
    "description": "Demo report",
    "originalLanguage": "en"
  },
  "generalInformation": {
    "programType": "executableProgram"
  }
}
```

## 4 种 programType

| ADT 返回值 | abap-file-format 字段 | 说明 |
|---|---|---|
| `executableProgram` | `executableProgram` | 普通 REPORT，可 `SUBMIT` |
| `classPool` | — | 类池（一般通过 CLAS 创建） |
| `functionPool` | — | 函数池（一般通过 FUGR 创建） |
| `interfacePool` | — | 接口池（一般通过 INTF 创建） |
| `I`（raw）/ 缺省（从 `PROG/I` 推断） | `include` | INCLUDE 程序 |
| `modulePool` | `modulePool` | 模态对话框（屏幕） |

CLI 只 pull/push `executableProgram` 与 `includeProgram`；其他三种应该用对应对象类型创建。

INCLUDE 程序（PROG/I）走独立子路由（commit `624fd3e`）：落盘 `<name>.prog.include.abap`（不混入 `<name>.prog.abap` main 路径），JSON 元数据 `generalInformation.programType: 'include'`。

## 命令示例

```bash
# 普通报表
abap create PROG ZREPORT --package $TMP --description "demo" --tr $TMP --json

# 拉 main + textpool
abap pull ZREPORT --textpool --json

# 跑报表（不常用；通常用 SE38 / abap run 替代）
```

## abap-file-format 合规性

✅ 完全合规（PROG 形状与 CLAS 类似但更简单）。

## 已知坑

- **INCLUDE 程序（PROG/I）已分流**（commit `624fd3e`）：pull 落盘 `<name>.prog.include.abap` + JSON `generalInformation.programType: 'include'`；旧版会把 include 内容写进 main 路径
- **modulePool**：应该用 CLAS 创建对话框类，而不是直接 PROG

# references

- textpool 字段：[`wiki/objects/clas.md`](clas.md) — textpool 文件命名约定同 CLAS
- 类型索引：[`wiki/objects/index.md`](index.md)
