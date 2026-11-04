---
type: object-type
title: AUTH — 授权字段（SU20 Authorization Field）
description: AUTH 对象的路由、本地 auth-v1 文档（上游 AFF + 两个 SU20 字段）、名称/文件名规则、写入语义、删除保护与真机证据
tags: [abap-cli, object-type, auth, icf, abap-file-format, su20, authorization]
created at: 2026-11-04 01:00:00
changed at: 2026-11-04 01:30:00
---

# AUTH — 授权字段（SU20 Authorization Field）

SU20 维护的授权字段（authorization field）。一个对象就是一张 `AUTHX` 行
（`FIELDNAME` 为主键，CHAR 30）加一条 TADIR 记录（`R3TR AUTH`），属于
client-independent 的自定义数据，没有激活步骤。

`AUTH` 是授权对象族（AUTH / SUSC / SUCU / SUSH / SUSO）的一员：本地一个
JSON 文档，四类操作全部走内置 ICF 服务。

## 路由（单通道 ICF）

**ICF 自建**（`/sap/abap_cli/auth/auth/<name>`）；ADT 与上游 AFF 都没有
可读写的 AUTH 资源。

| method | 作用 | CLI |
|---|---|---|
| `GET` | 读 `AUTHX` 行 + TADIR package → 文档 + 读侧 `name` / `package` | `abap pull <name> --type AUTH` |
| `POST` | 创建（已存在 → `AUTH_ALREADY_EXISTS`） | `abap create AUTH <name> --file ... --package ...` |
| `PUT` | 更新（已存在才可；name 不可变） | `abap push <file>.auth.json` |
| `DELETE` | 删除（先做权限 + where-used 校验） | `abap delete <name> --type AUTH [--tr]` |

`package` / `transportRequest` 作为 query 参数传递：`$` 前缀本地包免 transport，
其余包必须显式 `--tr`。

## 本地文件形态

```
src/
└── <token>.auth.json
```

`<token>` 是 AFF 文件 token：普通名小写（`zcli_tc_auth_x1`），命名空间用括号
形式（`/AIF/SEROB` → `(aif)serob`），其余内部斜杠用本地 `~` 转义
（`ACCGO/SID` → `accgo~sid`）。文档本身不写 `name` / `package`（AUTHX 没有文本
表，AFF header 省略），pull 时读侧字段被剥离。

## `<token>.auth.json` 形状

```json
{
  "formatVersion": "1",
  "generalInformation": {
    "dataElement": "VKORG",
    "searchHelpExit": "",
    "activityField": false
  },
  "alternativeSearchHelp": {
    "checkTable": "TVKO"
  }
}
```

上游 AFF 的 `auth-v1.json` 只建模 `generalInformation.dataElement`（AUTHX-ROLLNAME）
与 `alternativeSearchHelp.checkTable`（CHECKTABLE）；AUTHX 还保存
`EXIT_FB`（搜索帮助出口）与 `ACTVT_FLAG`（活动字段），因此本地
`auth-v1.json` 是**本地扩展**：保留上游属性名，追加
`generalInformation.searchHelpExit` 与 `generalInformation.activityField`。

| 文档路径 | AUTHX | 必填 | 说明 |
|---|---|---|---|
| `formatVersion` | — | ✅ | 固定 `"1"` |
| `generalInformation.dataElement` | `ROLLNAME` | ✅ | 数据元素名（≤30），写入时 SAP 校验 `DD04L` 存在性 |
| `generalInformation.searchHelpExit` | `EXIT_FB` | — | 搜索帮助出口函数模块（≤30），设置时校验存在 |
| `generalInformation.activityField` | `ACTVT_FLAG = 'X'` | — | 布尔；false / 省略 → 空 |
| `alternativeSearchHelp.checkTable` | `CHECKTABLE` | — | 备选搜索帮助检查表（≤30），设置时校验 `DD02L` 存在 |

空的可选字段 pull 时省略、写回时按空值处理，因此 pull → push → pull 稳定。

## 名称 / 文件名 / URL

- CLI 名：大写，`^/?[A-Z0-9_]+(/[A-Z0-9_]+)*$`，长度 1..30（`AUTHX-FIELDNAME` CHAR 30）。
- 命名空间：SAP 里形如 `/NS/NAME` 的名字在文件名中用 AFF `(ns)name`；
  只有一个内部斜杠的名字（参考系统上的 `ACCGO/SID`）用 `~` 转义。
- 非法名（空白、`%`、`.INCLUDE`、超长）→ `AUTH_NAME_INVALID`（exit 7）。
  `.INCLUDE` 是系统伪行、没有 TADIR，不作为可管理对象暴露。
- URL：`/auth/auth/<encodeURIComponent(name)>`，服务端自行 unescape。

## 写入语义（SAP 侧）

- 创建：校验文档与 DDIC 依赖 → `RS_CORR_INSERT` 记录 TADIR / 传输请求 →
  `INSERT AUTHX` → `DB_COMMIT` → `CL_AUTH_TOOLS=>SET_AUTHFLD_INFO_FROM_DB`
  刷新权限字段缓冲，立即对运行时生效。
- 更新：只允许已存在对象；`RS_CORR_INSERT` 重新记录（幂等）→ `MODIFY AUTHX`
  → 刷新缓冲。名称不能改（名称即 URL）。
- 删除：先 `CL_AUTH_TOOLS=>AUTHORITY_CHECK_SUSO( actvt='06' )`（失败 403），
  再 `SUSO_WHERE_USED_AFIELD` 检查引用；被授权对象引用时返回
  `AUTH_DELETE_REFUSED` 并给出引用数，数据与 TADIR 都不动。随后按 transport
  规则删除 AUTHX 行与 TADIR 记录。
- 没有激活步骤：`--no-activate` 被拒绝；描述在文档字段里，`--description` 也被拒绝。

## 命令示例

```bash
# 拉（读标准字段，只读）
abap pull VKORG --type AUTH --json

# 建（$TMP 不需要 --tr）
abap create AUTH ZCLI_TC_AUTH_X1 --package '$TMP' --file src/zcli_tc_auth_x1.auth.json --yes

# 改完推回（只更新已存在对象）
abap push src/zcli_tc_auth_x1.auth.json --yes

# 删（本地包免 --tr；可传输包必须 --tr）
abap delete ZCLI_TC_AUTH_X1 --type AUTH --yes
```

## 已知限制 / 已知坑

- 删除被角色/授权对象引用的字段会被拒绝（`AUTH_DELETE_REFUSED`），需先解除引用。
- `EXIT_FB` 在参考系统上没有已设置的行；映射与校验由单元测试和真实函数模块
  的 CLI 往返覆盖。
- 部分 `AUTHX` 行没有 TADIR 记录（pull 得到 `package:""`）；这类对象无法满足
  transport 规则，pull 可读、写入/删除会要求先有包归属。
- 授权字段的 `.INCLUDE` 系统伪行不是对象，拒绝作为 AUTH 管理。

## 真机证据

参考系统 S/4HANA（SAP_BASIS 757，profile `test`）上的记录
（`tmp/auth-family/evidence/auth.md`）：

- `GET/POST/PUT/DELETE /auth/auth/<name>` 全部打通，`AUTH_ALREADY_EXISTS`（409）、
  `AUTH_NOT_FOUND`（404）、`AUTH_TRANSPORT_REQUIRED` / `AUTH_TRANSPORT_INVALID`（400）、
  `AUTH_DELETE_REFUSED`（where-used，`VKORG` 被 69 个授权对象引用）均按契约返回。
- 真实 CLI 往返（`node dist/index.js`）：`create → pull → push → pull → delete`
  在 `$TMP` 的 `ZCLI_TC_AUTH_CLI1` 上通过，`dataElement`、`searchHelpExit`、
  `activityField` 完整往返，`--dry-run` 不写 SAP，结束后 `AUTHX` / TADIR 无残留。
- 服务端返回 500 `AUTH_*_FAILED` 时带 SAP 原文；写路径无 activation 版本。

# references

- [授权对象族总览 — roadmap](../roadmap.md)
- [对象类型矩阵](../object-types.md)
- [schema 说明（local extension 约定）](../../src/abap_cli/schema/README.md)
- 实现探针与完整命令输出：`tmp/auth-family/evidence/auth.md`（本地证据，不入库）
