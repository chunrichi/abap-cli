---
type: object-type
title: JOBD — 应用作业定义（Application Job Definition, SM36）
description: JOBD 的 ICF /jobd 端点、本地扩展 jobd-v1 契约、CL_JR_JOB_DEFINITION 持久化与真机证据
tags: [abap-cli, object-type, jobd, application-jobs, sm36, icf, local-extension]
created at: 2026-11-03 23:20:00
changed at: 2026-11-03 23:20:00
---

# JOBD — 应用作业定义（Application Job Definition, SM36）

SM36 的**应用作业定义**（TADIR 对象 `JOBD`）：一个可调度的作业模板，指向要执行的报表/变式并保存时间或事件调度参数。参考 release 上 JOBD **没有 ADT 资源**，上游 AFF 也**没有官方 schema**，所以本 CLI 用本地扩展格式 + 自建 ICF 端点实现，配方参考 abapGit 的 JOBD handler（`CL_JR_JOB_DEFINITION` 动态调用）。

## 路由（单通道 ICF）

| 操作 | ICF 端点 |
|---|---|
| create | `POST /sap/abap_cli/jobd/<name>?package=<pkg>[&transportRequest=<tr>]` |
| pull | `GET /sap/abap_cli/jobd/<name>` |
| push | `PUT /sap/abap_cli/jobd/<name>[?transportRequest=<tr>]` |
| delete | `DELETE /sap/abap_cli/jobd/<name>[?transportRequest=<tr>]` |

ABAP 侧（`abap/src/zcl_abap_vibe_icf_jobd.clas.abap`）：

- 读取：`CL_JR_JOB_DEFINITION=>GET_JD_ATTRIBUTES`（`STJR_JOBD_ROOT` + `STJR_JOBD_TREP`），序列化为 camelCase JSON；`package` 从 TADIR 读取。
- 写入：`RS_CORR_INSERT` 记录 TADIR / 传输请求（`$` 本地包免传输）→ 类的 `CREATE_JD` / `MODIFY_JD` 落库 → handler 把写入时临时使用的 `$TMP` 包改回真实包（类的 `HANDLE_TRANSPORT` 会弹请求对话框，plugin 上下文无法执行）。**写入即保存激活**，`--no-activate` 被拒绝。
- 删除：先清 `STJR_JOBD_ROOT` / `STJR_JOBD_TREP`（`CL_JR_JOB_DEFINITION=>DELETE_JD` 同样会走对话框路径），再经 `RS_CORR_INSERT(mode='D')` 删 TADIR 并记录传输；`TR_TADIR_INTERFACE` 在对象数据仍在时拒绝删除 TADIR（TR/692）。
- 不含 `CL_JR_JOB_DEFINITION` 的 release 返回 `JOBD_UNSUPPORTED`（exit 7）。

## 本地文件形态

```
src/
└── zcli_tc_jobd_daily.jobd.json
```

`jobd-v1.json` 是**本地扩展 schema**：镜像 `CL_JR_JOB_DEFINITION=>TY_JOB_DEFINITION`，去掉系统字段（`owner`、`btcjobUser`、`created*`、`changed*`、`isActive`）；`package` 是只读元数据，`create`/`push` 的包来自命令行或现有对象。

```json
{
  "formatVersion": "1",
  "name": "ZCLI_TC_JOBD_DAILY",
  "package": "$TMP",
  "btcjobName": "ZCLI_TC_JOBD_DAILY",
  "isTimeBased": "X",
  "startTime": "06:00:00",
  "recurCode": "D",
  "recurValue": 1,
  "reportName": "WZRE_WBRK_AGING",
  "variantName": ""
}
```

字段取值：CHAR1 指示符是 `""` / `"X"`；`passClient` / `sysTimezoneIndicator` / `localDeact` / `localCust` 是 JSON 布尔；`startTime` 用 ISO 记法 `HH:MM:SS`；NUMC 字段是整数。名称上限 **32 字符**（`JR_JDNAME`）。

## 命令示例

```bash
# 拉取已有定义（可传输包也可以，只读）
abap pull SAP_LOAB_AGING_WZRE_WBRK --type JOBD --json

# 创建到本地包（无需传输）
abap create JOBD ZCLI_TC_JOBD_DAILY --file src/zcli_tc_jobd_daily.jobd.json --package '$TMP' --yes --json

# 修改后推回
abap push src/zcli_tc_jobd_daily.jobd.json --yes --json

# 删除（可传输包要 --tr）
abap delete ZCLI_TC_JOBD_DAILY --type JOBD --yes --json
abap delete ZCLI_TC_JOBD_TRANSP --type JOBD --tr NDK900123 --yes --json
```

## 已知坑

- **没有 ADT 端点**：不要指望 `abap pull` 走 ADT；必须先 `abap deploy` 安装 ICF 服务（`abap deploy status`）。
- **写入即激活**：和 SAJC/SAJT 一样，`--no-activate` 会被拒绝；没有 inactive 版本可操作。
- **可传输包必须 `--tr`**：create/push/delete 都会把对象记录进请求；没有请求时 CLI 在本地就报 `JOBD_TRANSPORT_REQUIRED`（exit 7），不会先写 SAP。`$` 前缀本地包一律免传输。
- **创建时包名短暂使用 `$TMP`**：类的 transport 路径弹对话框，handler 用 `$TMP` 分支落库后立刻把 `STJR_JOBD_ROOT-JDPACKAGE` 改回真实包；删除时先清数据再删 TADIR（TR/692 约束）。
- **报表/变式由 SAP 在运行时校验**：定义本身可以指向不存在的报表，实际调度才会报错；CLI 不做引用校验。
- **可传输 delete 的 CTS 删除条目**：ICF 插件无法写 CTS 删除条目，delete 会清空对象数据与 TADIR，但请求里仍保留该对象原先的 insert 条目（`E071-OBJFUNC` 为空）。发布前请在 SE01/SE03 删除该条目，或改用 SE01 维护删除；本地包（`$`）无此问题。
- **部署后的类装载缓存**：`abap deploy` 后 ICF handler 的新版本可能在 10–20 秒内未全部生效，期间可能返回 `unknown path: /jobd/...`；重试即可。
- **release 差异**：只有存在 `CL_JR_JOB_DEFINITION` 的 release 可用；老 release 返回 `JOBD_UNSUPPORTED`。

## 真机证据

`tests/261103007-jobd/`（本地，不入库）：`$TMP` 与 `ZTEST` 可传输包两种路径的 create → pull → push → pull → delete 全部通过；TADIR / E071 / STJR 表清理后无残留；`--no-activate`、缺 `--tr`、超长名称、未知对象、重复创建等错误路径均返回预期 exit code。
