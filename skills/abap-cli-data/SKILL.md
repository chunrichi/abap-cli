---
name: abap-cli-data
description: abap-cli 对对象的运行时消费 — `select` 查表/视图数据 / `run` 跑类（classrun 或静态方法）。use when asking how to query a table / how to run a class / how to see the output of a classrun / how to do read-only data analysis against SAP.
metadata:
  version: "0.3.0"
  scope: sap
  commands: [select, run]
  tags: [read-only, no-lock, no-transport, no-data-mutation]
---

# abap-cli-data — 对象运行时消费

`sap scope` — 2 个命令。**完全只读**：不修改表数据、不加锁、不写 transport。`tcode` 命令归 `abap-cli-search`（业务码是元数据而非运行时消费）。

## 何时用

- 看表数据：`select --table ZTAB`
- 跑类：`run ZCL_FOO`
- 翻页 select（> 10000 行）：`scripts/pages-select.mjs` 自动分页
- 写代码后跑结果：推送完 `ZCL_FOO` 后紧跟 `run ZCL_FOO`

## 决策树

```
对 SAP 对象做只读消费？
├── 表/视图数据 → select --table T --where "..." --limit N
│    ├── 部分列 → --fields
│    ├── 仅计数 → --count-only
│    ├── 翻页 → --order-by "ID:ASC" --limit 20 --offset 40
│    └── > 10000 行 → [scripts/pages-select.mjs](./scripts/pages-select.mjs) 自动分页
└── 跑类 → run ZCL_FOO
     ├── 直接 classrun → run ZCL_FOO
     ├── 静态方法 → run ZCL_FOO --method compute --args '{...}'
     └── 业务码退出码 → 读 data.exitCode（不是 CLI exit code）
```

## 错误恢复（本 skill 专属错误码）

### run

| 错误 | 动作 |
|---|---|
| `WRAPPER_NOT_DEPLOYED` (exit 8) | 跳 `abap-cli-setup`：`extension deploy --yes` 安装 `ZCL_ABAP_VIBE_RUNNER` |
| `WRAPPER_INPUT_UNAVAILABLE` (exit 6) | ADT classrun 不注入 `--method` 入参；改用直接 classrun 路径 |
| `METHOD_NOT_SUPPORTED` (exit 7) | 方法签名不可反射（CHANGING/TABLES/instance/private/deep）；改 wrapper 类签名 |
| `METHOD_FAILED` (exit 7) | 目标方法抛 `cx_root`；读 `data.parsed` 看异常 |
| `CLASS_NOT_RUNNABLE` (exit 7) | 类没实现 `if_oo_adt_classrun~main`；改用 `--method` 路径 |
| `OBJECT_NOT_ACTIVE` (exit 6) | 本 skill 直接 `activate <obj> --yes`（[abap-cli-edit]） |
| `LOCAL_CLASS_NOT_RUNNABLE` (exit 6) | 类名含 `~`（本地类）；用外部类 |
| `TIMEOUT` (exit 6) | `--timeout` 增大；或拆小循环 |

### select

| 错误 | 动作 |
|---|---|
| `TABLE_NOT_FOUND` (exit 8) | `search <name>`（[abap-cli-search]）校对 |
| `TABLE_TYPE_NOT_SUPPORTED` (exit 7) | v1 仅 TABL+VIEW；pool/cluster/结构/表类型不支持 |
| `INVALID_FIELD` (exit 7) | `error.details.validFields` 取合法字段 |
| `INVALID_WHERE` (exit 7) | `error.details.offset` 指向解析失败位置 |
| `LIMIT_EXCEEDED` (exit 7) | `--limit` ∈ `[1, 10000]` |
| `OFFSET_EXCEEDED` (exit 7) | `--offset` ∈ `[0, 100000]` |
| `QUERY_FAILED` (exit 6) | 本 skill 直接 `activate <table>`（[abap-cli-edit]） |
| `AUTH_ERROR` (exit 5) | 跳 `abap-cli-setup`：`profile test`；检查 `S_TABU_DIS` |
| `ICF_CHECK_DEGRADED` | warning（`meta.warnings`），不阻断 |

## 注入安全（`select` 三层防线，必须严守）

1. **字段名白名单**：`--fields` / where / order-by 字段先对照 `DD03L` 校验并大写归一化
2. **值绑定**：where 值经解析后声明为 ABAP 变量，嵌入 `WHERE (lt_where)` 时以 `@lv_where_v1` 占位——**值永远不进 SQL 文本**
3. **整数边界**：`limit` / `offset` 由 JSON 解析后服务端 `CONV i` + 范围校验

注入载荷按字面值匹配或返回空集，**不**触发 SQL 注入。

## 通用规则

1. **永远 `--json`**：`status` / `error.code` 分支
2. **`select` 完全可放心反复调用**：不修改表数据、不产生传输请求、不加锁
3. **`run --method` 前先看 `extension status`**（[abap-cli-setup]）：若 `WRAPPER_NOT_DEPLOYED`，跳 `abap-cli-setup` 部署
4. **`run` 业务退出码 vs CLI 退出码**：`data.exitCode` 是**业务退出码**（SAP 端写），CLI 退出码是命令本身状态——`jq '.data.exitCode'` 读业务码
5. **`select --count-only` 比 `select --limit 99999` 快**：只取 `COUNT(*)`
6. **跨 skill**：环境/连接/transport 切 `abap-cli-setup`；对象元数据切 `abap-cli-search`；对象修改切 `abap-cli-edit`

## references（按需加载）

- [references/commands-quick.md](./references/commands-quick.md) — 2 命令完整速查
- [references/errors.md](./references/errors.md) — 本 skill 错误码全表

## scripts

- [scripts/pages-select.mjs](./scripts/pages-select.mjs) — 自动分页跑 `select`（>10000 行场景；Node 18+ 跨平台）