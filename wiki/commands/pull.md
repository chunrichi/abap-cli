---
type: command
title: abap pull
description: 从 SAP 下载对象到本地文件 — 支持源码对象、包批量、DDIC JSON、textpool 与远程版本拉取
tags: [abap-cli, command, pull, download, abap-file-format, ddic, textpool, version-management]
created at: 2026-08-06 23:21:15
changed at: 2026-08-07 00:06:29
---

# abap pull

从 SAP 系统下载 ABAP 对象到本地文件，遵循 abap-file-format 布局。支持四类入口：单个源码对象（CLAS/PROG/INTF/FUGR）、包批量下载、DDIC 对象（DOMA/DTEL/TABL/STRU）、textpool 文本元素、以及远程系统版本源码。裸 `abap pull`（无对象名、无 `--package`）打印命令帮助（exit 0）。

## Usage

```bash
abap pull [options] [object-name]

# 裸命令打印帮助
abap pull
```

## Options

- `[object-name]`: 要下载的对象名（如 `ZCL_MY_CLASS`）
- `--type <type>`: 对象类型（CLAS、PROG、INTF、FUGR、DOMA、DTEL、TABL、STRU 等）
- `--package <package>`: 下载某包下的所有对象（分页，默认 limit 20）
- `--limit <n>`: `--package` 的批量页大小（默认 `SEARCH_RESULT_LIMIT`）
- `--page <n>`: `--package` 的批量页码（1 起，默认 1）
- `--dir <path>`: 输出目录（默认 `src/`）
- `--overwrite`: 允许覆盖内容不同的本地文件
- `--skip-existing`: 跳过已存在的本地文件
- `--include-tests`: 包含 testclasses 源码部分
- `--include-all-parts`: 包含所有源码部分（含 testclasses）
- `--textpool`: 同时拉取 textpool `.properties` 文件（`.texts`/`.selections`/`.headings.<lang>.properties`）
- `--remote <remoteid>`: 拉取对象在远程系统的 active 版本源码（Version Management，`/version-source` 端点）

## 路由与布局

按优先级分派四条路线：

1. **`--package`** — `searchObject` 全量搜索 + 按 `adtcore:packageName` 过滤，分页（`limit × page`）逐对象拉取；单对象失败不中断整体（记为 `failed`），截断时提示 `--page N+1`。**分页的原因**：SAP quickSearch 端点的 `maxResults` 有上限（默认 `SEARCH_RESULT_LIMIT` = 20），一次请求拿不全整个包。实现上每次请求 `limit × page` 条结果、按包名过滤后取 `(page-1)*limit` 到 `page*limit` 的窗口——所以 `--limit` 越大单轮拉得越多，`--page` 递增继续拉下一批。单对象 pull（`abap pull ZCL_X`）无分页。
2. **`--remote <id>`** — 走 ICF `/version-source`（TMS RFC destination `TMSADM@<id>.DOMAIN_<id>`）。CLI 类型 → VRSD 类型映射：`PROG → REPS`、`INTF → INTF`、`CLAS → CLSD`（类定义）。源码写入对象标准文件名 `src/<typeFolder>/<name>/<name>.<type>.abap`（顶层目录按类型分类，见下文）。对象从未传输到远端时后端返回空 `source`（成功）。
3. **`--textpool`** — 拉取三个 `.properties` 文件，走混合模式路由（profile 缓存的能力决定走 ADT `getTextElements` 还是 ICF `/textpool/*`），JSON 结果带 `route` 字段（`adt`/`icf`）；文件落在 `src/<typeFolder>/<name>/<name>.<type>.<category>.<lang>.properties`。
4. **DDIC 类型**（DOMA/DTEL/TABL/STRU）— 走 ICF `GET /ddic/<type>/<name>`，`wireToLocal` 转成本地 JSON，写为 `src/<typeFolder>/<name>.<type>.json`（顶层目录按类型分类）。TTYP 等未支持类型抛 `DDIC_NOT_SUPPORTED`。

源码对象（CLAS/PROG/INTF）布局：`<name>.<type>.json` 元数据 + 每个 include part 一个 `.abap`；`--include-all-parts` 控制是否包含 testclasses。FUGR 为多文件布局（`.fugr.json`、`sapl<name>.reps.*`、`l<name>top.reps.*`、每个 FM 一个 `.func.*`）。

### 顶层分类子目录

所有 pull 产物按对象类型落到 `src/<typeFolder>/` 下，`typeFolder` 由 `src/abap_cli/formats/type-folder.ts#folderFor(type)` 决定（小写 abapGit 风格：`clas` / `intf` / `prog` / `fugr` / `tabl` / `doma` / `stru` / `dtel`；未识别类型 → `unknown/`）。这是本地约定（Q5=B），DDIC 原本在 abap-file-format 规范里要求扁平，本仓库统一改为带子目录以保持 8 类对象工作目录整洁，**不保证与严格 abapGit round-trip 兼容**。

写文件前的冲突处理采用**保守拒绝**策略 —— `--overwrite` 与 `--skip-existing` **都不是默认**，默认遇到本地文件与 SAP 内容不同时报错，绝不静默覆盖或丢弃本地未推送的改动：

| 本地文件状态 | 无任何 flag（默认） | `--skip-existing` | `--overwrite` |
|---|---|---|---|
| 文件不存在 | 写入 | 写入 | 写入 |
| 内容与 SAP 一致 | `skipped`（`already matches`） | `skipped` | `skipped` |
| 内容不同 | **抛 `OVERWRITE_REQUIRED`（exit 2）** | `skipped` | 覆盖写入 |

注意差异：源码对象主路由（`pullObject`）会**先比较内容**再决定；DDIC / textpool / `--remote` 路由**不比较内容**，只要文件存在且两个 flag 都没给就直接抛 `OVERWRITE_REQUIRED`。

## Examples

```bash
# 拉取单个类（含所有 include parts）
abap pull ZCL_MY_CLASS

# 指定类型
abap pull ZPROG --type PROG

# 整包批量下载（分页）
abap pull --package Z_MY_PACKAGE --limit 50 --page 1

# 拉取 DDIC 对象为本地 JSON
abap pull ZDOMA_TEST --type DOMA

# 拉取 textpool 文本元素
abap pull ZPROG --textpool

# 覆盖本地不同内容
abap pull ZCL_MY_CLASS --overwrite

# 拉取远程（PRD）系统的 active 版本源码
abap pull ZPROG --remote PRD
abap pull ZCL_DEMO --type CLAS --remote PRD --overwrite
```

## Expected Output

```json
{
  "status": "success",
  "meta": {
    "command": "abap pull",
    "version": "0.1.0",
    "timestamp": "2026-08-06T23:21:15.000Z",
    "durationMs": 42,
    "warnings": []
  },
  "data": {
    "object": "ZPROG",
    "type": "PROG",
    "remote": "PRD",
    "version": "00000",
    "entries": [
      { "file": "src/prog/zprog/zprog.prog.abap", "status": "written" }
    ],
    "written": ["src/prog/zprog/zprog.prog.abap"],
    "skipped": [],
    "failed": []
  }
}
```

`--package` 模式下 `data` 额外含 `package`/`page`/`limit`/`truncated`（截断时含 `hint`）；`--textpool` 模式含 `route`；单对象普通模式含 `object`/`type`/`entries`/`written`/`skipped`/`failed`。

## 与 abap-file-format 规范符合性

对照 `tmp/abap-file-formats/`（官方规范 clone）的 README / json schema / 示例核验（2026-08-06）：

**已符合**：CLAS/PROG/INTF 元数据（`formatVersion: "1"` + `header{description, originalLanguage}`，PROG 额外 `generalInformation.programType`）；文件命名与 subtype 用规范名（`definitions`/`implementations`/`macros`/`testclasses`/`main`）；FUGR `reps.json` 的 `includeType`；FUGR 布局（`sapl<name>.reps.*`、`l<name>top.reps.*`、每 FM 一个 `.func.*`，UXX include 正确跳过）；textpool `.properties` 命名。

**已修复（2026-08-06）**：`<name>.fugr.<fm>.func.json` 缺 `includeNumber`（fugr/func-v1.json required）。现在从 UXX include 源码解析（每行 `INCLUDE L<group>U01.  "<funcname>`），解析不到时回退到 FM 在组内序号（补零两位）。

# More

## fixme

- [ ] **B** — `<name>.fugr.json` 的 `fixPointArithmetic` 是条件写入（fugr-v1.json required）。真实 SAP 返回该字段，但 mock 等缺少该元数据的来源下 pull 出的 fugr.json 缺字段、过不了 schema 校验。建议缺失时默认 `false` 兜底。
- [ ] **C** — DDIC JSON（`.doma.json`/`.dtel.json`/`.tabl.json`/`.stru.json`）是扁平自定义结构（`{name, description, dataType, …}`），不是规范嵌套结构（`{formatVersion, header, format:{dataType,length}, …}`），且 TABL 缺规范要求的 `.tabl.ddic` 技术设置文件。这是 014 配合自建 ICF round-trip 的设计决策，严格讲不符合规范。
- [ ] **D** — `abap create FUGR` 的 create-then-pull 骨架会留一个 `<name>.fugr.abap`（规范无此文件，主程序应为 `sapl<name>.reps.abap`）。属于 create 的既有行为，非 pull 产出。

## todo

- [ ] **pull 未激活版本** — 目前 `abap pull` 只拉取 active 版本源码；对处于未激活（stale，active != latest）状态的对象，增加拉取 latest/inactive 源码的能力（参考 `abap inspect <obj> --activation` 的 `checkActivation`：`getObjectSource(abs)` 取 latest，`raw.getObjectSource(abs, { version: 'active' })` 取 active），让用户在激活前能拿到未激活的改动，可作为 `--activation` 检查后的补救手段。

# references

- 实现：`src/abap_cli/commands/pull.ts`、`src/abap_cli/flows/pull-flow.ts`、`src/abap_cli/formats/pull-strategy.ts`、`pull-fugr.ts`、`fugr-layout.ts`、`src/abap_cli/clients/icf-client.ts`
- SAP 后端：`abap/src/clas/zcl_abap_vibe_icf.clas.abap`（`dispatch_ddic` / `dispatch_textpool` / `dispatch_version_management`）
- 文档：`docs/commands.md`（`abap pull` 一节）；规范参考：`tmp/abap-file-formats/file-formats/{clas,prog,intf,fugr,doma,dtel,tabl}/`
