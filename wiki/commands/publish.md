---
type: command
title: abap publish
description: 发布服务绑定（SRVB）的本地 OData endpoint — 从绑定元数据推导 service/binding 版本并触发 ADT publish job
tags: [abap-cli, command, publish, srvb, odata, adt]
created at: 2026-11-03 21:35:00
changed at: 2026-11-03 21:35:00
---

# abap publish

发布一个**服务绑定（SRVB）**的本地 OData endpoint。命令入口在 `commands/publish.ts`（`registerPublishCommand`），流程在 `flows/edit/publish-srvb.ts`，ADT job 在 `clients/adt-client.ts` 的 `publishSrvb`。

## 为什么存在

`abap create SRVB --publish` 只在创建时顺带发布一次；已存在的绑定需要**单独**发布/取消发布。publish job 的 URL 需要 `servicename` 与 `serviceversion` 两个参数，而 service version 只有绑定元数据里才有——所以命令先 GET 元数据（`srvb:content@srvb:version`、`srvb:binding@srvb:version`），再按协议选择 `odatav2` / `odatav4` 端点。

## Usage

```bash
abap publish <object-name> [options]
```

## Options

- `<object-name>`: **服务绑定名**（如 `ZUI_MY_SERVICE`），不是本地文件名；大小写不敏感
- `--schema`: 打印本命令参数 schema（unified envelope，无 SAP 调用）

## 执行流程

1. 读取绑定元数据：`GET /sap/bc/adt/businessservices/bindings/<name>`（`application/vnd.sap.adt.businessservices.servicebinding.v2+xml`）
2. 解析 `srvb:services/srvb:content@srvb:version` 与 `srvb:binding@srvb:version`；缺任一版本 → `VALIDATION_ERROR`（提示先 pull/inspect）
3. 由 binding version 选端点：`V2` → `/businessservices/odatav2/publishjobs`，`V4` → `/businessservices/odatav4/publishjobs`
4. `POST` job（body 为 objectReference），状态文档按 `asx:abap` 解析；`SEVERITY != OK` 报 `SAP_ERROR` 并带 `shortText`/`longText`
5. 输出 `{object, type:"SRVB", action:"published", channel:"adt", serviceVersion, bindingVersion, published:true, status, message?}`

job 端点在某些 on-prem release 上只接受 `application/vnd.sap.as+xml` 渲染：首次 406/415 时用 `application/vnd.sap.as+xml; dataname=com.sap.adt.businessservices.<type>.<job>` 重试一次（与 Eclipse ADT 客户端一致）。

## Examples

```bash
abap publish ZUI_MY_SERVICE --json
```

发布 `ZUI_MY_SERVICE` 并查看 `srvb:published` 标志：

```bash
abap pull ZUI_MY_SERVICE --type SRVB --dir src --overwrite
grep published src/zui_my_service.srvb.json 2>/dev/null || abap pull ZUI_MY_SERVICE --type SRVB --dir src --overwrite
```

`--schema` 可离线查看参数：

```bash
abap publish --schema --json
```

## gotcha

- **`services[].name` 必须与绑定名一致**：AFF 里 service name 与绑定名不一致时，create 能成功但 publish 报 `Service Definition is not available`；真实绑定的 service name 都等于绑定名。
- **重复 publish**：同一会话内对已发布绑定再发一次 job，SAP 可能返回 `ZERO object reference is not possible`（500）；每次 CLI 命令是独立会话，实测可重复执行，命令仍按 job 结果报告——不建议在脚本里同一进程重试，重试请在新命令调用里做。
- 发布的是**本地 endpoint**，不写 transport request；跨系统要随绑定本身传输。
- unpublish 对未发布的绑定是幂等的（SAP 返回 OK）。

## 真机证据

S/4HANA profile `test`（2026-11-03）：自建 ODATA V2 绑定 `ZCLI_PUB_SB`（服务定义 `ZCUSTOM_SD`）连续 `publish` → `publish`（新会话）→ `unpublish` → `unpublish` 全部 `severity=OK`；元数据 `srvb:published` 在 true/false 间正确翻转；不存在的绑定返回 `OBJECT_NOT_FOUND`（exit 8）。证据：`tests/261103006-srvb-publish/`。
