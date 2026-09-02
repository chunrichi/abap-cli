---
type: command
title: abap create
description: 在 SAP 创建新对象并激活 — 源对象（CLAS/INTF/PROG/FUGR，ADT REST）与 DDIC（DOMA/DTEL/TABL/STRU，--file 走 ICF）；FUGR 配 --func 可在既有函数组内新建函数模块（FUGR/FF）；--no-activate / --template / --no-pull / --check-only / --audit；--schema 提供 agent 参数自省；create local 为离线草稿
tags: [abap-cli, command, create, clas, intf, prog, fugr, fugr-ff, doma, dtel, tabl, stru, ddic, icf, template, schema]
created at: 2026-08-07 00:00:00
changed at: 2026-09-02 00:00:00
---

# abap create

在 SAP 中创建新 ABAP 对象并激活。源对象（`CLAS`/`INTF`/`PROG`/`FUGR`）走 ADT REST API；DDIC 对象（`DOMA`/`DTEL`/`TABL`/`STRU`）走自建 ICF 服务（014，需 `--file`）。创建后默认 create-then-pull 写本地副本。拒绝覆盖已存在对象（`OBJECT_EXISTS`）。

`FUGR` 类型有两种形态：`abap create FUGR <group>` 新建**函数组**；`abap create FUGR <group> --func <module>` 在**既有函数组内新建函数模块**（`FUGR/FF`，ADT `POST /sap/bc/adt/functions/groups/<group>/fmodules`）。后者的 `<name>` 是组名，须已存在于 SAP。

## Usage

```bash
abap create [options] <type> <name>
abap create FUGR <group> --func <module> [options]   # 在既有函数组内新建函数模块
abap create local <type> <name> [options]     # 实验性：本地草稿，不连 SAP
abap create --schema [type]                    # agent 参数自省，不连 SAP
```

## Options

- `<type>`: 对象类型 `CLAS` / `INTF` / `PROG` / `FUGR`；DDIC 类型 `DOMA` / `DTEL` / `TABL` / `STRU`（须配 `--file`）；其余类型 → `TYPE_NOT_SUPPORTED`，`TTYP` → `DDIC_NOT_SUPPORTED`
- `<name>`: 对象名（自动转大写；命名空间名如 `/UI2/CL_JSON` 映射为 `#` 转义目录）。本地预校验：≤30 字符、仅 `A-Z 0-9 _`、命名空间形如 `/NS/NAME`（NS ≤10，总长 ≤30），违规 → `VALIDATION_ERROR`（exit 7）
- `--package <package>`: 目标 SAP 包（必填）
- `--description <desc>`: 对象描述（必填；有 `--file` 时可选，由 JSON 提供）
- `--tr <transport>`: 传输请求号；缺省时 `resolveTransport` 解析（非 `$TMP` 包下 DDIC 必须显式给出）
- `--no-activate`: 创建并写 skeleton 但不激活
- `--template <template>`: skeleton 模板（`minimal` / `public-method` / `report` / `selection-screen`…）；未知模板 → `INVALID_ARGUMENT`
- `--no-pull`: 跳过 create-then-pull 本地副本（默认拉取）
- `--check-only`: 只校验对象可行性（`validateNewObject`），不创建
- `--audit`: 额外一次 SAP 往返记录 before-checksum（默认关）
- `--file <path>`: 014 — abap-file-format DDIC 输入（`DOMA`/`DTEL`/`TABL`/`STRU` 必填）。TABL/STRU 是三件套：`--file` 指向 main `.tabl.json`，CLI 自动读同目录 `.tabl.ddic`（DDL 源）与 `.tabl.settings.json`；只有 main JSON 时回落 legacy wire-flat 单文件（顶层 `name` / `fields[]`）。DDL 解析失败 → `TABL_DDL_INVALID`（exit 7）
- `--func <module>`: 仅 `FUGR` 类型可用 — 在**既有函数组 `<name>`** 内新建函数模块（`FUGR/FF` 子对象）。组不存在 → `OBJECT_NOT_FOUND`（exit 8，附建组指引）；组内同名模块已存在 → `OBJECT_EXISTS`（exit 2）；模块名同样过本地预校验（≤30、`A-Z 0-9 _`）。`--check-only` 不支持该形态
- `--schema`: 打印参数 schema 为 JSON 并退出（无 SAP 调用；`<type>`/`<name>` 可不传）
- `--yes`: 非交互确认写操作；非 TTY 且无 `--yes` → `VALIDATION_ERROR`（exit 7）。`create` 本身暂无 `--dry-run` flag（014 走的是 `--check-only`），但 `requireWriteConfirmation` 仍识别 `dryRun` 字段作为 future flag 占位

### `create local` 专属

- `<type>` / `<name>`: 同主命令（不支持 DDIC）
- `--template <template>`: skeleton 模板
- `--dir <path>`: 输出目录（默认 `src/`）

## 行为规则

- **三条路由**：源对象 → ADT REST `createObject`；DDIC（`--file`）→ ICF `POST /sap/zabap_vibe/ddic/<type>`；`local` → 仅写本地文件（零 SAP 调用、不读凭据）
- **本地名称预校验**（快失败，零 SAP 往返，先于任何路由/`assertNotExists`）：所有带 `<name>` 的入口（源对象 / DDIC `--file` / HTTP / TRAN / `--check-only` / `create local`）先校验规范化（大写）后的名字——≤30 字符，仅 `A-Z 0-9 _`；命名空间形如 `/NS/NAME`（NS ≤10 且仅 `A-Z 0-9 _`，含斜杠总长 ≤30）；空名同样拒绝。**不强制 Z/Y 前缀**（`$TMP` 接受 `A123`）。违规 → `VALIDATION_ERROR`（exit 7），避免超长/非法名拨号 SAP 后报误导性的 `OBJECT_NOT_FOUND`；与 DDIC 客户端命名校验（exit 7）保持一致
- **防覆盖**：创建前 `assertNotExists`；已存在 → `OBJECT_EXISTS`（不覆盖）
- **创建即激活**：复用 push 流程（lock → 写 skeleton → activate → unlock）；`--no-activate` 跳过激活
- **FUGR 与源对象的差异**：新 FUGR 用 `objectStructure` 取 parts（立即可读）；CLAS/INTF/PROG 对新建对象 objectStructure 有就绪延迟（真机 "wrong input data"），回退到稳定 `<objectUrl>/source/main`
- **FUGR/FF（组内建函数模块）**：`--func` 形态不改组、只建模块。组须先存在（`resolveObject` 校验）；模块经 `createObject({objtype:'FUGR/FF', parentName:<group>, parentPath:<group URL>})` 打到 `/sap/bc/adt/functions/groups/<group>/fmodules`（abap-adt-api objectcreator 内建类型，真机 $TMP 下直接产出激活态模块）；随后按 `--no-activate` 决定是否显式 activate。create-then-pull 只补写 `src/fugr/<group>/<group>.fugr.<fm>.func.{abap,json}`（`skipExisting`，绝不覆盖用户已编辑的组文件）；`includeNumber`（UXX 编号）由 SAP 创建时自动分配、pull 时从 UXX include 读取（如 FF01→01、FF02→02）
- **DDIC 客户端校验**（快失败，零 SAP 往返）：命名空间（Z/Y/slash）与必需字段 → `VALIDATION_ERROR`；非 `$TMP` 包必须 `--tr`
- **DDIC TABL/STRU 三件套解析**：`readDdicObjectForCreate(filePath, type)` 探测同目录 `.tabl.ddic`（或 `.stru.ddic`）与 `.tabl.settings.json`；三件齐全走 `readTablArtifact`，否则回落 `readDdicJson`（legacy wire-flat）。DDL 解析失败 → `TABL_DDL_INVALID`（exit 7）；main JSON 缺 `header.description` 等必填 → `VALIDATION_ERROR`，`error.example` 字段附 wire-flat 最小模板
- **CLI flag 覆盖文件值**：`--description` / `--package` / `--tr` 优先于 `--file` JSON 内字段；`--description` 覆盖 `header.description`
- **`--check-only` 仅源对象**：DDIC 路由不接受（走 `--file` 校验）
- **create-then-pull**：成功后把激活后的源码写回 `src/<obj>/<obj>.<type>.abap`（`--no-pull` 关闭）
- **`create local` 落库路径**：本地草稿 → `abap create <type> <name> --package <pkg> --description <desc> --no-pull` → `abap push src/<obj>/<obj>.<type>.abap --tr <transport>`（帮助文本中给出）
- **写保护**：非 TTY 必须 `--yes`（或 `--dry-run` 占位），由 `core/confirmation.ts#requireWriteConfirmation` 统一处理，TTY 模式直接执行不提示

## Examples

```bash
# 创建并激活一个类（默认骨架 + create-then-pull 写本地副本）
abap create CLAS ZCL_MY_CLASS --package ZPKG --description "My class" --yes

# 先建函数组，再在组内新建函数模块（FF01/FF02 → UXX 自动编号 01/02）
abap create FUGR ZFG_DEMO --package $TMP --description "demo group" --yes
abap create FUGR ZFG_DEMO --func ZFG_DEMO_FF01 --package $TMP --description "first fm" --yes
# → src/fugr/zfg_demo/zfg_demo.fugr.zfg_demo_ff01.func.abap + .func.json（includeNumber 01）

# 组不存在时报 OBJECT_NOT_FOUND 并提示先建组；组内重名报 OBJECT_EXISTS

# 带模板 + 不激活 + 不拉本地副本
abap create PROG ZREPORT --package $TMP --description "Report" --template report --no-activate --no-pull

# 只校验不创建
abap create CLAS ZCL_VALIDATE --package ZPKG --description "check" --check-only

# DDIC：从 abap-file-format JSON 创建数据元素（$TMP 免 transport）
abap create DTEL ZDTEL_NAME --file src/dtel/zdtel_name.dtel.json --package $TMP

# DDIC：非 $TMP 包必须给 transport
abap create DOMA ZDOMA_CODE --file src/doma/zdoma_code.doma.json --package ZPKG --tr A4HK900116

# DDIC TABL/STRU：abap-file-format 三件套（happy path；--file 指向 main，自动读取 .tabl.ddic + .tabl.settings.json）
abap create TABL ZTODO --file src/tabl/ztodo.tabl.json --package $TMP --yes
# src/tabl/ztodo.tabl.json    — { formatVersion, header.description }
# src/tabl/ztodo.tabl.ddic    — define table ztodo { ... }（DDL 源真值）
# src/tabl/ztodo.tabl.settings.json — generalInformation.{dataClassCategory,sizeCategory}（可选）

# DDIC TABL/STRU：legacy wire-flat 单文件（只有 main JSON，无 .tabl.ddic sidecar）仍可工作
# 顶层 name / description / fields[]；与 014 旧行为一致
abap create TABL ZFLAT --file src/tabl/zflat.tabl.json --package $TMP --yes

# agent 写新表：直接 cp DDL 骨架（5 个场景：透明表 / include / 货币金额 / 数量单位 / STRU）
# 比凭空写 @AbapCatalog.* / @Semantics.* 少踩 90% 坑
cp <skill-dir>/skills/abap-cli-edit/assets/tabl-templates/transparent-key/* src/tabl/ztodo.tabl.{json,ddic,settings.json}
sed -i '' 's/zsample/ztodo/g' src/tabl/ztodo.tabl.{json,ddic,settings.json}
$EDITOR src/tabl/ztodo.tabl.ddic   # 改字段定义
abap create TABL ZTODO --file src/tabl/ztodo.tabl.json --package $TMP --yes

# agent 自省：通用 schema 与类型维度（DDIC 类型带 exampleJson 字段，三件套形态）
abap create --schema
abap create --schema TABL   # schema.exampleJson 含 main / .tabl.ddic / .tabl.settings.json 模板

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

成功（FUGR/FF，组内新建函数模块）：

```json
{
  "status": "success",
  "meta": { "command": "abap create", "version": "0.2.3", "timestamp": "2026-09-02T00:00:00.000Z", "durationMs": 1600, "warnings": [] },
  "data": {
    "object": "ZFG_DEMO_FF01",
    "type": "FUGR/FF",
    "group": "ZFG_DEMO",
    "package": "$TMP",
    "description": "first fm",
    "transport": "",
    "activated": true,
    "localFile": "src/fugr/zfg_demo/zfg_demo.fugr.zfg_demo_ff01.func.abap"
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

- 实现：`src/abap_cli/commands/create.ts`、`src/abap_cli/flows/edit/create.ts`、`src/abap_cli/flows/edit/create-types.ts`、`src/abap_cli/formats/templates.ts`、`src/abap_cli/formats/ddic/json.ts`、`src/abap_cli/types/registry.ts`、`src/abap_cli/core/confirmation.ts`
- 文档：`docs/commands.md`（`## abap create` 章节）
- 设计：见 wiki 顶层 `create-command` / `create-local` / `ddic-crud-textpool` 历史回顾
