---
type: command
title: abap deploy
description: 部署内置 ICF ABAP 服务 — `abap deploy` 默认推送发布形态（helper 合并为 handler 内 `lcl_*` 本地类，SAP 上只装 3 个全局类）；`--dev` 安装开发形态的全部全局类；`abap deploy status` 只读探测版本匹配
tags: [abap-cli, command, deploy, icf, steampunk, btp, merge]
created at: 2026-09-05 00:00:00
changed at: 2026-10-30 21:45:00
---

# abap deploy

部署内置 ICF ABAP 服务（自建 `/sap/abap_cli`），承载 DDIC CRUD / textpool **读** / `select` / `tcode` / `run` 等旁路 ADT 的能力。服务源码以**开发期全局类树**维护在 `abap/src`（19 个类，清单 `abap/deploy.json`），deploy 提供发布形态与开发形态两种产物。

## Usage

```bash
abap deploy [options]                 # 发布形态（默认）：SAP 上 3 个全局类
abap deploy --dev [options]           # 开发形态：SAP 上 19 个全局类（维护者）
abap deploy status [options]          # 只读探测：是否已安装？版本匹配？
```

## `abap deploy`

把内置 ICF 服务推到 SAP，然后触发 ICF 设置类（`ZCL_ABAP_VIBE_ICF_SETUP`，ADT classrun）创建/绑定/激活 `/sap/abap_cli` SICF 节点（幂等）。

两种形态的区别：

| | 发布形态（`abap deploy`，默认） | 开发形态（`abap deploy --dev`） |
|---|---|---|
| SAP 对象 | 3 个全局类：`ZCL_ABAP_VIBE_ICF`（handler）+ `ZCL_ABAP_VIBE_ICF_SETUP` + `ZCL_ABAP_VIBE_RUNNER` | 19 个全局类：handler + 共享类型 + 10 个域 helper + 5 个 format + setup/runner |
| handler 内容 | main + 由 16 个 helper 合并生成的 definitions / implementations：helper 类头降级为 `lcl_*`，`zcl_*` 引用改名为 `lcl_*` | 只有 main；definitions / implementations 不写 |
| 用途 | 分发给用户；`abap deploy` 的唯一发布产物 | 维护者在真机上单类迭代（语法检查 / 激活 / ABAP Unit / 端点） |
| 顺序 | handler 先、standalone 后 | 依赖拓扑序：共享类型最先、format 先于 ddic、handler 在全部 helper 之后、setup/runner 最后 |

发布形态的合并器是纯函数模块 `src/abap_cli/flows/edit/deploy-merge.ts`：读 `abap/deploy.json`（`handler` / `merged[{global,local}]` / `standalone`）、把 helper 类头降级为 `lcl_*`、按 definition 引用做稳定拓扑排序、拼接出两个 include，并校验生成结果没有残留的全局类名。生成的两个 include 不进仓库——`abap/src` 只放开发形态源码（handler 仅有 main；merged helper 仅有 main + 可选 definitions prelude）。

**共存与切换**：两种形态可在同一 SAP 系统共存（发布形态用 `lcl_*` 本地类，开发形态用 `zcl_*` 全局类；handler 同名，后部署者覆盖它的三个 part）。dev → release 直接 `abap deploy`，dev 全局类留在系统里但不再被引用（无害，不必删除）；release → dev 直接 `abap deploy --dev`，上一次生成的两个 include 里是 `lcl_*` 死代码，能自洽编译、不阻塞激活。**不要**把已部署的 handler `abap pull` 回来再 push：pull 会落 `definitions` / `implementations` include 文件，deploy 会把它们当成违规源码拒绝（`DEPLOY_MANIFEST_INVALID`）。形态切换不改变 ICF 节点、端点或服务版本。

### Options

- `--dev`: 安装开发形态（19 个全局类，跳过发布合并）；发布形态是默认
- `--tr <transport>`: transport 号（`--package` 非 `$TMP` 时必填）
- `--package <package>`: 目标包（默认 `$TMP`——本地对象，无需 transport）
- `--dry-run`: 仅计划，零 SAP 变更调用
- `--diff`: 逐文件差异摘要（生成的两个 include 也参与比较）
- `--force`: 绕过安全检查（结果 `forced: true`）
- `--yes`: 非交互确认
- `--schema`: 打印本命令参数 schema（unified envelope，无 SAP 调用）

### 行为规则

- `--package` 非 `$TMP` 且无 `--tr` → `NO_TRANSPORT`（exit 7 类）
- **`$TMP` 与 `--tr` 互斥**：deploy 在 `$TMP` 路径下显式拒绝 `--tr`。**禁止**自动选 user 的 modifiable transport：当 user 拥有任意可改 transport 时，原 `resolveTransport({transportOptional: true})` 会把新 `gc_version` 写进 transport，`$TMP` 里的 active class 仍是旧版 → `deploy status` 永远 outdated、`deploy` 看似 success 实际 no-op。`$TMP` 必须走空 transport（local object 直接激活）。
- `targetPackage === '$TMP'`：`transport = ''`（走 local object 直接激活）
- `targetPackage !== '$TMP'`：`resolveTransport` 解析链：`--tr` > 项目配置 > 用户可改请求
- 自动创建 SAP 上不存在的捆绑对象（`objects` 数组：`created | updated | unchanged | failed`）
- 发布形态只推 3 个对象：merged helper 不单独推送、也不逐条列在 `files[]`；对象级 summary 用 `mergedClasses` 记录合并数量
- `abap/src` 有类未登记进 `abap/deploy.json`、或清单与源码不一致 → `DEPLOY_MANIFEST_INVALID`（exit 7）；合并切分失败 / 依赖成环 / 改名残留 → `DEPLOY_MERGE_FAILED`（exit 7）
- 清单 `abap/deploy.json` 缺失 → `DEPLOY_MANIFEST_MISSING` warning，降级为"每个类都当全局类安装、不合并"（安装方仍得到可用的服务，只是对象数变多）
- 设置失败 → 结构化 `SAP_ERROR`（exit 6），`details` 带 `objects` / `files`，能看到哪些源码已部署、哪个失败；setup classrun 刚激活后仍拿到旧类加载句柄（"does not implement if_oo_adt_classrun~main"）时自动重试一次
- `--dry-run` 报 `icfNode.status: "planned"` 而不触发设置；`mode` 仍如实报告（release/dev）

## `abap deploy status`

只读探测 SAP 侧 ICF 服务：读 `/sap/abap_cli` 根端点的 `version` 字段，与捆绑版本（`ICF_SERVICE_VERSION`）比对。永不修改 SAP。

### 行为规则

- 结果 `{ installed, status, remoteVersion, expectedVersion, match }`
- `status` ∈ `not_deployed`（404）| `current` | `outdated` | `unreachable`（非 404 异常）
- `not_deployed` / `outdated` → hint `abap deploy`
- `outdated` 还会**额外**触发 `meta.warnings[]` `ICF_OUTDATED_DEADLOCK`，给出三步恢复路径（`abap transport list --open` 查遗留 transport → release/import 历史 transport → `abap deploy --yes` 重 deploy → `abap deploy status` 验证）——专门应对死锁模式：用户用旧版 CLI 部署后 SAP 端 transport 里有新 source 但 $TMP 仍是旧 version。
- `unreachable` → 降级为 `meta.warnings` 条目，不崩溃
- **边界**：`deploy status` 查 SAP 侧；`abap doctor` 查本地（环境 / 配置 / profile 可达性）

## Examples

```bash
# 发布形态（$TMP，无需 transport）
abap deploy --yes

# 开发形态（维护者：全部 19 个全局类，按依赖顺序）
abap deploy --dev --yes

# 预览 + 差异
abap deploy --dry-run --diff

# 幂等检查（两次 deploy 之间应全部 unchanged）
abap deploy --diff --json

# 部署到正式包
abap deploy --package ZABAP_VIBE --tr DEVK900001 --yes

# 探测状态
abap deploy status --json
```

## Expected Output

`deploy`（on-prem / netweaver740+，发布形态）：

```json
{
  "status": "success",
  "meta": { "command": "abap deploy", "version": "1.0.0", "timestamp": "2026-10-30T00:00:00.000Z", "durationMs": 8400, "warnings": [] },
  "data": {
    "mode": "release",
    "mergedClasses": 16,
    "objects": [
      { "object": "ZCL_ABAP_VIBE_ICF", "type": "CLAS", "status": "updated" },
      { "object": "ZCL_ABAP_VIBE_ICF_SETUP", "type": "CLAS", "status": "updated" },
      { "object": "ZCL_ABAP_VIBE_RUNNER", "type": "CLAS", "status": "updated" }
    ],
    "files": [
      { "file": "zcl_abap_vibe_icf.clas.abap", "status": "deployed" },
      { "file": "zcl_abap_vibe_icf.clas.definitions.abap", "status": "deployed" },
      { "file": "zcl_abap_vibe_icf.clas.implementations.abap", "status": "deployed" }
    ],
    "icfNode": { "status": "success", "action": "already_active", "url": "/sap/abap_cli", "active": true, "handler": "ZCL_ABAP_VIBE_ICF" },
    "runtime": "netweaver750",
    "deployKind": "full"
  }
}
```

`files[].file` 是相对 `abap/src` 的路径；发布形态里 handler 的两个 include 是 deploy 时生成的，不来自仓库文件。`--dev` 时 `mode: "dev"`、没有 `mergedClasses`，`objects` / `files` 列出全部 19 个类。

`deploy status`：

```json
{
  "status": "success",
  "meta": { "command": "abap deploy status", "version": "0.2.6", "timestamp": "2026-09-05T00:00:00.000Z", "durationMs": 300, "warnings": [] },
  "data": { "installed": true, "status": "current", "remoteVersion": "0.6.0", "expectedVersion": "0.6.0", "match": true, "runtime": "netweaver750", "icfSetupBlocked": false }
}
```

## <a id="steampunk"></a>BTP / Steampunk (030 runtime detection)

`abap deploy status` 与 `abap deploy` 自动探测目标 SAP 系统的 ADT runtime 层，结果写进 JSON 的 `data.runtime` 字段：

| `runtime`        | 系统形态                                       | `icfSetupBlocked` | `deploy` 行为                                  |
|------------------|------------------------------------------------|-------------------|------------------------------------------------|
| `netweaver740`   | NETWEAVER 7.40–7.49 on-prem                   | `false`           | full — 调 `ZCL_ABAP_VIBE_ICF_SETUP` 建 SICF 节点 |
| `netweaver750`   | NETWEAVER 7.50+ / S/4HANA on-prem             | `false`           | full — `cl_icf_tree` 路径（同上）               |
| `steampunk`      | BTP ABAP environment（Cloud Foundry）          | `true`            | source-only — CLAS/PROG 照常 deploy；ICF 节点**不**自动注册 |
| `unknown`        | 探测失败 / 端点不可达                          | `false`           | 默认走 on-prem `cl_icf_tree`（保守 fallback）   |

探测来源：

1. `GET /sap/bc/adt/repository/informationsystem`（Atom XML）读 `sap-component` / `sap:rel`
2. 备用 `GET /sap/bc/adt/discovery` 看 workspace 是否声明 `/sap/bc/adt/icf/*` collection

`probeAdtRuntime` 同时收集 `data.apiCapabilities` 字段（034），给策略注册器（见下）路由判断用：

```jsonc
{
  "runtime": "steampunk",
  "icfSetupBlocked": true,
  "apiCapabilities": {
    "icf":         { "available": false },                       // no /sap/bc/adt/icf/*
    "httpService": { "available": true },                        // /sap/bc/adt/ucon/httpservices
    "steampunkMarkers": [ "steampunk", "hana.ondemand" ]
  },
  "probedAt": "2026-09-05T15:29:25.941Z"
}
```

on-prem S/4HANA 形态：`{ runtime: "netweaver750", apiCapabilities: { icf: { available: true }, httpService: { available: false } } }`。

### Runtime cache（034）

`profile test` 在 adt layer 成功时主动刷 runtime 到 `~/.abap-cli/systems.json` 的 `systems[].runtime` 字段。`deploy` 优先读 cache，缺时再 `probeAdtRuntime`。`getOrProbeRuntime(name, { force? })` / `readCachedRuntime(name)` / `clearRuntimeCache(name)` 在 [src/abap_cli/config/runtime-cache.ts](../../src/abap_cli/config/runtime-cache.ts)。

### ICF register 策略注册器（034）

`deploy` 的 ICF 分支通过 `IcfRegisterStrategy` 接口 + registry dispatch。三档内置 strategy：

| strategyId | runtime | 行为 |
|---|---|---|
| `on-prem-cl-icf-tree` | `netweaver740` / `netweaver750` / `unknown` | 调 `ZCL_ABAP_VIBE_ICF_SETUP` classrun 建 SICF 节点 |
| `steampunk-cockpit-fallback` | `steampunk` | 030 行为 — 弹 Cloud Foundry destination hint（`STEAMPUNK_ICF_MANUAL` warning）|
| `steampunk-swb` | 预留 — `supports()` 当前总是 false | 等 SAP 文档化 `/sap/bc/adt/ucon/httpservices` POST body schema 后翻转 |

新增第 4 档 strategy 不需要改 deploy-flow：在 [src/abap_cli/adc/strategies/](../../src/abap_cli/adc/strategies/) 下新建文件，`icf-bootstrap.ts` 加一行 `registerIcfStrategy(new MyStrategy())` 即可。

### 为什么 Steampunk 不能自动注册 ICF 节点

BTP ABAP environment 受 SAP Steampunk Released APIs 白名单限制：
- `CL_ICF_TREE`
- `CX_FOR_ICF_TREE`
- `ICFHOSTNUM`

上述 API 在 trial / 生产 Steampunk 上编译时一律 `LA(020)` 拒绝。`ZCL_ABAP_VIBE_ICF_SETUP` 是为 on-prem ECC 设计的（用 `cl_icf_tree` 写 SICF），无法在 Steampunk 激活。

### Steampunk 下的 deploy 输出

```json
{
  "status": "success",
  "data": {
    "mode": "release",
    "mergedClasses": 16,
    "objects": [
      { "object": "ZCL_ABAP_VIBE_ICF", "type": "CLAS", "status": "updated" },
      { "object": "ZCL_ABAP_VIBE_ICF_SETUP", "type": "CLAS", "status": "updated" },
      { "object": "ZCL_ABAP_VIBE_RUNNER", "type": "CLAS", "status": "updated" }
    ],
    "files": [
      { "file": "zcl_abap_vibe_icf.clas.abap", "status": "deployed" },
      { "file": "zcl_abap_vibe_icf.clas.definitions.abap", "status": "deployed" },
      { "file": "zcl_abap_vibe_icf.clas.implementations.abap", "status": "deployed" }
    ],
    "icfNode": { "status": "planned" },
    "runtime": "steampunk",
    "deployKind": "source-only"
  },
  "meta": {
    "warnings": [{
      "code": "STEAMPUNK_ICF_MANUAL",
      "message": "ICF service node cannot be registered automatically on this BTP system; expose the handler via a Cloud Foundry destination.",
      "details": { "runtime": "steampunk" }
    }]
  }
}
```

`deployKind: "source-only"` + `meta.warnings[].code: "STEAMPUNK_ICF_MANUAL"` 表示 **sources 已成功部署，ICF 服务节点需手工暴露**。CLI 不抛错（与 on-prem `cl_icf_tree` 失败行为不同）。

### 把 ICF handler 暴露成 Cloud Foundry destination

Steampunk 下，handler `ZCL_ABAP_VIBE_ICF` 已经被 deploy 到 ABAP 系统上，但要让它对外可达，需要在 SAP BTP Cockpit 里登记一个 destination：

1. **SAP BTP Cockpit** → Cloud Foundry → 你的 space → 你的 ABAP trial
2. **Connectivity → Destinations → New Destination**：
   - `Name`: `abap_cli`（与 SICF 节点名一致，见 `ZCL_ABAP_VIBE_ICF_SETUP` 的 `gc_name`）
   - `Type`: `HTTP`
   - `URL`: `<trial-url>/sap/abap_cli`（无尾斜杠）
   - `ProxyType`: `Internet`
   - `Authentication`: `NoAuthentication`（或按你的安全策略）
3. 验证：`curl <trial-url>/sap/abap_cli/` → `{"service":"abap_cli","version":"<x.y.z>",…}`
4. （可选）绑 route：`cf map-route <app> <domain> --path abap_cli`

CLI 也会在 human 输出（不传 `--json`）末尾打印上述步骤的精简版本。

# More

## 关联命令

- [abap init](init.md) — 初始化时信息性 ICF 检查（`data.icf`）
- [abap profile](profile.md) — `profile test` 的 icf 层探测
- [abap doctor](doctor.md) — 本地诊断（报告安装版本）

# references

- 实现: [src/abap_cli/commands/deploy.ts](../../src/abap_cli/commands/deploy.ts) · [src/abap_cli/flows/edit/deploy.ts](../../src/abap_cli/flows/edit/deploy.ts) · [src/abap_cli/flows/edit/deploy-flow.ts](../../src/abap_cli/flows/edit/deploy-flow.ts) · [src/abap_cli/clients/icf-version.ts](../../src/abap_cli/clients/icf-version.ts)；合并器 `src/abap_cli/flows/edit/deploy-merge.ts`
- ICF 注册策略: [src/abap_cli/adc/strategies/](../../src/abap_cli/adc/strategies/)
- SAP 后端: `abap/src/zcl_abap_vibe_icf.clas.abap`（handler）· `abap/src/zcl_abap_vibe_icf_setup.clas.abap` · `abap/src/zcl_abap_vibe_runner.clas.abap`；开发形态清单 `abap/deploy.json`
- 设计决策: [012 — ICF 服务开发期全局类树 / 发布期合并单类](../design-decisions/012-icf-dev-global-release-merged.md)
- 文档: [docs/commands.md](../../docs/commands.md)、[docs/configuration.md](../../docs/configuration.md)
