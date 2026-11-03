---
type: object-type
title: OA2P — OAuth 2.0 Client Profile
description: OAuth 2.0 client profile 的 ICF /oa2p 端点、本地扩展 oa2p-v1 契约、OA2P Workbench 持久化读写映射与真机证据
tags: [abap-cli, object-type, oa2p, oauth2, ucon, icf, local-extension]
created at: 2026-11-04 02:15:00
changed at: 2026-11-04 02:15:00
---

# OA2P — OAuth 2.0 Client Profile

OAuth 2.0 **client profile**（事务 `OA2C_CONFIG` 中的 profile）：一个 OAuth 2.0 service provider type + scope 列表 + no-authority-check 标志。持久化在 `OA2C_PROFILES` / `OA2P_SCOPES`，是 TADIR 对象（`OBJECT = 'OA2P'`）。UCON / OAuth 2.0 没有 ADT 资源，上游 abap-file-format 也没有 OA2P 格式，所以本 CLI 用本地扩展格式 + 自建 ICF 端点实现。

本类型只管理 profile 本身；**OAuth 2.0 client 与 profile 的分配关系（以及 `S_OA2C_ADM` 权限）仍在 OA2C_CONFIG**。

## 路由（单通道 ICF）

| 操作 | ICF 端点 |
|---|---|
| create | `POST /sap/abap_cli/oa2p/<name>` |
| pull | `GET /sap/abap_cli/oa2p/<name>` |
| push | `GET`（存在性探测）→ `POST /sap/abap_cli/oa2p/<name>` |
| delete | `DELETE /sap/abap_cli/oa2p/<name>` |

`GET /oa2p`（列表）不实现；profile 没有激活步骤（写入即生效）。

ABAP 侧（`abap/src/zcl_abap_vibe_icf_oa2p.clas.abap`）走 Workbench 持久化类 `CL_OA2P_OBJECT_PERSIST` / `CL_OA2P_OBJECT_DATA`（与 abapGit 的 OA2P handler 同一路径）：

- **读**：`IF_WB_OBJECT_PERSIST~GET`（version `A`）→ `OA2C_SX_OA2P_OBJECT_DATA` → header（profile / type / noAuthCheck / admin data）+ `T_SCOPES`。
- **建 / 改**：lock（`ENQUEUE_EOA2C_PROFILES`）→（改时）读取当前数据 → 覆盖 provider type / noAuthCheck / scopes / admin data → `RS_CORR_INSERT`（TADIR + package / transport）→ `save` → `COMMIT WORK` → unlock。
- **删**：先 `CL_OA2C_CONFIG_WRITER=>CHECK_PROFILE_USAGE`（被 OAuth 2.0 client 使用时拒绝，`OA2P_PROFILE_IN_USE`），再 lock → `IF_WB_OBJECT_PERSIST~DELETE` → 本地包直接删 TADIR 行 / 传输包经 `RS_CORR_INSERT` mode `D` 记录删除 → `COMMIT WORK` → unlock。
- **provider type**：必须存在于 `OA2C_TYPES`（如 `DEFAULT`、`HANA_CLOUD_PLATFORM`）；provider 专属配置对象（`O_SPECIFICS`）是无状态的 BAdI 实现，不落文件、不往返。

## 本地文件形态

```
src/
└── <name>.oa2p.json
```

`oa2p-v1.json` 是**本地扩展 schema**（`src/abap_cli/schema/oa2p-v1.json`）。`name` 只出现在文件名 / 命令参数里；`pull` 写出的文件不含 `name` / `package` / admin 字段，因此可以直接作为 `create` / `push` 的模板。

```json
{
  "formatVersion": "1",
  "type": "DEFAULT",
  "noAuthCheck": false,
  "scopes": ["scope-one", "scope-two"]
}
```

| 字段 | 必填 | 规则 / 真机映射 |
|---|---|---|
| `formatVersion` | 是 | 恒为 `"1"` |
| `type` | 是 | ≤ 20 字符（`OA2C_TYPE`）；必须存在于 `OA2C_TYPES`。留空时 handler 按 `DEFAULT` 处理 |
| `noAuthCheck` | 否 | 布尔，默认 `false`；映射 `OA2C_PROFILES-NO_AUTH_CHECK`（`'X'` / 空） |
| `scopes` | 否 | 字符串数组，每项 1–1024 字符；写入 `OA2P_SCOPES`（`SCOPENO` 按数组顺序 1..n），空项被丢弃 |

名称上限 **30 字符**（`OA2C_PROFILE`），大小写不敏感（CLI 与 handler 都统一大写），只允许 `A-Z 0-9 _ /`。`--file` 文件名必须与 profile 名一致：`<name>.oa2p.json`。

## 命令示例

```bash
# 拉取已有 profile（只读）
abap pull SAP_COM_0437 --type OA2P --json

# 创建 / 覆盖（TADIR 对象：$ 开头本地包免 transport，其它包需要 --tr）
abap create OA2P ZCLI_OA2P_DEMO --file src/zcli_oa2p_demo.oa2p.json --package '$TMP' --yes --json

# 修改文件后推回（update-only；不存在请用 create）
abap push src/zcli_oa2p_demo.oa2p.json --yes --json

# 删除（被 client 分配时会被拒绝；非本地包需要 --tr）
abap delete ZCLI_OA2P_DEMO --type OA2P --yes --json
```

`create` / `push` 的本地校验全部在写 SAP 之前完成：schema + 语义规则（type、noAuthCheck 类型、scope 长度）+ 名称规则 + 文件名匹配 + package / transport 规则。`--check-only` 只做本地校验并打印计划；`push --dry-run` 不写 SAP。

## 已知限制

1. **没有描述字段**：`OA2C_PROFILES` 不存描述，schema 也没有 `description`；`--description` 在 `create` 时被显式拒绝（`TYPE_NOT_SUPPORTED`，exit 7）。
2. **provider 专属配置不往返**：`O_SPECIFICS` 是 provider BAdI 的无状态实现，不在 `oa2p-v1` 文档里；OAuth 2.0 client 的实际 client id / secret / endpoint 配置属于 OA2C_CONFIG 的 client 对象，不在本类型范围。
3. **被分配的 profile 不能删**：SAP 侧规则（`CHECK_PROFILE_USAGE`）；handler 返回 `OA2P_PROFILE_IN_USE`（exit 7）并提示先在 OA2C_CONFIG 解除分配。
4. **权限仍由 OA2C_CONFIG 管**：`S_OA2C_ADM` 的 profile 维护权限不在本类型单独建模；ICF 写入走 `RS_CORR_INSERT` 的 package / transport 权限检查。
5. **需要 OAuth 2.0 组件**：依赖 `CL_OA2P_OBJECT_PERSIST` / `CL_OA2P_OBJECT_DATA` / `CL_OA2C_CONFIG_WRITER` / `OA2C_TYPES`（S/4HANA 757 已验证）。旧 release 缺这些类时 `abap deploy` 激活阶段失败、路由不存在，而不是运行时降级。
6. **`push` 只更新、不创建**：push 先 GET 探测，不存在时返回 NOT_FOUND（exit 8）并提示改用 `create`。
7. **`--no-activate` 不适用**：profile 没有激活步骤，写入即生效（`VALIDATION_ERROR`，exit 7）。

## 真机证据

S/4HANA 测试系统（profile `test`，ABAP release 757、client 100，ICF 服务发布形态 2.5.0；`abap deploy status` = current）六阶段运行 **57/57 TC PASS**（`tests/261104201-srfc-oa2p/`，本地不入库）：

- **闭环**：`create ZCLI_OA2P_TC_* → pull → validate:aff → 改 noAuthCheck / scopes → push → re-pull → delete → pull`；re-pull 与编辑值一致，删除后 `OA2C_PROFILES` / `OA2P_SCOPES` / TADIR 均无 `ZCLI_OA2P_TC%` 残留。
- **只读 pull SAP 自带 profile**：`SAP_COM_0437` 读到 provider type `DEFAULT`、noAuthCheck、scopes 与 admin data；pull 前后系统数据未变，未 push / delete 该对象。
- **错误路径实测**：missing pull/push/delete → exit 8；未知 provider type → `OA2P_INVALID_PAYLOAD`（exit 7）；`--description` → `TYPE_NOT_SUPPORTED`（exit 7）；非本地包缺 `--tr` → `VALIDATION_ERROR`（exit 7）；`--no-activate` → exit 7；文件名不匹配 / delete 缺 `--yes` → exit 2；schema 非法 → exit 7；`--check-only` 零 SAP 写入。
- **`--json` 形状**：create / pull / push / delete / types 的 `data` 字段按契约返回。
- **清理**：`ZCLI_OA2P_TC%` 全命名空间 0 行（含 TADIR）；打开的 transport 列表为空。
- **未覆盖**：非 `$TMP` 传输包写路径（测试系统没有打开的 transport request）与被 OAuth 2.0 client 分配的 profile 删除（系统无可用测试样本）；两条路径由 mock 集成测试与 SAP 侧 `RS_CORR_INSERT` / `CHECK_PROFILE_USAGE` 实现覆盖。
- **环境注意**：测试系统与并行 ticket 共享，ICF 部署是系统级的、会被其他 ticket 的 `abap deploy` 覆盖；运行脚本在测试前探测 `/srfc` 路由并在必要时重装本分支 release form。

# references

- 类型索引：[`wiki/objects/index.md`](index.md)
- 类型矩阵：[`wiki/object-types.md`](../object-types.md)
- `create` / `pull` / `push` / `delete`：[`wiki/commands/`](../commands/index.md)
- schema 来源说明：[`src/abap_cli/schema/README.md`](../../src/abap_cli/schema/README.md)
