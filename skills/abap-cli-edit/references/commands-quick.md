# abap-cli-edit — 6 命令完整速查

> 按需加载。本文件覆盖写路径：`pull` / `push` / `check` / `create` / `activate` / `create local`。

## `abap pull`

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
abap pull --tr DEVK900001                            # T4.2: 拉请求下全部对象
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
| `--tr <request>` | T4.2: 拉请求下全部对象；与对象名/`--package` **互斥** |

文件名遵循 abap-file-format：`src/<name>/<name>.<type>.abap`（每对象一目录）或 `src/<name>.<type>.json`（DDIC）。

`--tr <request>`（T4.2）走 `transportDetails` 取直接 + 嵌套 task 对象，按 `type::name` 去重后逐个走对应路由；单对象失败不中断，部分失败 `data.partial: true`。

## `abap push`

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

### 按对象 transport 解析（核心）

`runPush` 不在顶层统一解析 transport；`pushOne` 逐对象解析：

1. **对象已绑定请求**：复用该请求，无需 `--tr`；传不同 `--tr` 报 `VALIDATION_ERROR`
2. **`$TMP` 对象**：transport-free
3. **未绑定非 `$TMP`**：`--tr` > 项目 config > 用户第一个可修改请求 > `NO_TRANSPORT`（跳 `abap-cli-setup`）

### 文件路由

| 文件 | 路由 |
|---|---|
| `*.clas.abap` / `*.clas.<subtype>.abap` | adt（按 subtype 精确匹配 include） |
| `*.prog.abap` / `*.intf.abap` | adt |
| `*.fugr.abap` / `*.fugr.<fm>.func.abap` / `*.fugr.sapl*.reps.abap` | adt（FUGR 子对象独立锁） |
| `<name>.<type>.json`（DOMA/DTEL/TABL/STRU） | icf（`/ddic/<type>`） |
| `<name>.<type>.texts|selections|headings.<lang>.properties` | textpool（混合模式） |

## `abap check`

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

## `abap create`

```bash
abap create CLAS ZCL_NEW --package ZDEV --description "..." --tr DEVK900001 --yes
abap create CLAS ZCL_NEW --no-activate --yes         # 不激活
abap create CLAS ZCL_NEW --template empty --yes      # 自定义模板
abap create local CLAS ZCL_NEW --dir ./src           # 离线草稿（不连 SAP，零 --yes）
abap create TABL ZT_X --file ./src/tabl/zt_x.tabl.json --tr DEVK900001 --yes  # DDIC（abap-file-format 三件套；详见 workflow.md 变体 2）

# TABL/STRU 的 --file 指向 main JSON，CLI 自动读取同目录的同名 .tabl.ddic（DDL 源）与 .tabl.settings.json
# 三件齐全时走 abap-file-format 规范；只有 main JSON 时回落 wire-flat 单文件（向后兼容 014）
abap create <type> --schema                          # 自省（无 SAP 调用）
abap create <type> <name> --json
```

| flag | 含义 |
|---|---|