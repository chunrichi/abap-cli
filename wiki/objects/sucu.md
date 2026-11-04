---
type: object-type
title: SUCU — 授权组（SU21 Authorization Group / TBRG_AUTH）
description: SUCU 对象的路由、复合键 GROUP~OBJECT 与 40 字符 TADIR 名、本地 sucu-v1 文档、复合文件名、写入/删除语义与真机证据
tags: [abap-cli, object-type, sucu, icf, abap-file-format, su21, authorization, composite-key]
created at: 2026-11-04 01:00:00
changed at: 2026-11-04 01:30:00
---

# SUCU — 授权组（SU21 Authorization Group）

SU21/SM30 的授权组：`TBRG_AUTH`（键 `BRGRU` CHAR 30 + `OBJECT` CHAR 10，
两字段都是键、表只含键字段）加语言相关的 `TBRG_AUTHT` 文本（`BEZEI` CHAR 40）。
TADIR 对象是 `R3TR SUCU <BRGRU padded 30><OBJECT padded 10>`（固定 40 字符），
传输定义来自 `OBJSL`（`TBRG_AUTH key='/&'` 为主表），abapGit 通过
`zcl_abapgit_objects_generic` 的“直接写表 + CTS 记录”路径驱动。

上游 AFF 没有 SUCU 格式（`suco-v1.json` 是另一个 TADIR 类型“授权缺省值变式”），
本地 `sucu-v1.json` 是**本地扩展**。

## 路由（单通道 ICF）

| method | 作用 | CLI |
|---|---|---|
| `GET` | 读 `TBRG_AUTH` 键 + `TBRG_AUTHT` 全部语言文本 + TADIR package | `abap pull '<GROUP>~<OBJECT>' --type SUCU` |
| `POST` | 创建（已存在 → `SUCU_ALREADY_EXISTS`） | `abap create SUCU '<GROUP>~<OBJECT>' --file ... --package ...` |
| `PUT` | 更新（全量替换键与文本行） | `abap push <group>~<object>.sucu.json` |
| `DELETE` | 删除（仅 `$` 前缀本地包；可传输包 → `SUCU_DELETE_UNSUPPORTED`） | `abap delete '<GROUP>~<OBJECT>' --type SUCU --yes` |

## 本地文件形态

```
src/
└── <group>~<object>.sucu.json
```

复合 TADIR 名在本地压成 `<group>~<object>`：group 用 AFF token（命名空间
`/ACCGO/PPMG_CR` → `(accgo)ppm_gr`），object 小写，例如
`cmmfdor~s_tabu_dis.sucu.json`、`(accgo)ppm_gr~s_tabu_dis.sucu.json`。
文件名不含 `.`（通用 AFF 路由按 `.` 切类型后缀），`nameFromToken` 反向还原。

## `<group>~<object>.sucu.json` 形状

```json
{
  "formatVersion": "1",
  "header": {
    "description": "Authorization group for commodity derivative orders",
    "originalLanguage": "en"
  },
  "generalInformation": {
    "authorizationGroup": "CMMFDOR",
    "authorizationObject": "S_TABU_DIS"
  },
  "texts": [
    { "language": "de", "description": "Berechtigungsgruppe für ..." }
  ]
}
```

| 文档路径 | SAP | 必填 | 说明 |
|---|---|---|---|
| `header.description` | `TBRG_AUTHT-BEZEI`（原始语言） | ✅ | ≤40（CHAR 40） |
| `header.originalLanguage` | `TBRG_AUTHT-SPRAS` / `TADIR-MASTERLANG`（经 `T002`） | ✅ | 两位 ISO 语言码，小写 |
| `generalInformation.authorizationGroup` | `TBRG_AUTH-BRGRU` | ✅ | 1..30，`A-Z0-9_/` |
| `generalInformation.authorizationObject` | `TBRG_AUTH-OBJECT` | ✅ | 1..10，`A-Z0-9_/`，必须是已存在的授权对象（`TOBJ` 检查表） |
| `texts[]` | 其他语言的 `TBRG_AUTHT` 行 | — | 语言唯一、不能等于 `originalLanguage`，描述 ≤40 |

URL 里的名字与文档里的两个键必须一致（服务端与 CLI 双向校验）。

## 名称 / 文件名 / URL

- 规范 CLI 名：`<GROUP>~<OBJECT>`（如 `CMMFDOR~S_TABU_DIS`）；也接受原始
  40 字符 padded TADIR 名（`CMMFDOR` + 23 空格 + `S_TABU_DIS`）。
- 单个 `/` **不是**键分隔符（OBJECT 自身可带命名空间），斜杠别名已弃用；
  `SUCU_NAME_INVALID`（exit 7）会在本地拦下。
- group 1..30 字符、object 1..10 字符，均 `A-Z0-9_/`。
- URL：`/auth/sucu/<encodeURIComponent('<GROUP>~<OBJECT>')>`。

## 写入语义（SAP 侧）

- 创建：解析/校验名字与文档 → transport 规则 → 已存在 409 → `RS_CORR_INSERT`
  （`object_class='SUCU'`，写 TADIR + 一条 `E071`）→ `INSERT TBRG_AUTH`（只含键）
  + 全量替换 `TBRG_AUTHT`（原文语言 + `texts[]`）；不写 `E071K`（逻辑对象由
  `OBJSL` 导出）。
- 更新：`RS_CORR_INSERT` 幂等重记录 → 全量替换两张表的数据行。
- 删除：transport 规则先行；**非 `$` 前缀包直接拒绝**（`SUCU_DELETE_UNSUPPORTED`），
  因为 ICF 会话无法记录 CTS 删除项；`$` 本地包删 `TBRG_*` 行 + TADIR 记录。
- 无激活步骤；`--no-activate` / `--description` 被拒绝。

## 命令示例

```bash
# 读标准授权组（只读）
abap pull 'CMMFDOR~S_TABU_DIS' --type SUCU --json

# 建（$TMP）
abap create SUCU 'ZCLI_TC_SUCU_A~S_TABU_DIS' --package '$TMP' \
  --file src/zcli_tc_sucu_a~s_tabu_dis.sucu.json --yes

# 改完推回
abap push src/zcli_tc_sucu_a~s_tabu_dis.sucu.json --yes

# 删（仅 $ 本地包；可传输包在 SU21/SM30 删）
abap delete 'ZCLI_TC_SUCU_A~S_TABU_DIS' --type SUCU --yes
```

## 已知限制 / 已知坑

- `TBRG_AUTH` 是纯键表：更新语义是全量 delete + insert，没有部分更新。
- 可传输包的删除必须走 SU21/SM30/SE10，CLI 会明确拒绝而不是静默丢弃。
- `TADIR-MASTERLANG` 由 `RS_CORR_INSERT`（会话语言）先写，再由 handler 按文档
  语言修正；因此文档 `originalLanguage` 与 SAP 语言始终一致。
- 授权对象的 `OBJECT` 必须已存在（`TOBJ` 检查表），否则 `SUCU_INVALID_PAYLOAD`。

## 真机证据

参考系统 S/4HANA（SAP_BASIS 757，profile `test`）（`tmp/auth-family/evidence/sucu.md`）：

- `GET/POST/PUT/DELETE /auth/sucu/<name>` 全部打通；`SUCU_NAME_INVALID`、
  `SUCU_ALREADY_EXISTS`、`SUCU_TRANSPORT_REQUIRED`、`SUCU_DELETE_UNSUPPORTED`
  等负数按契约返回；命名空间/空格 URL 编码验证通过。
- 真实 CLI 往返：`create → pull → push → pull → delete` 在 `$TMP` 上通过
  （owner 与 Lead 各跑一遍），描述 + 新增 `de` 文本行往返正确；结束后
  `TADIR SUCU` / `TBRG_AUTH` / `TBRG_AUTHT` 无残留。
- 标准授权组 `CMMFDOR~S_TABU_DIS` 只读 pull 验证。

# references

- [对象类型矩阵](../object-types.md)
- [schema 说明（local extension 约定）](../../src/abap_cli/schema/README.md)
- 实现探针、CLI 往返记录与残留检查：`tmp/auth-family/evidence/sucu.md`（本地证据，不入库）
