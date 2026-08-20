# abap-object — 13 命令完整速查

> 按需加载。

## 写路径 — 源码对象主链路

### `abap search`

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

### `abap where-used`（重构冲击评估）

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

`data.references[i].objectUrl` 是 `abap pull` 的对象定位键——调用方获得链接后可直接拉本地评估。

### `abap pull`

```bash
abap pull ZCL_FOO                                    # 单对象
abap pull ZCL_FOO --include-tests                    # 含 testclasses
abap pull ZCL_FOO --include-all-parts                # 含全部源码 part
abap pull ZFG --type FUGR                            # 函数组（main + TOP + 每个 FM）
abap pull ZCL_FOO --remote PRD                       # 远程系统 active 版本
abap pull ZCL_FOO --textpool                         # 文本元素（.properties）
abap pull --package ZDEV --limit 50 --page 1         # 包批量
abap pull ZT_X --type TABL                           # DDIC 定义
abap pull ZT_X --type TABL --overwrite               # 覆盖已存在
abap pull ZCL_FOO --skip-existing                    # 跳过已存在
abap pull --tr DEVK900001                            # T4.2: 拉请求下全部对象（直接 + 嵌套 task 去重）
```

| flag | 含义 |
|---|---|
| `--type <type>` | 对象类型（CLAS / PROG / INTF / FUGR / DOMA / DTEL / TABL / STRU） |
| `--dir <path>` | 输出目录（默认 `src/`） |
| `--package <pkg>` | 包批量（默认 20 / 页） |
| `--limit <n>` | 批量页大小 |
| `--page <n>` | 批量页号 |
| `--overwrite` | 允许覆盖本地文件 |
| `--skip-existing` | 跳过已存在 |
| `--include-tests` | 含 testclasses |
| `--include-all-parts` | 含全部 part |
| `--textpool` | 拉文本元素 |
| `--remote <id>` | 远程系统（Version Management） |
| `--tr <request>` | T4.2: 拉请求下全部对象；与对象名/`--package` **互斥**；空字符串 → `INVALID_ARGUMENT` |

文件名遵循 abap-file-format：`src/<name>/<name>.<type>.abap`（每对象一目录）或 `src/<name>.<type>.json`（DDIC）。

`--tr <request>`（T4.2）走 `transportDetails` 取直接 + 嵌套 task 对象，按 `type::name` 去重后逐个走对应路由（HTTP → ICF `/http/<name>`、DDIC → ICF `/ddic/<type>/<name>`、其余 → ADT）；单对象失败不中断，部分失败 `data.partial: true`。

### `abap push`

```bash
abap push src/zcl_foo/zcl_foo.clas.abap --tr DEVK900001 --yes
abap push src/zcl_foo/zcl_foo.clas.abap --yes          # 已绑定 / $TMP 无需 --tr；非 TTY 需 --yes
abap push --all --yes                                   # 全部 .abap（遵循 .abapignore）
abap push <file> --check-only                           # 仅语法检查
abap push <file> --no-activate                          # lock + write + skip
abap push <files...> --atomic --yes                     # 全量校验后写
abap push <files...> --fail-fast --yes                  # 失败即停
abap push <file> --dry-run                              # 计划模式（零 SAP 调用）
abap push src/zmy_table.tabl.json --tr DEVK900001 --yes # DDIC JSON
abap push src/zprog/zprog.prog.texts.en.properties      # textpool
```

> 写操作：非 TTY 必须 `--yes` 或 `--dry-run`（`core/confirmation.ts` 统一守卫，exit 7）。

#### 按对象 transport 解析（核心）

`runPush` 不在顶层统一解析 transport；`pushOne` 逐对象解析：

1. **对象已绑定请求**：复用该请求，无需 `--tr`；传不同 `--tr` 报 `VALIDATION_ERROR`
2. **`$TMP` 对象**：transport-free
3. **未绑定非 `$TMP`**：`--tr` > 项目 config > 用户第一个可修改请求 > `NO_TRANSPORT`

#### 文件路由

| 文件 | 路由 |
|---|---|
| `*.clas.abap` / `*.clas.<subtype>.abap` | adt（按 subtype 精确匹配 include） |
| `*.prog.abap` / `*.intf.abap` | adt |
| `*.fugr.abap` / `*.fugr.<fm>.func.abap` / `*.fugr.sapl*.reps.abap` | adt（FUGR 子对象独立锁） |
| `<name>.<type>.json`（DOMA/DTEL/TABL/STRU） | icf（`/ddic/<type>`） |
| `<name>.<type>.texts|selections|headings.<lang>.properties` | textpool（混合模式） |

### `abap check`

```bash
abap check syntax src/zcl_demo.clas.abap            # 对 SAP 语法检查（默认）
abap check content src/zcl_demo.clas.abap           # 仅本地内容（不调 SAP）
abap check atc src/zcl_demo.clas.abap --variant Z_ATC_VAR --out ./atc.json  # ATC
abap check --files src/zcl_demo.clas.abap           # 父命令快捷方式 = check syntax
abap check syntax --all
abap check syntax src/zcl_demo.clas.abap --json
```

| flag | 含义 |
|---|---|
| `syntax`（默认子命令） | 对 SAP 语法检查 |
| `content` | 仅本地内容（不调 SAP） |
| `atc` | SAP ATC 检查（`--variant` 必填） |
| `--out [file]` | `check atc` 时持久化 worklist（默认 `./.abap/atc/<variant>-<ts>.json`） |

### `abap create`

```bash
abap create CLAS ZCL_NEW --package ZDEV --description "..." --tr DEVK900001 --yes
abap create CLAS ZCL_NEW --no-activate --yes         # 不激活
abap create CLAS ZCL_NEW --template empty --yes      # 自定义模板
abap create local CLAS ZCL_NEW --dir ./src           # 离线草稿（不连 SAP，零 --yes）
abap create TABL ZT_X --file ./zt_x.tabl.json --tr DEVK900001 --yes  # DDIC
abap create <type> --schema                          # 自省（无 SAP 调用）
abap create <type> <name> --json
```

| flag | 含义 |
|---|---|
| `--package <pkg>` | 包（必填，源码对象） |
| `--description <desc>` | 描述 |
| `--tr <transport>` | transport |
| `--template <name>` | 模板 |
| `--no-activate` | 不激活 |
| `--no-pull` | 不自动 pull |
| `--check-only` | 仅检查（不调 SAP） |
| `--audit` | 输出审计报告 |
| `--file <path>` | DDIC JSON 文件路径 |
| `--dir <path>` | `create local` 输出目录 |
| `--schema` | 自省 |
| `--yes` | 非 TTY 写操作确认（`core/confirmation.ts` 统一守卫） |

### `abap activate`

```bash
abap activate ZCL_FOO --yes
abap activate ZCL_FOO --type CLAS --yes    # 同名多类型消歧
abap activate ZCL_FOO --json
```

激活对象**所有** inactive items（method/OSI 层级）。不涉及 transport 变更（故无 `--tr`）。

### `abap inspect`

```bash
abap inspect ZCL_FOO --structure           # 对象结构
abap inspect ZCL_FOO --includes           # 所有 include
abap inspect ZCL_FOO --locks              # 锁信息
abap inspect ZCL_FOO --activation         # 激活状态
abap inspect ZCL_FOO --package            # 包归属
abap inspect ZCL_FOO --json
```

只读，不获取锁。

### `abap diff`

```bash
abap diff src/zcl_foo.clas.abap
abap diff --all
abap diff --remote PRD
abap diff --local-only --limit 50
abap diff <file> --json
```

只读。返回 per-part `direction`（`same` / `local-only` / `remote-only` / `both-changed`）+ 行变化摘要。

### `abap status`

粗粒度本地 vs SAP 差异（changed parts 列表）。`diff` 的简化版。

### 链式编排（`abap sync` 已移除）

`abap sync` 在 021 已移除。Agent 应显式编排：

```bash
abap status --json          # 查看差异
abap pull <obj> --json      # 拉取 remote-only / divergent
abap push <file> --yes --json  # 推送 local changes（冲突时保护）
```

`pull` / `push` 遇到 divergent 时**不**静默覆盖——报错给 agent 决策。

### `abap create local`

离线草稿（不连 SAP）：

```bash
abap create local CLAS ZCL_NEW --dir ./src
abap create local CLAS ZCL_NEW --template empty --dir ./src
abap create local CLAS ZCL_NEW --json
```

复用 `create` 的类型映射、模板注册、错误码。落 `src/<name>/<name>.<type>.abap`（abap-file-format 布局）。

## 只读消费路径

### `abap run`（015）

```bash
# 直接 classrun（实现 if_oo_adt_classrun~main）
abap run ZCL_FOO

# 调用 PUBLIC STATIC 方法（需 deploy wrapper，见 abap-setup）
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

#### 输出信封（`--json`）

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

#### 两条路径

| 路径 | 触发 | 条件 |
|---|---|---|
| **classrun** | 不传 `--method` | 类实现 `if_oo_adt_classrun~main` |
| **wrapper** | 传 `--method` | 部署 `ZCL_ABAP_VIBE_RUNNER`（`abap extension deploy`，见 abap-setup） |

**已知限制**（vhcala4hci 验证）：ADT classrun 端点**不注入** `--method` 入参——此时 `WRAPPER_INPUT_UNAVAILABLE`，应改用直接 classrun 路径。

### `abap select`（016）

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

#### flag 全表

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

#### where 语法（v1）

```
FIELD OP VALUE [AND FIELD OP VALUE ...]

OP ∈ { =, <>, >, >=, <, <=, LIKE }
VALUE:
  - 字符串：单引号（`''` 转义单引号）
  - 数字：裸写
  - 日期：`YYYYMMDD`（自动转 `YYYY-MM-DD` 输出）
```

**禁止**：OR / 括号 / 函数调用 / 子查询 / 显式 MANDT 过滤。

#### 输出信封（`--json`）

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

#### 017 原生行值（service 0.4.0）

`data.rows` 单元格遵循 `/ui2/cl_json` 原生序列化：

- **NUMC / INT / DEC**：JSON 数字（前导零丢失）
- **DATS**：`YYYY-MM-DD`
- **TIMS**：`HH:MM:SS`
- **CHAR / CLNT**：字符串
- **字段名**：大写（DDIC 顺序，与 `data.fields` 一致）

Agent 消费时每单元格按 `string | number | boolean | null` 处理。

### `abap tcode`

```bash
abap tcode ZEXAMPLE                        # 查 program/screen
abap tcode SE38 --json
```

| flag | 含义 |
|---|---|
| `--schema` | 自省（零 SAP） |

#### 输出信封（`--json`）

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
