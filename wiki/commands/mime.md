---
type: command
title: abap mime
description: 创建、删除、上传 MIME Repository 资源（SAP SE80 MIME 存储库；走自建 ICF handler `dispatch_mime`）
tags: [abap-cli, command, mime, mime-repository, icf, se80]
created at: 2026-09-03 17:00:00
changed at: 2026-09-03 17:00:00
---

# abap mime

管理 SAP MIME Repository（SE80 MIME 存储库）中的资源——目录与文件。命令通过自建 ICF handler `dispatch_mime` 与 SAP 对接；底层调用 `CL_MIME_REPOSITORY_API`（SE80 MIME 存储库 API，本 S/4HANA 2023 release 无 `SCMS_*` 函数模块）。所有子命令支持 `--dry-run`（仅打印计划、不调 SAP）与 `--yes`（非 TTY 必填）。

> 与 `abap extension` 不同：`extension` 管理内置 ICF ABAP handler 的部署/状态；`mime` 是面向终端用户 MIME 资源的 CRUD。

## 子命令总览

| 子命令 | 用途 | 端点 |
|---|---|---|
| `mime create <path>` | 建 root 或嵌套目录 | `POST /mime/folder` |
| `mime delete <path>` | 删目录（非空须 `--recursive`） | `PUT /mime/folder?recursive=&transport=` |
| `mime push <local>` | 上传本地文件/目录到指定 MIME 根 | `POST /mime/resources`（每文件一次） |

## Usage

```bash
abap mime create <path> [--package <pkg>] [--description <text>] [--tr <request>] [--dry-run] [--yes]
abap mime delete <path> [--recursive] [--tr <request>] [--dry-run] [--yes]
abap mime push <local> --root <mime-path> [--tr <request>] [--dry-run] [--yes]
abap mime --schema   # 参数自省，无 SAP 调用
```

## Options

### `mime create <path>`

- `<path>`：MIME 路径，必须以 `/` 开头（例：`/zntf_ui/assets`）；不允许 `..` 或尾部 `/`
- `--package <pkg>`：根目录的 devclass，默认 `$TMP`
- `--description <text>`：目录描述
- `--tr <request>`：transport request（不传则用工作区 `.abap.json::transport`，`$TMP` 下无效）
- `--dry-run`：打印 `{dryRun, action, path, package, description, transport}` 不调 SAP
- `--yes`：非 TTY 必填，确认写操作

### `mime delete <path>`

- `<path>`：MIME 路径，约束同 create
- `--recursive`：删非空目录时必填；非空目录无此 flag → `OBJECT_NOT_EMPTY`
- `--tr <request>`：transport request
- `--dry-run`：打印计划
- `--yes`：非 TTY 必填

### `mime push <local>`

- `<local>`：本地文件或目录路径（相对 cwd 或绝对）
- `--root <mime-path>`：**必填**，目标 MIME 根（绝对路径）；不存在时第一文件上传报 `NOT_FOUND`
- `--tr <request>`：transport request（推荐传，否则单文件多次独立提交）
- `--dry-run`：打印 `{fileCount, plan: [...]}`（最多 20 项）
- `--yes`：非 TTY 必填

## Examples

```bash
# 建嵌套目录
abap mime create /zntf_ui/assets --package '$TMP' --description 'UI assets' --yes

# 干跑查看计划
abap mime create /zntf_ui/icons --package '$TMP' --dry-run

# 上传本地目录到现有 MIME 根
abap mime push ./dist/icons --root /zntf_ui/icons --yes

# 上传单文件
abap mime push ./favicon.ico --root /zntf_ui/icons --yes

# 删非空目录
abap mime delete /zntf_ui/icons --recursive --yes

# 自省参数契约（无 SAP 调用）
abap mime --schema
```

## Expected Output

### `mime create /zntf_ui/assets` 成功

```json
{
  "status": "success",
  "meta": { "command": "abap mime create", "version": "0.2.3" },
  "data": {
    "path": "/zntf_ui/assets",
    "kind": "folder",
    "action": "created"
  }
}
```

人类模式：`Created MIME folder /zntf_ui/assets`

### `mime push` 成功

```json
{
  "status": "success",
  "meta": { "command": "abap mime push", "version": "0.2.3" },
  "data": {
    "root": "/zntf_ui/icons",
    "uploaded": 12,
    "files": ["dist/icons/foo.svg", "dist/icons/bar.svg", ...]
  }
}
```

### `mime push` 部分失败

任意文件失败 → `SAP_ERROR/exit 6`，`data` 含 `details.succeeded` + `details.failed[]`（每项 `{path, code, message}`）。

### `--dry-run`

```json
{
  "status": "success",
  "meta": { "command": "abap mime create", "version": "0.2.3" },
  "data": {
    "dryRun": true,
    "action": "create",
    "path": "/zntf_ui/icons",
    "package": "$TMP",
    "description": null,
    "transport": null
  }
}
```

## 关键错误码

| 错误 | 类别 / exit | 触发条件 | 恢复 |
|---|---|---|---|
| `INVALID_ARGUMENT` | USAGE / 2 | MIME path 不以 `/` 开头、含 `..`、尾部 `/`；`mime push` 缺 `--root`；`--package`/`--limit` 越界 | 修正参数（见 `example`） |
| `USAGE` | USAGE / 2 | `mime push <local>` 无文件可读（路径既不是文件也不是目录） | 确认 `local` 是有效路径 |
| `VALIDATION_ERROR` | VALIDATION_ERROR / 4 | 非 TTY 未传 `--yes` | 加 `--yes` 或 `--dry-run` |
| `CONFIG_ERROR` | CONFIG_ERROR / 3 | 未配置 SAP profile 或 `.abap.json` | `abap init` 或 `abap profile add` |
| `AUTH_ERROR` | AUTH_ERROR / 5 | SAP 401/403 | `abap doctor` 检查凭据与 mTLS |
| `NOT_FOUND` | NOT_FOUND / 8 | MIME 路径在 SAP 上不存在（如 `push` 的 `--root` 未建） | 先 `mime create <root>`，再 `push` |
| `OBJECT_EXISTS` | USAGE / 9 | `mime create` 路径已存在 | 用 `delete --recursive` 先清，或换路径 |
| `OBJECT_NOT_EMPTY` | USAGE / 9 | `mime delete` 非空目录缺 `--recursive` | 加 `--recursive` |
| `SAP_ERROR` | SAP_ERROR / 6 | ICF `dispatch_mime` 5xx；任意 `mime push` 文件上传失败（部分或全部） | `abap doctor`；`data.details.failed[]` 看具体路径与 SAP 错误码 |

## 关联命令

- **`abap extension`**：管理内置 ICF handler（含 `dispatch_mime`）的部署/状态。`mime` 子命令可用前提是 `extension status` 报告版本 ≥ 0.6.0（`dispatch_mime` 端点在该版本启用）
- **`abap search`**：MIME 资源不进 SAP 对象索引，需直接走 `mime` CRUD
- **`abap doctor`**：ICF 端点不可达或 401/403 时排查

## 实现要点

- **不走 ADT**：所有子命令走自建 ICF `/sap/zabap_vibe/mime/...`，端点契约见 `abap/src/zcl_abap_vibe_icf` 内 `dispatch_mime`
- **不走 `SCMS_*`**：本 S/4HANA 2023 release 的 `SCMS_AO_STATUS`/`SCMS_R_CREATE_FOLDER` 函数模块不可用，统一通过 `CL_MIME_REPOSITORY_API`
- **错误信封**：handler 把 SAP `CL_MIME_REPOSITORY_API` 的 `cx_mime_repository` 异常归一化为 `{code, message, details}`，映射 `INVALID_ARGUMENT` 400 / `NOT_FOUND` 404 / `OBJECT_EXISTS` 409 / `OBJECT_NOT_EMPTY` 409 / `VALIDATION_ERROR` 422 / 其余 500
- **批量推送**：每个文件一次 POST（不走事务 wrapper，除非传 `--tr`；handler 端 SAP 内部逐文件独立 commit）
- **路径校验**：`validateMimePath()` 在 CLI 端先校验（必须 `/` 开头、无 `..`、无尾部 `/`），失败 → `INVALID_ARGUMENT` 不调 SAP
- **确认门**：`requireWriteConfirmation('abap mime <sub>', opts, example)` 统一管理非 TTY 的 `--yes` 校验，`--dry-run` 永远豁免
- **wire 形状**：
  - create：`POST /mime/folder` body = `{path, package, description, transportRequest}` → `{path, kind, action}`
  - delete：`PUT /mime/folder?recursive=<bool>&transport=<tr>` body = `{path}` → `{path, action}`
  - push：`POST /mime/resources` body = `{path, contentBase64, transportRequest}` → `{path}`，每文件独立 POST

# references

- 真实 SAP 验证（S/4HANA 2023 FPS02 on-prem）`dispatch_mime` 三端点：`POST /mime/folder` / `PUT /mime/folder?recursive=...` / `POST /mime/resources`，handler 期望版本 0.6.0
- ABAP 侧：自建 ICF handler `ZCL_ABAP_VIBE_ICF`，method `dispatch_mime` 在 0.6.0 加入；`CL_MIME_REPOSITORY_API` 为 SAP 标准 MIME 存储库 API（`SCMS_*` 在本 release 不可用）
- 设计决策：走自建 ICF 而非 `MWBTO_*`/`SCMS_*`，原因见 `wiki/architecture-diagrams.md`「自建 ICF」分节
- 验证脚本：`tests/260808001-abap-select-real-sap/`（同套 ICF 测试基础设施）