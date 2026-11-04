---
type: object-type
title: SUSC — 授权对象类（SU21 Authorization Object Class）
description: SUSC 对象的路由、本地 susc-v1 文档（TOBC + TOBCT 单语言文本）、4 字符类名/命名空间文件 token、写入语义、删除保护与真机证据
tags: [abap-cli, object-type, susc, icf, abap-file-format, su21, authorization]
created at: 2026-11-04 01:00:00
changed at: 2026-11-04 01:30:00
---

# SUSC — 授权对象类（SU21 Authorization Object Class）

SU21 的授权对象类（authorization object class）。一个对象是一行 `TOBC`（键
`OCLSS`，CHAR 4）加 0..n 行 `TOBCT` 语言文本（参考系统上一个标准类有 39 种
语言文本），再加一条 TADIR 记录（`R3TR SUSC`）。client-independent，无激活步骤。

上游 SAP abap-file-formats 没有 SUSC 格式（abapGit 只提供 XML），因此本地
`susc-v1.json` 是**本地扩展**，保持 AFF 顶层约定（`formatVersion` + `header`）。

## 路由（单通道 ICF）

| method | 作用 | CLI |
|---|---|---|
| `GET` | 读 `TOBC` + 一条 `TOBCT` 文本 + TADIR package | `abap pull <name> --type SUSC` |
| `POST` | 创建（已存在 → `SUSC_ALREADY_EXISTS`） | `abap create SUSC <name> --file ... --package ...` |
| `PUT` | 更新（已存在才可；类名不可变） | `abap push <file>.susc.json` |
| `DELETE` | 删除（先做 `S_DEVELOP` 权限 + `TOBJ` where-used 校验） | `abap delete <name> --type SUSC [--tr]` |

`package` / `transportRequest` 走 query 参数；`$` 前缀本地包免 transport。

## 本地文件形态

```
src/
└── <token>.susc.json
```

类名 1..4 字符，普通名小写（`APO` → `apo`、`IS-B` → `is-b`、`6VPM` → `6vpm`）；
命名空间形如 `/AGG` → `~agg`。文档只携带**原始语言**的一行 `TOBCT` 文本，
多语言文本留在 SAP（写入只更新文档语言那一行，其他语言不动，与 abapGit 导出器一致）。

## `<token>.susc.json` 形状

```json
{
  "formatVersion": "1",
  "header": {
    "description": "APO Authorization Objects",
    "originalLanguage": "en"
  }
}
```

| 文档路径 | SAP | 必填 | 说明 |
|---|---|---|---|
| `formatVersion` | — | ✅ | 固定 `"1"` |
| `header.description` | `TOBCT-CTEXT` | ✅ | 类文本，≤60（`TOBCT-CTEXT` CHAR 60）；空文本允许 |
| `header.originalLanguage` | `TOBCT-LANGU`（经 `T002` ISO） | ✅ | 两位 ISO 语言码，小写（`en` / `de` / `zh`） |

读取时的语言选择顺序：`TADIR-MASTERLANG` → `sy-langu` → `'E'` → 任意已有文本行；
写入把文档语言写到 `TOBCT` 并同步 `TADIR-MASTERLANG`，保证 pull→push→pull 一致。
空类文本允许（`description: ""`）。

## 名称 / 文件名 / URL

- CLI 名：大写，1..4 字符，普通形式 `^[A-Z0-9][A-Z0-9_-]{0,3}$`（`CV`、`APO`、
  `IS-B`、`6VPM`、`ZT01`）或 4 字符命名空间形式 `^/[A-Z0-9_-]{3}$`（`/AGG`）。
- 非法名（5 字符、空白、`.ABC`、`%`）→ `SUSC_NAME_INVALID`（exit 7）。
- 文件 token：普通名小写，`/XXX` 用 `~xxx`；`nameFromToken` 反向还原。
- URL：`/auth/susc/<encodeURIComponent(name)>`（`/AGG` → `%2FAGG`）。

## 写入语义（SAP 侧）

- 创建：校验类名/文本/语言 →（TADIR 孤儿清理）→ `RS_CORR_INSERT`
  （`object_class='SUSC'`，记录 TADIR + 请求）→ `INSERT TOBC` +
  `MODIFY TOBCT`（文档语言）→ `COMMIT WORK`。
- 更新：`RS_CORR_INSERT` 重新记录（幂等）→ 覆盖 `TOBC` / 文档语言的 `TOBCT`，
  `TADIR-MASTERLANG` 同步为文档语言。
- 删除：`AUTHORITY-CHECK OBJECT 'S_DEVELOP'`（`OBJTYPE='SUSC'`、`ACTVT='06'`）
  → 失败 403 `SUSC_NOT_AUTHORIZED`；`TOBJ` 中仍有授权对象引用该类时返回
  `SUSC_DELETE_REFUSED`（给出引用对象名，不写任何数据）；随后删 `TOBC` /
  `TOBCT`，按 transport 规则删 TADIR。
- 无激活步骤；`--no-activate` / `--description` 被拒绝。

## 命令示例

```bash
abap pull APO --type SUSC --json
abap create SUSC ZT01 --package '$TMP' --file src/zt01.susc.json --yes
abap push src/zt01.susc.json --yes
abap delete ZT01 --type SUSC --yes
```

## 已知限制 / 已知坑

- 文档只维护一种语言；其他语言的 `TOBCT` 文本不会被删除或改写。
- 删除被授权对象引用的类会被拒绝（参考系统 `CV` 被 18 个 `TOBJ` 引用）。
- 参考系统有 5 行 `TOBC` 没有 TADIR 记录（pull 得到 `package:""`）；这类对象写/删
  前先需要包归属。
- 类名上限 4 字符，`ZCLI_TC_SUSC_*` 这种长测试名不可能；测试用 4 字符 `ZTxx`。

## 真机证据

参考系统 S/4HANA（SAP_BASIS 757，profile `test`）（`tmp/auth-family/evidence/susc.md`）：

- `GET/POST/PUT/DELETE /auth/susc/<name>` 全部打通；`SUSC_NOT_FOUND`（404）、
  `SUSC_ALREADY_EXISTS`（409）、`SUSC_DELETE_REFUSED`（`CV` 被 `C_DRAD_OBJ`
  引用）、transport 负数按契约返回。
- 真实 CLI 往返：`create → pull → push → pull → delete` 在 `$TMP` 的 `ZT11`
  上通过；描述 + 原始语言 `en → de` 往返正确（`TOBCT` 保留旧语言行、新增 `D` 行），
  `--dry-run` 不写 SAP，结束后 `TOBC` / `TOBCT` / TADIR 无残留。
- 标准类（`APO`、`/AGG`、`CV`）只读，未做任何写操作。

# references

- [对象类型矩阵](../object-types.md)
- [schema 说明（local extension 约定）](../../src/abap_cli/schema/README.md)
- 实现探针与完整命令输出：`tmp/auth-family/evidence/susc.md`（本地证据，不入库）
