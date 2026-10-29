---
type: reference
title: AFF 格式层的 Artifact 契约与 ddic 拆分
description: formats/ 下 7 个同构 json.ts 提取共享 artifact 契约，880 行 ddic/json.ts 按 wire / io / validate / examples 拆分 — 决策、被否决方案与当前代价
tags: [abap-cli, design-decisions, formats, abap-file-format]
created at: 2026-10-30 00:10:00
changed at: 2026-10-30 00:10:00
---

# 008 — AFF 格式层的 Artifact 契约与 ddic 拆分

## 决策

1. **共享 artifact 契约**：`formats/artifact.ts` 定义
   - `JsonArtifact<TLocal>`：`read` / `write` / `validate` / `load`（文件 I/O + AFF schema 校验；`load` 失败抛 `AFF_FIXTURE_INVALID`）
   - `WireArtifact<TLocal, TWire>`：在 `JsonArtifact` 上增加 `toWire` / `fromWire`

   纯 JSON 的五个模块（TTYP / MSAG / DDLS / ENQU / NROB）用 `defineJsonArtifact` / `defineWireArtifact` 声明 artifact，不再各写一套 read/write/validate/load。DDLS 的 wire 映射不对称（CDS source 在兄弟 `.acds` 文件里），只用 `defineJsonArtifact`，`wireToLocal` / `localToWire` 留在模块内。
2. **`formats/ddic/json.ts` 按职责拆分**（原 880 行混装 6 类职责）：
   - `types.ts` — wire/local 接口与联合类型（无运行时依赖）
   - `io.ts` — `readDdicJson` / `readDdicObjectForCreate` / `writeDdicJson` / `listDdicFiles`
   - `wire.ts` — `localToWire` / `wireToLocal` / 字段映射 / 三件套提取 / 固定值
   - `validate.ts` — `validateDdicObject` + TABT settings 同步校验
   - `examples.ts` — `--schema` / quickstart / 错误 nextSteps 用的示例 JSON
3. 调用方（create/pull/push flows 与测试）直接 import 具体模块；`json.ts` 删除，不保留 barrel。

## 上下文

格式层 7 个 `*/json.ts` 导出同构函数集，read/write/validate/load 四件套逐字重复；`ddic/json.ts` 单文件混装 wire 接口、文件 I/O、字段映射、示例文本、校验与 TABT 枚举。改一处 schema 校验语义要动 5-7 个文件，测试也只能按文件整体 import。

## 被否决方案

1. **保留各模块四件套，只抽公共 helper** — helper 仍要靠每个模块手写包装，样板不减；且无法在类型层保证 `load` 的错误码一致。
2. **`formats/ddic/json.ts` 保留为 barrel 再导出新模块** — 与 AGENTS「不打补丁 / 不加 wrapper」冲突；barrel 会把"改哪个模块"重新藏起来。
3. **把 artifact 泛型扩展成支持 ddls 的 source 参数** — `toWire(local, source)` 只对 DDLS 成立，泛型签名会被单个特例污染；不如让 DDLS 只共享 I/O 契约。

## 当前代价

- 五个 artifact 模块多了一次 `defineWireArtifact` 声明；wire 函数仍留在模块里（这是类型特有部分，未抽走）。
- `ddic` 拆成 5 个文件后 import 面变大（15 处调用点改为按职责 import）；`tabl-artifact.ts` 与 `io.ts`/`wire.ts` 之间靠类型与 lazy import 保持无环。
- DDIC / HTTP / TRAN 的格式模块仍是各自实现（DDIC 有 sidecar 读取、HTTP/TRAN 有 ICF 专用 envelope），未纳入本次契约。

## 后果

- 新增 AFF 类型 = 声明 artifact + 写 wire 映射；schema 校验/错误码/file I/O 行为统一。
- `formats/ddic/*` 按职责可独立演进（例如 TABT 校验或示例文本），不再需要动同一个 880 行文件。
- 下一步可把 DDIC / HTTP / TRAN 的 I/O 与校验接到同一契约，之后 ABAP ICF 端点族（ddic/http/tran）与 CLI 格式模块一一对齐。

# references

- 契约：`src/abap_cli/formats/artifact.ts`
- 拆分：`src/abap_cli/formats/ddic/{types,io,wire,validate,examples}.ts`
- 测试：`test/unit/artifact-contract.test.ts`、各 `*-roundtrip.test.ts`
