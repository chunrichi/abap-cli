# abap-cli-search — 6 命令完整速查

> 按需加载。

## `abap search`

```bash
abap search ZCL_FOO                         # 基本搜索
abap search ZCL_FOO --type CLAS             # 类型过滤
abap search ZCL_FOO --package ZDEV          # 包过滤
abap search ZCL_FOO --exact                 # 精确匹配
abap search ZCL_* --page-all --max 1000     # 全量
abap search ZCL_FOO --schema                # 自省（零 SAP）
abap search ZCL_FOO --json
```

| flag | 含义 |
|---|---|
| `--type <type>` | 类型过滤（CLAS / PROG / INTF / FUGR / TABL / DOMA / DTEL） |
| `--package <pkg>` | 包过滤 |
| `--exact` | 精确匹配（去除 `*`） |
| `--page-all` | 自动分页取全量 |
| `--page <n>` | 单页号 |
| `--limit <n>` | 单页大小（默认 100） |
| `--max <n>` | `--page-all` 累积上限 |
| `--schema` | 自省 |

## `abap where-used`（重构冲击评估）

```bash
abap where-used ZCL_FOO --type CLAS --limit 100
abap where-used ZFG_FOO --type FUGR --limit 500
```

`data.references[]` 列直接调用者（含 `objectUrl` / `objectType` / `name` / `packageName`）。支持的类型：`CLAS` / `INTF` / `PROG` / `FUGR` / `TABL`。

| flag | 含义 | 默认 |
|---|---|---|
| `--type <type>` | 对象类型（CLAS / INTF / PROG / FUGR / TABL） | 必填或按对象回退 |
| `--limit <n>` | 结果上限 | `100` |
| `--offset <n>` | 分页偏移 | `0` |

`data.references[i].objectUrl` 是 `abap pull`（[abap-cli-edit]）的对象定位键。

## `abap inspect`

```bash
abap inspect ZCL_FOO --structure           # 对象结构
abap inspect ZCL_FOO --includes           # 所有 include
abap inspect ZCL_FOO --locks              # 锁信息
abap inspect ZCL_FOO --activation         # 激活状态
abap inspect ZCL_FOO --package            # 包归属
abap inspect ZCL_FOO --json
```

只读，不获取锁。`--activation` 是诊断线索；**修复**走 [abap-cli-edit] 的 `activate`。

## `abap tcode`

```bash
abap tcode ZEXAMPLE                        # 查 program/screen
abap tcode SE38 --json
```

| flag | 含义 |
|---|---|
| `--schema` | 自省（零 SAP） |

输出信封（`--json`）：

```jsonc
{
    "status": "success",
    "data": {
        "entry": {
            "tcode": "SE38",
            "program": "SAPLS38E",
            "screen": "0100",
            "title": "ABAP Editor"
        }
    }
}
```

## `abap diff`

```bash
abap diff src/zcl_foo.clas.abap
abap diff --all
abap diff --remote PRD
abap diff --local-only --limit 50
abap diff <file> --json
```

只读。返回 per-part `direction`（`same` / `local-only` / `remote-only` / `both-changed`）+ 行变化摘要。

## `abap status`

粗粒度本地 vs SAP 差异（changed parts 列表）。`diff` 的简化版。链式编排：

```bash
abap status --json          # 查看差异
abap pull <obj> --json      # 拉取 remote-only / divergent（[abap-cli-edit]）
abap push <file> --yes --json  # 推送 local changes（[abap-cli-edit]）
```

`pull` / `push` 遇到 divergent 时**不**静默覆盖——报错给 agent 决策。