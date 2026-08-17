# abap-data — 3 命令完整速查

> 按需加载。

## `abap run`（015）

```bash
# 直接 classrun（实现 if_oo_adt_classrun~main）
abap run ZCL_FOO

# 调用 PUBLIC STATIC 方法（需 deploy wrapper）
abap run ZCL_HELPER --method compute --args '{"x":3,"y":5}'

# 看 JSON 化输出
abap run ZCL_FOO --method bar --args '{}' --json

# 计划模式（零 SAP 调用）
abap run ZCL_LONG --dry-run

# 自省（不调 SAP）
abap run --schema

# 超时控制（100-600000 ms，默认 30000）
abap run ZCL_FOO --timeout 60000
```

### 输出信封（`--json`）

```jsonc
{
    "status": "success",
    "meta": { "command": "abap run", ... },
    "data": {
        "route": "classrun" | "wrapper",
        "output": "<stdout verbatim>",
        "parsed": "<JSON parsed output or null>",
        "exitCode": <业务退出码，区别于 CLI 退出码>,
        "durationMs": <ms>
    }
}
```

### 两条路径

| 路径 | 触发 | 条件 |
|---|---|---|
| **classrun** | 不传 `--method` | 类实现 `if_oo_adt_classrun~main` |
| **wrapper** | 传 `--method` | 部署 `ZCL_ABAP_VIBE_RUNNER`（`abap extension deploy`） |

**已知限制**（vhcala4hci 验证）：ADT classrun 端点**不注入** `--method` 入参——此时 `WRAPPER_INPUT_UNAVAILABLE`，应改用直接 classrun 路径。

## `abap select`（016）

```bash
# 基础查询
abap select --table ZTAB --where "STATUS = 'X'" --limit 50

# 字段投影 + 排序 + 分页
abap select --table ZTAB --fields "ID,AMOUNT" --order-by "ID:ASC" --limit 20 --offset 40

# 仅计数
abap select --table ZTAB --where "AMOUNT > 100" --count-only

# 自省（不调 SAP）
abap select --schema

# 计划模式
abap select --table ZTAB --where "..." --dry-run
```

### flag 全表

| flag | 含义 | 范围 |
|---|---|---|
| `--table <name>` | 目标表/视图（必填，大写） | — |
| `--fields <csv>` | 投影字段 | regex `^[A-Za-z_][A-Za-z0-9_]*$` |
| `--where <clause>` | 过滤 | `FIELD OP VALUE [AND ...]`，≤2000 字符 |
| `--limit <n>` | 行数上限 | `[1, 10000]`，默认 100 |
| `--offset <n>` | 偏移 | `[0, 100000]`，默认 0 |
| `--order-by <csv>` | 排序 | `FIELD:ASC\|DESC` |
| `--count-only` | 仅返回 count | — |
| `--dry-run` | 计划模式 | — |
| `--schema` | 自省 | — |

### where 语法（v1）

```
FIELD OP VALUE [AND FIELD OP VALUE ...]

OP ∈ { =, <>, >, >=, <, <=, LIKE }
VALUE:
  - 字符串：单引号（`''` 转义单引号）
  - 数字：裸写
  - 日期：`YYYYMMDD`（自动转 `YYYY-MM-DD` 输出）
```

**禁止**：OR / 括号 / 函数调用 / 子查询 / 显式 MANDT 过滤。

### 输出信封（`--json`）

```jsonc
{
    "status": "success",
    "meta": { "command": "abap select", ... },
    "data": {
        "table": "ZTAB_FIXTURE",
        "objectType": "TABL",
        "fields": ["MANDT", "ID", "STATUS", "AMOUNT", "NAME", "CREATED"],
        "rows": [
            { "MANDT": "001", "ID": 1, "STATUS": "X", "AMOUNT": 1,
              "NAME": "Item 0000000001", "CREATED": "2026-02-01" }
        ],
        "rowCount": 50,
        "truncated": true,
        "excludedFields": ["NOTE"],
        "offset": 0,
        "limit": 50,
        "countOnly": false,
        "dryRun": false,
        "durationMs": 42
    }
}
```

### 017 原生行值（service 0.4.0）

`data.rows` 单元格遵循 `/ui2/cl_json` 原生序列化：

- **NUMC / INT / DEC**：JSON 数字（前导零丢失）
- **DATS**：`YYYY-MM-DD`
- **TIMS**：`HH:MM:SS`
- **CHAR / CLNT**：字符串
- **字段名**：大写（DDIC 顺序，与 `data.fields` 一致）

Agent 消费时每单元格按 `string | number | boolean | null` 处理。

## `abap extension deploy`（013）

```bash
# 部署 / 升级 bundled ICF 服务（默认 $TMP 无需 --tr）
abap extension deploy --yes

# 计划部署（零变更）
abap extension deploy --dry-run

# 看会改什么
abap extension deploy --diff

# 部署到非 $TMP 包（需 --tr）
abap extension deploy --package ZABAP_VIBE --tr DEVK900001 --yes
```

### 输出信封（`--json`）

```jsonc
{
    "status": "success",
    "data": {
        "icfNode": {
            "status": "deployed" | "planned" | "unchanged" | "failed",
            "path": "/sap/zabap_vibe"
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

### ICF 服务版本

- 0.1.0 → CLI `ICF_SERVICE_VERSION` / handler `gc_version`
- `abap extension deploy` 自动创建/更新 `ZCL_ABAP_VIBE_ICF` + `ZCL_ABAP_VIBE_ICF_SETUP` + `ZCL_ABAP_VIBE_RUNNER`（013 + 015 + 016 + 017 累积）

### 状态流转

| `extension status` 状态 | 推荐动作 |
|---|---|
| `not_deployed` | `abap extension deploy --yes` |
| `current` | 跳过 |
| `outdated` | `abap extension deploy --yes`（升级） |
| `unreachable` | 不阻断；查 `meta.warnings` 找原因（ICF_CHECK_DEGRADED） |