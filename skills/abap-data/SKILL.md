---
name: abap-data
description: abap-cli 消费 SAP 能力 — `select`（只读表数据查询，SE16N 等价）、`run`（在 SAP 端执行 classrun 或静态方法）、`extension`（部署自建 ICF 服务到 SAP）。use when asking how to query table data / SE16N equivalent / run a class on SAP / classrun / invoke a static method / deploy ICF service / check wrapper deployment status.
metadata:
  version: "0.1.0"
  scope: sap
  commands: [select, run, extension]
---

# abap-data — 消费 SAP 能力

`sap scope` — 这 3 个命令是**消费 SAP 能力**（读数据、跑 ABAP、部署服务），与 `abap-edit` 的写路径正交。`select` 与 `run` 是**严格只读**（无 transport / 激活 / 锁 / 写）；`extension deploy` 是部署自建 ICF 服务到 SAP 的安装命令。

## 何时用

- 推送代码后想跑一下看输出（`abap run` 触发 `if_oo_adt_classrun~main`）
- 想调用 ABAP 静态方法拿返回值（`abap run ZCL_FOO --method compute --args '{"x":3}'`）
- 想看某张表里有什么数据（`abap select --table ZTAB --where "STATUS='X'" --limit 50`）
- 想精确计数（`abap select --table ZTAB --where "..." --count-only`）
- 第一次在 SAP 系统上用 `abap run` 或 `abap select`，需要先部署 ICF 服务（`abap extension deploy`）
- ICF 服务版本过期（`extension status` / `doctor` 报告 `outdated`）需要升级

## 决策树

```
看数据 / 跑类？
├── 看表数据 → select
│    ├── 全部行 → select --table T --limit N
│    ├── 部分列 → select --table T --fields "A,B" --limit N
│    ├── 仅计数 → select --table T --count-only
│    └── 翻页 → select --table T --order-by "ID:ASC" --limit 20 --offset 40
├── 跑 ABAP → run
│    ├── 直接 classrun（实现 if_oo_adt_classrun~main） → run ZCL_FOO
│    ├── 静态方法（需 wrapper） → run ZCL_FOO --method compute --args '{...}'
│    └── 业务码 → 读 data.exitCode（不是 CLI exit code）
└── ICF 服务状态？
    ├── 第一次 / 升级 → extension deploy --yes
    ├── 看会改什么 → extension deploy --dry-run / --diff
    └── 已部署但 run 报 WRAPPER_NOT_DEPLOYED → extension deploy --yes
```

## 注入安全（`abap select` 三层防线，必须严守）

1. **字段名白名单**：`--fields` / where / order-by 字段先对照 `DD03L` 校验并大写归一化
2. **值绑定**：where 值经解析后声明为 ABAP 变量，嵌入 `WHERE (lt_where)` 时以 `@lv_where_v1` 占位——**值永远不进 SQL 文本**
3. **整数边界**：`limit` / `offset` 由 JSON 解析后服务端 `CONV i` + 范围校验

注入载荷按字面值匹配或返回空集，**不**触发 SQL 注入。

## 错误恢复

| 错误 | 动作 |
|---|---|
| `WRAPPER_NOT_DEPLOYED` (exit 8) | `extension deploy --yes` 安装 `ZCL_ABAP_VIBE_RUNNER` |
| `WRAPPER_INPUT_UNAVAILABLE` (exit 6) | ADT classrun 不注入 `--method` 入参；改用直接 classrun 路径 |
| `METHOD_NOT_SUPPORTED` (exit 7) | 方法签名不可反射；改 wrapper 类签名 |
| `METHOD_FAILED` (exit 7) | 目标方法抛 `cx_root`；读 `data.parsed` 看异常 |
| `CLASS_NOT_RUNNABLE` (exit 7) | 类没实现 `if_oo_adt_classrun~main`；改用 `--method` 路径 |
| `OBJECT_NOT_ACTIVE` (exit 6) | 用 abap-edit 的 `activate <obj> --yes` |
| `LOCAL_CLASS_NOT_RUNNABLE` (exit 6) | 类名含 `~`（本地类）；用外部类 |
| `TIMEOUT` (exit 6) | `--timeout` 增大；或拆小循环 |
| `TABLE_NOT_FOUND` (exit 8) | `search <name>` 校对 |
| `TABLE_TYPE_NOT_SUPPORTED` (exit 7) | v1 仅 TABL+VIEW |
| `INVALID_FIELD` (exit 7) | `error.details.validFields` 取合法字段 |
| `INVALID_WHERE` (exit 7) | `error.details.offset` 指向解析失败位置 |
| `LIMIT_EXCEEDED` (exit 7) | `--limit` ∈ `[1, 10000]` |
| `OFFSET_EXCEEDED` (exit 7) | `--offset` ∈ `[0, 100000]` |
| `QUERY_FAILED` (exit 6) | 用 abap-edit 的 `activate <table>` |
| `ICF_CHECK_DEGRADED` | warning（meta.warnings），不阻断 |

## 通用规则

1. **`select` 完全可放心反复调用**：不修改表数据、不产生传输请求、不加锁
2. **`run --method` 前先 `extension deploy`**：若 `WRAPPER_NOT_DEPLOYED`，先 `extension deploy --yes`
3. **`run` 业务退出码 vs CLI 退出码**：`data.exitCode` 是**业务退出码**（SAP 端写），CLI 退出码是命令本身状态——`jq '.data.exitCode'` 读业务码
4. **`select --count-only` 比 `select --limit 99999` 快**：只取 `COUNT(*)`
5. **`extension deploy --dry-run` 先看 plan**：CI 部署前必看

## references（按需加载）

- [references/commands-quick.md](./references/commands-quick.md) — 3 命令完整速查
- [references/errors.md](./references/errors.md) — 错误码全表
- 权威来源：
  - <https://github.com/SAP/abap-cli/blob/main/wiki/commands/run.md>
  - <https://github.com/SAP/abap-cli/blob/main/wiki/commands/select.md>
  - <https://github.com/SAP/abap-cli/blob/main/docs/commands.md>

## assets / scripts

- [scripts/select-table.sh](./scripts/select-table.sh) — 包装 `select` 给 agent 用的便捷脚本（含分页/截断处理）
- [scripts/deploy-if-outdated.sh](./scripts/deploy-if-outdated.sh) — 仅 outdated 时才部署