---
type: command
title: abap create
description: 在 SAP 创建新对象并激活 — 源对象（CLAS/INTF/PROG/FUGR，ADT REST）与 DDIC（DOMA/DTEL/TABL/STRU，--file 走 ICF）；--no-activate / --template / --no-pull / --check-only / --audit；--schema 提供 agent 参数自省；create local 为离线草稿
tags: [abap-cli, command, create, clas, intf, prog, fugr, doma, dtel, tabl, stru, ddic, icf, template, schema]
created at: 2026-08-07 00:00:00
changed at: 2026-08-07 00:00:00
---

# abap create

在 SAP 中创建新 ABAP 对象并激活。源对象（`CLAS`/`INTF`/`PROG`/`FUGR`）走 ADT REST API；DDIC 对象（`DOMA`/`DTEL`/`TABL`/`STRU`）走自建 ICF 服务（014，需 `--file`）。创建后默认 create-then-pull 写本地副本。拒绝覆盖已存在对象（`OBJECT_EXISTS`）。

## Usage

```bash
abap create [options] <type> <name>
abap create local <type> <name> [options]     # 实验性：本地草稿，不连 SAP
abap create --schema [type]                    # agent 参数自省，不连 SAP
```

## Options

- `<type>`: 对象类型 `CLAS` / `INTF` / `PROG` / `FUGR`；DDIC 类型 `DOMA` / `DTEL` / `TABL` / `STRU`（须配 `--file`）；其余类型 → `TYPE_NOT_SUPPORTED`，`TTYP` → `DDIC_NOT_SUPPORTED`
- `<name>`: 对象名（自动转大写；命名空间名如 `/UI2/CL_JSON` 映射为 `#` 转义目录）
- `--package <package>`: 目标 SAP 包（必填）
- `--description <desc>`: 对象描述（必填；有 `--file` 时可选，由 JSON 提供）
- `--tr <transport>`: 传输请求号；缺省时 `resolveTransport` 解析（非 `$TMP` 包下 DDIC 必须显式给出）
- `--no-activate`: 创建并写 skeleton 但不激活
- `--template <template>`: skeleton 模板（`minimal` / `public-method` / `report` / `selection-screen`…）；未知模板 → `INVALID_ARGUMENT`
- `--no-pull`: 跳过 create-then-pull 本地副本（默认拉取）
- `--check-only`: 只校验对象可行性（`validateNewObject`），不创建
- `--audit`: 额外一次 SAP 往返记录 before-checksum（默认关）
- `--file <path>`: 014 — abap-file-format DDIC JSON 输入（`DOMA`/`DTEL`/`TABL`/`STRU` 必填）
- `--schema`: 打印参数 schema 为 JSON 并退出（无 SAP 调用；`<type>`/`<name>` 可不传）

### `create local` 专属

- `<type>` / `<name>`: 同主命令（不支持 DDIC）
- `--template <template>`: skeleton 模板
- `--dir <path>`: 输出目录（默认 `src/`）

## 行为规则

- **三条路由**：源对象 → ADT REST `createObject`；DDIC（`--file`）→ ICF `POST /sap/zabap_vibe/ddic/<type>`；`local` → 仅写本地文件（零 SAP 调用、不读凭据）
- **防覆盖**：创建前 `assertNotExists`；已存在 → `OBJECT_EXISTS`（不覆盖）
- **创建即激活**：复用 push 流程（lock → 写 skeleton → activate → unlock）；`--no-activate` 跳过激活
- **FUGR 与源对象的差异**：新 FUGR 用 `objectStructure` 取 parts（立即可读）；CLAS/INTF/PROG 对新建对象 objectStructure 有就绪延迟（真机 "wrong input data"），回退到稳定 `<objectUrl>/source/main`
- **DDIC 客户端校验**（快失败，零 SAP 往返）：命名空间（Z/Y/slash）与必需字段 → `VALIDATION_ERROR`；非 `$TMP` 包必须 `--tr`
- **CLI flag 覆盖文件值**：`--description` / `--package` / `--tr` 优先于 `--file` JSON 内字段；`--description` 覆盖 `header.description`
- **`--check-only` 仅源对象**：DDIC 路由不接受（走 `--file` 校验）
- **create-then-pull**：成功后把激活后的源码写回 `src/<obj>/<obj>.<type>.abap`（`--no-pull` 关闭）
- **`create local` 落库路径**：本地草稿 → `abap create <type> <name> --package <pkg> --description <desc> --no-pull` → `abap push src/<obj>/<obj>.<type>.abap --tr <transport>`（帮助文本中给出）

## Examples

```bash
# 创建并激活一个类（默认骨架 + create-then-pull 写本地副本）
abap create CLAS ZCL_MY_CLASS --package ZPKG --description "My class"

# 带模板 + 不激活 + 不拉本地副本
abap create PROG ZREPORT --package $TMP --description "Report" --template report --no-activate --no-pull

# 只校验不创建
abap create CLAS ZCL_VALIDATE --package ZPKG --description "check" --check-only

# DDIC：从 abap-file-format JSON 创建数据元素（$TMP 免 transport）
abap create DTEL ZDTEL_NAME --file src/dtel/zdtel_name.dtel.json --package $TMP

# DDIC：非 $TMP 包必须给 transport
abap create DOMA ZDOMA_CODE --file src/doma/zdoma_code.doma.json --package ZPKG --tr A4HK900116

# agent 自省：通用 schema 与类型维度
abap create --schema
abap create --schema CLAS

# 本地草稿（不连 SAP）
abap create local CLAS ZCL_DRAFT --template public-method --dir src/
```

## Expected Output

成功（源对象，默认激活 + 拉本地副本）：

```json
{
  "status": "success",
  "meta": { "command": "abap create", "version": "0.2.0", "timestamp": "2026-08-07T00:00:00.000Z", "durationMs": 1200, "warnings": [] },
  "data": {
    "object": "ZCL_MY_CLASS",
    "type": "CLAS",
    "package": "ZPKG",
    "description": "My class",
    "transport": "A4HK900116",
    "activated": true,
    "template": null,
    "localFile": "src/clas/zcl_my_class/zcl_my_class.clas.abap"
  }
}
```

成功（DDIC 走 ICF，014）：

```json
{
  "status": "success",
  "meta": { "command": "abap create", "version": "0.2.0", "timestamp": "2026-08-07T00:00:00.000Z", "durationMs": 900, "warnings": [] },
  "data": {
    "object": "ZDOMA_CODE",
    "type": "DOMA",
    "action": "created",
    "file": "src/doma/zdoma_code.doma.json"
  }
}
```

成功（`create local`，实验性）：

```json
{
  "status": "success",
  "meta": { "command": "abap create local", "version": "0.2.0", "timestamp": "2026-08-07T00:00:00.000Z", "durationMs": 20, "warnings": [] },
  "data": {
    "object": "ZCL_DRAFT",
    "type": "CLAS",
    "template": "public-method",
    "file": "src/clas/zcl_draft/zcl_draft.clas.abap",
    "experimental": true
  }
}
```

成功（`--schema`，无 SAP 调用）：

```json
{
  "status": "success",
  "meta": { "command": "abap create", "version": "0.2.0", "timestamp": "2026-08-07T00:00:00.000Z", "durationMs": 84, "warnings": [] },
  "data": {
    "schemaVersion": 1,
    "command": "create",
    "description": "Create a new ABAP source object (CLAS, INTF, PROG, FUGR) and activate it",
    "usage": "abap create <type> <name> [options]",
    "arguments": [
      { "name": "type", "required": true, "description": "Object type", "allowedValues": ["CLAS", "INTF", "PROG", "FUGR"] },
      { "name": "name", "required": true, "description": "Object name" }
    ],
    "options": [
      { "name": "--package", "type": "string", "valuePlaceholder": "<package>", "required": true, "description": "Target SAP package (required)" },
      { "name": "--description", "type": "string", "valuePlaceholder": "<desc>", "required": true, "description": "Object description (required)" },
      { "name": "--tr", "type": "string", "valuePlaceholder": "<transport>", "description": "Transport number" },
      { "name": "--no-activate", "type": "boolean", "description": "Create the object but do not activate it" },
      { "name": "--template", "type": "string", "valuePlaceholder": "<template>", "description": "Skeleton template" },
      { "name": "--no-pull", "type": "boolean", "description": "Skip the create-then-pull local copy (default: pull after create)" },
      { "name": "--check-only", "type": "boolean", "description": "Validate the proposed object without creating it" },
      { "name": "--audit", "type": "boolean", "description": "Include the before-checksum (extra SAP round-trip, off by default)" }
    ],
    "globalOptions": ["--json", ""],
    "examples": ["abap create CLAS ZCL_MY_CLASS --package ZPKG --description \"desc\""]
  }
}
```

失败时（对象已存在）：

```json
{
  "status": "error",
  "meta": { "command": "abap create", "version": "0.2.0", "timestamp": "2026-08-07T00:00:00.000Z", "durationMs": 300, "warnings": [] },
  "error": {
    "code": "OBJECT_EXISTS",
    "category": "OBJECT_EXISTS",
    "message": "Object ZCL_MY_CLASS already exists",
    "details": { "object": "ZCL_MY_CLASS" }
  }
}
```

# More

## fixme

- [ ] `--audit` 的 before-checksum 实现是 `String(before.length)` 的源长度，并非真正的校验和（roadmap §1.2 待补）

## todo

- [ ] 014 延后：`TTYP` 类型尚不支持（`DDIC_NOT_SUPPORTED`），待 ICF 服务支持后放开
- [ ] `create local` 为实验性命令，待与 `create` 主流程的落库闭环稳定后转正

# references

- 实现：`src/abap_cli/commands/create.ts`、`src/abap_cli/flows/create-flow.ts`、`src/abap_cli/flows/create-types.ts`、`src/abap_cli/flows/create-schema.ts`、`src/abap_cli/formats/templates.ts`、`src/abap_cli/dictionary/ddic-json.ts`
- 文档：`docs/commands.md`（`## abap create` 章节）
- 设计：`specs/005-create-command/`、`specs/011-create-local/`、`specs/014-ddic-crud-textpool/`
