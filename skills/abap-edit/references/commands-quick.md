# abap-edit — 11 命令完整速查

> 按需加载。

## 源码对象主链路

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

文件名遵循 abap-file-format：`src/<name>/<name>.<type>.abap`（每对象一目录）或 `src/<name>.<type>.json`（DDIC）。

### `abap push`

```bash
abap push src/zcl_foo/zcl_foo.clas.abap --tr DEVK900001
abap push src/zcl_foo/zcl_foo.clas.abap                # 已绑定 / $TMP 无需 --tr
abap push --all                                         # 全部 .abap（遵循 .abapignore）
abap push <file> --check-only                           # 仅语法检查
abap push <file> --no-activate                          # lock + write + skip
abap push <files...> --atomic                           # 全量校验后写
abap push <files...> --fail-fast                        # 失败即停
abap push <file> --dry-run                              # 计划模式
abap push src/zmy_table.tabl.json --tr DEVK900001       # DDIC JSON
abap push src/zprog/zprog.prog.texts.en.properties      # textpool
```

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
abap check <file>                       # --syntax（默认，对 SAP）
abap check <file> --content             # 仅本地内容
abap check <file> --atc --out ./atc.json # ATC（持久化 worklist）
abap check --all
abap check <file> --json
```

| flag | 含义 |
|---|---|
| `--syntax`（默认） | 对 SAP 语法检查 |
| `--content` | 仅本地内容（不调 SAP） |
| `--atc` | SAP ATC 检查 |
| `--out [file]` | `--atc` 时持久化 worklist（默认 `./.abap/atc/<variant>-<ts>.json`） |

### `abap create`

```bash
abap create CLAS ZCL_NEW --package ZDEV --description "..." --tr DEVK900001
abap create CLAS ZCL_NEW --no-activate              # 不激活
abap create CLAS ZCL_NEW --template empty           # 自定义模板
abap create local CLAS ZCL_NEW --dir ./src          # 离线草稿
abap create TABL ZT_X --file ./zt_x.tabl.json --tr DEVK900001  # DDIC
abap create <type> --schema                         # 自省
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

### `abap sync`

链式 status / pull / push：

```bash
abap sync --status              # 默认
abap sync --pull                # 拉 missing
abap sync --push --yes          # 推 divergent（冲突保护）
abap sync --dry-run             # 计划
```

`--pull` / `--push` 冲突时**不**静默覆盖——报错给 agent 决策。

### `abap create local`

离线草稿（不连 SAP）：

```bash
abap create local CLAS ZCL_NEW --dir ./src
abap create local CLAS ZCL_NEW --template empty --dir ./src
abap create local CLAS ZCL_NEW --json
```

复用 `create` 的类型映射、模板注册、错误码。落 `src/<name>/<name>.<type>.abap`（abap-file-format 布局）。

## DDIC 子集

DDIC（DOMA / DTEL / TABL / STRU）走 ICF 服务 `/ddic/<type>`：

```bash
# 拉
abap pull ZT_X --type TABL
abap pull ZD_X --type DOMA

# 改
# 编辑 src/z_x.tabl.json

# 建（基于 JSON）
abap create TABL ZT_X --file ./zt_x.tabl.json --tr DEVK900001 --json

# 推
abap push src/z_x.tabl.json --tr DEVK900001
abap push src/z_d_x.doma.json                 # $TMP 无需 --tr
```

客户端校验：命名空间 `Z`/`Y` 开头、必填字段、`transportRequest`。

错误码：`DDIC_NOT_SUPPORTED` / `INVALID_FIELD` / `MISSING_FIELD` / `INVALID_NAMESPACE`（详见 references/errors.md）。