---
type: reference
title: 单一路由表（TYPE_ROUTES）
description: create / pull / push 的类型路由收敛到 flows/edit/routing.ts 一张显式表 — 决策、被否决方案与当前代价
tags: [abap-cli, design-decisions, routing, architecture]
created at: 2026-10-30 00:05:00
changed at: 2026-10-30 00:05:00
---

# 007 — 单一路由表（TYPE_ROUTES）

## 决策

`create` / `pull` / `push` 的对象类型路由集中在 `src/abap_cli/flows/edit/routing.ts` 的 `TYPE_ROUTES`：一行一个受支持类型，每行可含 `create` / `pull` / `push` 三个 route。

- `kind: 'source'` — 该操作走协调器里的通用 ABAP 源码路径（CLAS / INTF / PROG / FUGR 等）。
- `kind: 'handler'` — 该操作走 per-type flow（`create-*` / `pull-*` / `push-*` / `push-icf.ts`）。
- `channel` — 该操作实际使用的 SAP 通道：`adt`、`icf`，或 `auto`（flow 内部调 `channel-detect`，按内核版本决定 ADT 主路径 / ECC ICF fallback）。

`types/registry.ts` 继续只负责本地布局与能力元数据（folder / `createObjtype` / AFF schema / `requiresFile`）。`test/unit/routing.test.ts` 断言两张表的类型集合与每操作通道完全一致。

## 上下文

之前 create / pull / push 各有一套真相：`TYPE_REGISTRY` 声明"支持什么类型"，per-type 模块在 import 时用 `registerCreateHandler` / `registerPullHandler` 把自己塞进可变注册表；push 侧另有 `ICF_PUSH_HANDLERS` + `CHANNEL_ROUTED_PUSH` 两张局部表，加上 dispatcher 里的 if-chain。后果：

- 路由依赖副作用 import 才生效（顺序隐式），测试必须用 `clearHandlersForTesting` / `restoreHandlersForTesting` 做快照回滚。
- 12 个 per-type 模块反向 import `create.ts` 的 `CreateOptions` 形成环，`create.ts` 再 import 它们。
- 新增一个类型要改 5 处；三张表之间的 channel 语义还不一致——同一类型的 pull / push 通道可以不同（NROB：pull 是 ADT 优先 + ICF fallback，push 固定 ICF）。

## 被否决方案

1. **保留可注册 handler 表，只补测试** — 隐式顺序与快照 API 的成本仍在，且无法在一个地方回答"类型 X 的 push 走哪条通道"。
2. **把路由表合并进 `types/registry.ts`** — registry 被 formats / file-resolver 等底层模块 import；表里直接引用 per-type flow 函数会形成底层 → flows 的层级倒挂，并产生运行时环。
3. **per-operation 三张表分文件存放** — 与现状的差别只是搬家；跨操作的通道一致性无法在测试里一眼对照。

## 当前代价

- `routing.ts` 在模块加载时 import 全部 create / pull / push per-type 模块：`abap create` / `pull` / `push` 启动会多加载约 5–10 ms（实测三者全量 import 111.5 ms vs 单族 104–107 ms）。`--version` / `--help` 等不加载命令模块的路径不受影响，命令级懒加载仍在 `registry/commands.ts`。
- `TYPE_ROUTES` 与 `TYPE_REGISTRY` 是两张按类型对齐的表，需要一致性测试守护；新增类型必须同时改两处（有意为之：能力元数据与操作路由职责不同）。

## 后果

- 新增类型 = `TYPE_REGISTRY` 一行 + `TYPE_ROUTES` 一行 + per-type 模块；不再有注册顺序、快照 API 或 if-chain。
- `push` 的三类文件来源（ABAP 源码 / ICF JSON / AFF JSON）由 `kind` 表达，`--check-only` / `--dry-run` / `--atomic` 的闸门与校验集中在 push 协调器。
- 后续 formats `Artifact` 契约与 ABAP ICF 端点族收敛都以此表为挂载点。

# references

- 实现：`src/abap_cli/flows/edit/routing.ts`、`push-icf.ts`、`push-types.ts`
- 元数据：`src/abap_cli/types/registry.ts`
- 一致性测试：`test/unit/routing.test.ts`
