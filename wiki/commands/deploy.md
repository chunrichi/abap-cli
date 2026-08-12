---
type: command
title: abap deploy
description: 部署 bundled ICF ABAP 服务到 SAP — 自动创建 / 更新 / 激活 bundled 源码对象（`ZCL_ABAP_VIBE_ICF` + `ZCL_ABAP_VIBE_ICF_SETUP` + `ZCL_ABAP_VIBE_RUNNER`），并触发 SICF 节点 `/sap/zabap_vibe` 的创建与绑定。`abap-edit` skill 的前置依赖（`run --method` 与 `select` 都需要 ICF 在场）。
tags: [abap-cli, command, deploy, icf, install, agent-loop]
created at: 2026-08-09 22:40:00
changed at: 2026-08-09 22:40:00
---

# abap deploy

把 bundled ICF 服务（`ZCL_ABAP_VIBE_ICF` 等）部署到 SAP 系统。包含两层动作：

1. **bundled 源码部署**：自动创建 / 更新 / 激活 bundled 源码对象（CLAS），按对象 per-part 激活
2. **SICF 节点配置**：触发 bundled `ZCL_ABAP_VIBE_ICF_SETUP`（`if_oo_adt_classrun~main`）幂等创建 / 绑定 / 激活 `/sap/zabap_vibe` SICF 节点

完成后 `abap-data` skill 下的 `run --method` 与 `select` 才能调通——ICF 服务在场是前提。

## Usage

```bash
abap deploy [options]
abap deploy --dry-run
abap deploy --diff
abap deploy --yes
abap deploy --package ZABAP_VIBE --tr DEVK900001 --yes
```

## Options

- `--tr <transport>`: transport 请求号（非 `$TMP` 包时必填；按 `--tr` > config > 用户可修改请求 > `NO_TRANSPORT` 解析）
- `--package <package>`: 目标 SAP 包（**默认 `$TMP`** — 本地免 transport；与 bundled `abap/package.devc.xml` 一致）
- `--dry-run`: 计划模式 — 零变更 ADT 调用
- `--diff`: per-file 变更摘要
- `--force`: 绕过安全护栏（`forced: true` 出现在结果中）
- `--yes`: 非交互环境确认

无 `--tr` 且 `--package` 非 `$TMP` → `NO_TRANSPORT`（VALIDATION_ERROR/7）。`--dry-run` 不调任何 mutating ADT，输出 `dryRun: true` envelope。

## 默认包与 transport 规则（核心）

`--package` 默认 `$TMP`（bundled 包就是 `$TMP`），**无需 `--tr`**；非 `$TMP` 包才需 `--tr`：

| `--package` | `--tr` | 行为 |
|---|---|---|
| `$TMP`（默认） | 省略 | ✅ 直接 deploy |
| `$TMP` | 显式 | ✅ 接受（按用户意图） |
| 任意非 `$TMP` | 省略 | ❌ `NO_TRANSPORT` |
| 任意非 `$TMP` | 显式 | ✅ 走 `--tr > config > userTransports` 链 |

`resolveTransport` 接受 `{ transportOptional: true }` 让 `deploy` 在 `$TMP` 路径下跳过 transport 查找。

## 自动创建 missing 对象（首次部署）

首次在全新 SAP 上 deploy（`ZCL_ABAP_VIBE_ICF` / `ZCL_ABAP_VIBE_ICF_SETUP` 等不存在）不再 `OBJECT_NOT_FOUND` 失败。流程：

1. 按对象分组 bundled 源（一个对象一个 group）
2. 读匹配的 `<name>.<type>.json` 取 description
3. 调 `resolveObject`；`OBJECT_NOT_FOUND` 时调 `createObject`（CLAS/INTF/PROG/FUGR）
4. 重新 resolve 新对象 URL
5. `pushObject` 每个 part

DDIC `.json` 与 textpool `.properties` 文件**不**走 deploy 路径（仍由 `pull` / `push` 自己处理）。

## 部署后激活（per-part）

`pushObject` 写源后调 `inactiveObjects()` + `activateAll(...)`（每个 part 单独激活），确保 `ZCL_ABAP_VIBE_ICF_SETUP` 的 `if_oo_adt_classrun~main` 在场——根 URI `activate` 在真实 SAP 上对 method/OSI 静默 no-op（013 dogfooding 经验）。

## --json 输出信封

成功：

```jsonc
{
  "status": "success",
  "data": {
    "icfNode": {
      "status": "deployed" | "planned" | "unchanged" | "failed",
      "path": "/sap/zabap_vibe",
      "active": true,
      "handler": "ZCL_ABAP_VIBE_ICF"
    },
    "objects": [
      { "name": "ZCL_ABAP_VIBE_ICF", "type": "CLAS",
        "status": "created" | "updated" | "unchanged" | "failed" }
    ],
    "files": [
      { "file": "src/zcl_abap_vibe_icf/zcl_abap_vibe_icf.clas.abap",
        "status": "pushed" | "failed" }
    ]
  }
}
```

`--dry-run` 返回 `{ "dryRun": true, "icfNode": { "status": "planned" } }`，零变更。

## Examples

```bash
# 首次部署（默认 $TMP，无需 --tr）
abap deploy --yes

# 计划模式（不改 SAP）
abap deploy --dry-run

# 看会改什么
abap deploy --diff

# 部署到非 $TMP 包
abap deploy --package ZABAP_VIBE --tr DEVK900001 --yes

# 强制覆盖（绕过护栏）
abap deploy --force --yes
```

## Expected Output

```json
{
  "status": "success",
  "meta": {
    "command": "abap deploy",
    "version": "0.1.0",
    "timestamp": "2026-08-09T22:40:00.000Z",
    "durationMs": 8400
  },
  "data": {
    "icfNode": {
      "status": "deployed",
      "path": "/sap/zabap_vibe",
      "active": true,
      "handler": "ZCL_ABAP_VIBE_ICF"
    },
    "objects": [
      { "name": "ZCL_ABAP_VIBE_ICF", "type": "CLAS", "status": "unchanged" },
      { "name": "ZCL_ABAP_VIBE_ICF_SETUP", "type": "CLAS", "status": "updated" },
      { "name": "ZCL_ABAP_VIBE_RUNNER", "type": "CLAS", "status": "unchanged" }
    ],
    "files": [
      { "file": "src/zcl_abap_vibe_icf_setup/zcl_abap_vibe_icf_setup.clas.abap",
        "status": "pushed" }
    ]
  }
}
```

## 关键错误码

| 错误 | 类别 / exit | 含义 | 恢复 |
|---|---|---|---|
| `NO_TRANSPORT` | VALIDATION_ERROR / 7 | 非 `$TMP` 包缺 `--tr` | 加 `--tr` 或改 `--package $TMP` |
| `ACTIVATION_FAILED` | VALIDATION_ERROR / 7 | 某个 bundled 对象激活失败 | `abap activate <obj> --yes`；再 `abap deploy --yes` |
| `SAP_ERROR` | SAP_ERROR / 6 | SICF setup 失败（`ZCL_ABAP_VIBE_ICF_SETUP` 抛异常） | `abap inspect ZCL_ABAP_VIBE_ICF_SETUP --activation` 诊断；`abap activate ... --yes` |

ICF setup 失败的恢复路径在结果 `nextSteps` 里直接给出。

## 关联命令

- **`abap run`** / **`abap select`**：ICF 在场后才可调用（用 `abap-data` skill）
- **`abap doctor`** / **`abap config`**：探测 ICF 部署状态（`current` / `outdated` / `not_deployed` / `unreachable`）
- **`abap activate`**：单独修复某个 bundled 对象的激活

## references

- 用户文档：[docs/commands.md#abap-deploy](../../docs/commands.md#abap-deploy)
- 设计决策：[specs/013-icf-interface-implementation/spec.md](../../specs/013-icf-interface-implementation/spec.md)
- bundled 源码：`abap/src/clas/`