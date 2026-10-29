---
type: object-type
title: CLAS — ABAP OO 类
description: CLAS 对象的字段契约、本地文件形态、abap-file-format 合规性、已知坑
tags: [abap-cli, object-type, clas, abap-file-format, adt]
created at: 2026-09-01 00:00:00
changed at: 2026-09-02 22:06:00
---

# CLAS — ABAP OO 类

## 路由

**ADT**（无需 ICF 部署）。走 `abap-adt-api` 的 `getObjectStructure` + `getObjectSource` + `setObjectSource` + `activate`。

## 本地文件形态

类型子目录布局（详见 [design-decisions/003](../design-decisions/003-typesubdir-layout.md)）：

```
src/clas/zcl_my_class/
├── zcl_my_class.clas.json     # 元数据（abap-file-format）
├── zcl_my_class.clas.abap     # main part
├── zcl_my_class.clas.testclasses.abap   # abapUnit 测试
└── zcl_my_class.clas.locals_def.abap    # LOCAL 定义（罕见）
```

`includeType` → 文件名后缀映射：

| ADT `class:includeType` | abap-file-format subtype | 文件名后缀 |
|---|---|---|
| `main` | `main` | `.clas.abap` |
| `definitions` | `definitions` | `.clas.definitions.abap` |
| `implementations` | `implementations` | `.clas.implementations.abap` |
| `macros` | `macros` | `.clas.macros.abap` |
| `testclasses` | `testclasses` | `.clas.testclasses.abap` |

如果对象使用了 LOCAL 定义区（私有子句 / 类内子例程），这些部分会出现在 `objectStructure.includes` 但**不**映射到上面五个标准 subtype —— pull 时归类为附加文件，文件名后缀来自 ADT 返回的 includeType。

## `<name>.clas.json` 形状

遵循 [abap-file-format clas-v1.json](https://github.com/SAP/abap-file-formats/blob/main/file-formats/clas/clas-v1.json) 的 main 部分：

```json
{
  "formatVersion": "1",
  "header": {
    "description": "Demo class",
    "originalLanguage": "en",
    "abapLanguageVersion": "standard"
  }
}
```

CLI 双向映射 `description` / `originalLanguage` / `abapLanguageVersion`（commit `fe5d014`）：pull 时从 `objectStructure.metaData['adtcore:abapLanguageVersion']` 读取写入 `header`，push 时回传。

## 命令示例

```bash
# 创建
abap create CLAS ZCL_DEMO --package $TMP --description "demo" --tr $TMP --json

# 拉取（含全部 include）
abap pull ZCL_DEMO --include-all-parts --json

# 推送（main + 任意修改的 include）
abap push src/clas/zcl_demo/ --tr DEVK900001 --json

# 语法检查
abap check syntax src/clas/zcl_demo/zcl_demo.clas.abap --json

# 跑（classrun）
abap run ZCL_DEMO --json
```

## abap-file-format 合规性

✅ 完全合规：`formatVersion: "1"` + `header{description, originalLanguage}`；include 文件名与 subtype 用规范名；abapUnit 测试归 `testclasses`。

## 已知坑

- **partial class / LOCAL 定义区**：ADT 返回的 `includeType` 不一定在五个标准 subtype 内；pull 时会落到 `unknown/` 子目录（虽然这是 `clas/` 子目录内的未知文件名）
- **`abapLanguageVersion` 写权限**：BTP trial 上 `abapLanguageVersion: 'cloudDevelopment'` 会被强制为 `standard`
- **激活不掩盖语法错**：push 报 activated 还要 `inspect --activation` 复核

# references

- pull 命令：[`wiki/commands/pull.md`](../commands/pull.md)
- create 命令：[`wiki/commands/create.md`](../commands/create.md)
- 类型索引：[`wiki/objects/index.md`](index.md)
