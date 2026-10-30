---
type: reference
title: AFF 原生扁平布局（src/ 平铺 + 命名空间括号）
description: 所有 pull/create 产物直接平铺在 `src/`，文件名遵循 abap-file-format 的 `<name>.<type>[.<sub_object>][.<content_type>][.<language>].<ext>`；命名空间 `/UI2/CL_JSON` → `(ui2)cl_json` — 决策、上下文、被否决方案与当前代价
tags: [abap-cli, design-decisions, file-layout, abap-file-format, aff, namespaces]
created at: 2026-10-30 20:00:00
changed at: 2026-10-30 20:00:00
---

# 010 — AFF 原生扁平布局（`src/` 平铺 + 命名空间括号）

## 决策

1. **所有本地产物直接平铺在输出目录**（`--dir`，默认 `src/`），不再有类型目录（`src/clas/`）或对象目录（`src/clas/zcl_foo/`）。
2. **文件名遵循 abap-file-format（AFF）规范**：

   ```
   <object_name>.<object_type>.[<sub_object_name>.<sub_object_type>.][<content_type>.][<language>.]<file_extension>
   ```

   例：`src/zcl_my_class.clas.json` + `src/zcl_my_class.clas.abap` + `src/zcl_my_class.clas.definitions.abap`；`src/ztabl_demo.tabl.json` + `.tabl.ddic` + `.tabl.settings.json`；`src/zfg.fugr.json` + `src/zfg.fugr.saplzfg.reps.abap` + `src/zfg.fugr.<fm>.func.abap`；`src/zprog.prog.texts.en.properties`。
3. **命名空间转括号**：`/UI2/CL_JSON` → `src/(ui2)cl_json.clas.abap`。旧 abapGit 风格 `#ui2#cl_json` 不再识别（push 报 `FILE_PARSE_ERROR` 并提示重新 `abap pull`）。
4. **bundled ABAP 源码同步扁平化**：仓库自带 `abap/src/clas/*.clas.*` 改为 `abap/src/*.clas.*`，与 CLI 的落盘布局一致。
5. `abap types` 的输出删除 FOLDER 列/字段——本地路径不再由类型决定。

## 上下文

AFF 官方规范（[docs/specification.md 的 File Names 一节](https://github.com/SAP/abap-file-formats/blob/main/docs/specification.md)）只规定**文件名**：`<object_name>.<object_type>.[<sub_object_name>.<sub_object_type>.][<content_type>.][<language>.]<file_extension>`；命名空间转括号（`/NMSPC/CL_OBJECT` → `(nmspc)cl_object`）；`content_type` 用于区分同一对象的多份非传输对象文件（如 `clas.testclasses.abap`、`clas.texts.en.properties`）；`language` 按 BCP47。规范**不规定目录层级**——AFF 仓库自己的 examples 与 abapGit 的实际形态都是扁平目录。

旧决策（[003](003-typesubdir-layout.md)）为了"多类型工作区整洁"引入了类型子目录 + 对象子目录，并配合 abapGit 的 `#` 命名空间转义。代价是本地布局与 AFF 规范、abapGit、AFF 工具链都不同源：同一对象在 AFF 示例里是 `cl_oo_clif_source.clas.abap`，在本仓库是 `src/clas/cl_oo_clif_source/cl_oo_clif_source.clas.abap`；命名空间对象更是 `src/clas/#ui2#cl_json/...`。这使"遵循 abap-file-format 约定"的仓库合约名不副实，也让 AFF 工具（`abap-file-formats-tools`）与 abapGit 工作区无法直接互操作。

## 被否决方案

- **保留类型目录（只去掉对象目录）**：仍偏离 AFF 文件名 + 目录的参考形态；abapGit/AFF 工具仍无法直接消费。
- **保留对象目录（只去掉类型目录）**：文件名已编码对象名，目录纯属重复；跨对象同名 include（如 `zcl_a.clas.definitions.abap` 与 `zcl_b.clas.definitions.abap`）反而要靠目录区分。
- **继续用 abapGit `#` 命名空间转义**：`#` 是 abapGit 的本地约定而非 AFF 规范；规范明确用括号，两者混用会让同一对象在磁盘上有两种名字。
- **同时兼容旧布局（双读双写）**：与仓库"倾向重写、不加兼容层"的风格冲突；旧工作区重新 `abap pull` 成本极低。

## 当前代价

- **多类型工作区的 `src/` 文件数变多**：类、表、域、程序的文件全部平铺在一层，`ls src/` 会比旧布局长。AFF 的文件名已自带类型后缀（`.clas.` / `.tabl.` / `.doma.`），按类型过滤靠 glob 而不是目录。
- **文件名唯一性由 AFF 命名保证**：`<name>.<type>` 天然隔离不同对象；同对象的多个 part 由 sub_object/content_type 区分（`.clas.definitions.abap` vs `.clas.implementations.abap`）。
- **旧工作区需要重新 `abap pull`**：旧的 `src/<type>/<object>/` 嵌套目录不会再被写入，可直接删除；旧的 `#ns#name` 文件必须重新 pull 后才能 push（push 会拒绝 `#` token 并给出迁移提示）。
- **`abap/src` 布局随 npm 包升级无感**：bundled 源码由 `abap deploy` 内部读取，用户不需要手动整理。
- **`abap types` 不再提供本地目录信息**：需要文件路径时看 AFF 文件名（`<name>.<type>...`），或 `abap pull` 的 `written[]` 输出。

## 后果

- **正面**：本地布局与 AFF 规范、abapGit、AFF examples 同源；AFF 工具与 abapGit 工作区可直接互操作；命名空间对象用规范括号形式，无需记忆 abapGit 转义；仓库合约"遵循 abap-file-format"名副其实。
- **正面**：`abap pull` / `abap create` / `abap create local` 的落盘路径不再依赖类型 → 目录映射（`type-folder.ts#folderFor` 删除），新增类型不需要注册目录。
- **负面**：这是一次 breaking change——旧工作区文件路径全部失效，需要重新 pull；依赖旧路径的脚本/文档需同步更新（见 `CHANGELOG.md` 的 Migration）。
- **边界**：目录层级与文件名分离——`--dir` 决定写到哪一层（仅 `abap pull` / `abap create local` 生效），文件名自身编码对象名与类型；`abap push` 只看 `path.basename`，参数是文件而非目录（批量用 `--all`）。

# references

- 规范来源：[abap-file-formats — File Names](https://github.com/SAP/abap-file-formats/blob/main/docs/specification.md)（vendored schema 见 [`src/abap_cli/schema/README.md`](../../src/abap_cli/schema/README.md)）
- 实现：[`src/abap_cli/formats/file-resolver.ts`](../../src/abap_cli/formats/file-resolver.ts)（`buildFilename` / `affObjectToken` / `affObjectNameFromToken`）
- 落盘路径：`src/abap_cli/flows/edit/pull-*.ts`、`create.ts`、`create-local.ts`
- 被取代的决策：[003 — 类型子目录布局](003-typesubdir-layout.md)
- 仓库合约：[`AGENTS.md`](../../AGENTS.md)
