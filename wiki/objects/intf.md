---
type: object-type
title: INTF — ABAP OO 接口
description: INTF 对象的字段契约、本地文件形态、abap-file-format 合规性
tags: [abap-cli, object-type, intf, abap-file-format, adt]
created at: 2026-09-01 00:00:00
changed at: 2026-09-01 00:00:00
---

# INTF — ABAP OO 接口

## 路由

**ADT**（同 CLAS）。

## 本地文件形态

```
src/intf/zif_my_iface/
└── zif_my_iface.intf.abap   # main part（接口通常只有一个 part）
```

大部分接口只有一个 main part；包含 nested interface 定义的接口会附带 `*.intf.testclasses.abap`。

## `<name>.intf.json` 形状

```json
{
  "formatVersion": "1",
  "header": {
    "description": "My interface",
    "originalLanguage": "en"
  }
}
```

## 命令示例

```bash
abap create INTF ZIF_MY_IFACE --package $TMP --description "iface" --tr $TMP --json
abap pull ZIF_MY_IFACE --json
abap push src/intf/zif_my_iface/ --tr DEVK900001 --json
```

## abap-file-format 合规性

✅ 完全合规（interace 类型最简单，仅 main part）。

## 已知坑

- **接口的 `abapLanguageVersion` 不能改**：push 时 CLI 不写该字段（SAP 端默认 `standard`）；如需 cloudDevelopment 需在 GUI 改后 pull

# references

- 类型索引：[`wiki/objects/index.md`](index.md)
