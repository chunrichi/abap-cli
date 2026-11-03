---
type: command
title: abap unpublish
description: 取消发布服务绑定（SRVB）的本地 OData endpoint — 触发 ADT unpublish job
tags: [abap-cli, command, unpublish, srvb, odata, adt]
created at: 2026-11-03 21:35:00
changed at: 2026-11-03 21:35:00
---

# abap unpublish

取消发布一个**服务绑定（SRVB）**的本地 OData endpoint。命令入口在 `commands/publish.ts`（`registerUnpublishCommand`），与 `abap publish` 共用 `flows/edit/publish-srvb.ts`。

## Usage

```bash
abap unpublish <object-name> [options]
```

## Options

- `<object-name>`: **服务绑定名**（如 `ZUI_MY_SERVICE`），大小写不敏感
- `--schema`: 打印本命令参数 schema（无 SAP 调用）

## 执行流程

1. 读取绑定元数据并解析 service version / binding version（同 `abap publish`）
2. 按 binding version 选择 `odatav2` / `odatav4` 的 `unpublishjobs` 端点，`POST` objectReference
3. 解析 `asx:abap` 状态，`SEVERITY != OK` 报 `SAP_ERROR`
4. 输出 `{object, type:"SRVB", action:"unpublished", channel:"adt", serviceVersion, bindingVersion, published:false, status}`

对**未发布**的绑定重复执行是幂等的：SAP 返回 OK（"un-published locally"），命令照常成功。

## Examples

```bash
abap unpublish ZUI_MY_SERVICE --json
```

取消发布 `ZUI_MY_SERVICE`（幂等，可重复执行）：

```bash
abap pull ZUI_MY_SERVICE --type SRVB --dir src --overwrite
grep published src/zui_my_service.srvb.json 2>/dev/null || abap pull ZUI_MY_SERVICE --type SRVB --dir src --overwrite
```

`--schema` 可离线查看参数：

```bash
abap unpublish --schema --json
```

## gotcha

- unpublish 只关闭本地 endpoint，不删除绑定，也不影响已发布到其他系统的 endpoint。
- 取消发布后再 publish 会重新激活本地 endpoint（实测可用）。
- 版本参数由元数据推导，命令没有 `--version` 选项；绑定元数据缺版本时报 `VALIDATION_ERROR`。

## 真机证据

S/4HANA profile `test`（2026-11-03）：`ZCLI_PUB_SB` unpublish 返回 `severity=OK`，`srvb:published` 变为 false；再次 unpublish 幂等成功；随后 publish 可恢复 true。证据：`tests/261103006-srvb-publish/`。
