---
type: reference
title: 类型子目录布局（src/<type>//...）
description: 所有 pull/create 产物落到 `src/<typeFolder>/<name>/` 下；偏离 abap-file-format 严格规范换取多类型共存整洁
tags: [abap-cli, design-decisions, file-layout, abap-file-format]
created at: 2026-09-01 00:00:00
changed at: 2026-09-01 00:00:00
---

# 003 — 类型子目录布局（`src/<type>/...`）

## 决策

所有本地文件按 SAP 对象类型落到子目录：

```
src/
├── clas/zcl_my_class/
│   ├── zcl_my_class.clas.json
│   └── zcl_my_class.clas.abap
├── prog/zprog/zprog.prog.abap
├── tabl/zmy_table/
│   ├── zmy_table.tabl.json
│   ├── zmy_table.tabl.ddic
│   └── zmy_table.tabl.settings.json
└── doma/zmy_dom.doma.json
```

子目录名由 [`src/abap_cli/formats/type-folder.ts`](../../src/abap_cli/formats/type-folder.ts) 的 `folderFor(type)` 决定（小写：`clas` / `intf` / `prog` / `fugr` / `tabl` / `doma` / `stru` / `dtel` / `http` / `tran`；未识别类型 → `unknown/`）。

## 上下文

abap-file-format 官方规范（`https://github.com/SAP/abap-file-formats`）要求**扁平布局**——所有文件直接放仓库根或包目录。abapGit 沿用这一布局。但 abap-cli 的使用场景是「一个本地工作区里多种类型对象共存」（同时编辑类、表、域、函数组），扁平布局会让 `src/` 很快变成字母大杂烩。

## 被否决方案

- **严格遵循 abap-file-format（扁平）**：满足官方规范；多类型时工作区混乱
- **完全套用 abapGit 目录布局（含 `.abapgit.xml`）**：违背宪法 Principle III「本仓库不实现 abapGit 序列化/反序列化」

## 当前代价

- **不与 abapGit 兼容**（这是已知的；写在 README）
- 与 abap-file-format 官方规范有偏离（用户读 `.tabl.json` 时看到的路径与官方示例不同）
- `abap-file-format` 工具（`abap-file-formats-tools`）做严格校验时需要调整 include 路径

## 后果

- **正面**：多类型工作区一目了然；agent 按类型文件夹定位文件零歧义
- **负面**：从 abapGit 仓库迁回 SAP 时需要重新组织目录

# references

- 规范来源：[`wiki/abap-file-format-export.md`](../abap-file-format-export.md)
- 实现：[`src/abap_cli/formats/type-folder.ts`](../../src/abap_cli/formats/type-folder.ts)
- 仓库宪法：[`.github/copilot-instructions.md`](../../.github/copilot-instructions.md) — Principle III
