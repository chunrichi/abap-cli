# abap-cli-edit — 8 命令完整速查（6 写 + mime + validate:aff）

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
abap push <file> --check-only                           # 仅语法检查（ICF JSON 不支持）
abap push <file> --no-activate                          # lock + write + skip
abap push <files...> --atomic --yes                     # 全量校验后写
abap push <files...> --fail-fast --yes                  # 失败即停
abap push <file> --dry-run                              # 计划模式（零 SAP 调用）
abap push src/zmy_table.tabl.json --tr DEVK900001 --yes # ICF JSON（DDIC / HTTP / TRAN）
abap push src/zprog/zprog.prog.texts.en.properties      # textpool
```

> 写操作：非 TTY 必须 `--yes` 或 `--dry-run`（`core/confirmation.ts` 统一守卫，exit 7）。
> **ICF JSON（DDIC / HTTP / TRAN）不支持 `--check-only`**（`VALIDATION_ERROR`；这类文件在 push 时校验）；`--dry-run` 对它们同样只做计划、零 ICF 调用。

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
| `<name>.<type>.json`（DDIC DOMA/DTEL/TABL/STRU） | icf（`POST /ddic/<type>`，push 前 GET 探测存在性） |
| `<name>.http.json` | icf（`POST /http/<name>`，**不探测存在性**：push 即创建/更新 SICF 节点） |
| `<name>.tran.json` | icf（`POST /tran/<code>`，push 前 GET 探测存在性） |
| `<name>.ttyp.json` / `.msag.json` / `.ddls.json` | 通道路由（ADT 分支）：`channel-detect` 决定 ADT / ICF |
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
|---|---|---|
| `<type>` | 对象类型（13 类：`CLAS / INTF / PROG / FUGR / TABL / STRU / DOMA / DTEL / TTYP / MSAG / DDLS / HTTP / TRAN`；`SRVB` 仅 pull；CDS/RAP 5 类支持完整 create） | 必填 |
| `<name>` | 对象名（命名空间 `Z` / `Y` / `/`） | 必填 |
| `--package <pkg>` | 目标包；默认 `$TMP` | `$TMP` |
| `--description <text>` | 对象描述（ICF 类型从各自的 `<name>.http.json` / `<name>.tran.json` 读 `generalInformation.description`） | — |
| `--tr <transport>` | transport 请求；非 `$TMP` 必填（除非对象已绑定） | — |
| `--template <name>` | 骨架模板（仅 ADT 源对象）：`empty` / `default` | `default` |
| `--no-activate` | 建完不激活（仅写 + 锁，不 activateAll） | false |
| `--no-pull` | 建完不拉完整源（用于 `create local` 离线草稿后导入） | false |
| `--file <path>` | abap-file-format JSON 输入（`TABL`/`STRU`/`DOMA`/`DTEL`/`HTTP`/`TRAN`/`TTYP`/`MSAG`/`DDLS`；`FUGR` 不需要）；TABL/STRU 三件套时指向 main `.tabl.json` | 必填（`TABL`/`STRU`/`DOMA`/`DTEL`/`HTTP`/`TRAN`/`TTYP`/`MSAG`/`DDLS`） |
| `--dir <path>` | `create local` 输出目录 | `./src/` |
| `--yes` | 跳过提示；非交互必填 | — |

## `abap activate`

激活一个对象的所有 inactive items（method / OSI 层级）。**不**改源、不写 transport——只触发 SAP 端 activation。

```bash
abap activate ZCL_FOO --yes                              # 按名字激活
abap activate ZCL_FOO --type CLAS --yes                  # 同前缀多对象时消歧
abap activate ZCL_FOO --schema                           # 参数自省（无 SAP 调用）
```

何时用：`push` 报 activated 但 `inspect --activation` 报 `ok: false`——method/OSI 层级没激活（013 落地经验：root-URI `activate` 在真实 SAP 上静默 no-op）；修复走 `activate --yes` 后再 `inspect --activation` 复核。

## `abap mime`

管理 SAP MIME Repository（SE80 MIME 存储库）的目录与文件。命令走自建 ICF handler `dispatch_mime`（`CL_MIME_REPOSITORY_API`）；**依赖 `deploy`**（handler 类 `ZCL_ABAP_VIBE_ICF` 部署后才可用）。

> **与 `abap deploy` 不同**：`deploy` 装内置 ICF ABAP handler；`mime` 是面向终端用户 MIME 资源的 CRUD。

```bash
# 建目录（默认 $TMP，无需 transport）
abap mime create /zntf_ui --package $TMP --description "UI root" --yes

# 删目录（非空须 --recursive）
abap mime delete /zntf_ui --recursive --tr NDK123456 --yes
abap mime delete /zntf_ui --recursive --dry-run          # 计划模式

# 传本地文件/目录到 MIME 根（每文件一次 POST）
abap mime push ./dist --root /zntf_ui/assets --tr NDK123456 --yes
abap mime push ./logo.png --root /zntf_ui/assets --yes    # 单文件

# 自省（无 SAP 调用）
abap mime --schema
```

| 子命令 | 用途 | 端点 | 关键 flag |
|---|---|---|---|
| `mime create <path>` | 建 root 或嵌套目录 | `POST /mime/folder` | `--package $TMP` `--description` `--tr` |
| `mime delete <path>` | 删目录（非空须 `--recursive`） | `PUT /mime/folder?recursive=&transport=` | `--recursive` `--tr` |
| `mime push <local>` | 上传本地文件/目录到指定 MIME 根 | `POST /mime/resources` | `--root <path>` `--tr` |

写操作保护（与 `deploy` / `transport` 一致）：

- **TTY**：无确认
- **非 TTY**：必须 `--yes` 或 `--dry-run`，否则 `VALIDATION_ERROR` (exit 7)
- **路径约束**：`<path>` 必须 `/` 开头；不允许 `..` 或尾部 `/`

## `abap validate:aff`

校验本地 JSON 是否满足 **官方 abap-file-format** 规范。13 个写路径类型（CLAS / INTF / PROG / FUGR / TABL / STRU / DOMA / DTEL / HTTP / TRAN / TTYP / MSAG / DDLS）共享同一套 ajv@^8 + Draft 2020-12；schema 来自 `src/abap_cli/schema/<type>-v1.json`（STRU 共享 `tabl-v1.json`；TABL/STRU `.settings.json` 走 `tabt-v1.json`）。

**纯本地，不进 SAP**；CI / pretest gate。`pretest` 默认扫 `test/fixtures/`。

```bash
# 默认扫 test/fixtures/（pretest 入口）
abap validate:aff

# 单文件
abap validate:aff test/fixtures/tabl/zmy_basic.tabl.json --json

# 多路径
abap validate:aff test/fixtures/ --wire tmp/s4h/wire/ --json

# 自省
abap validate:aff --schema
```

| flag | 含义 | 默认 |
|---|---|---|
| `<file-or-dir>` | 单文件或目录（递归 `.json`） | `test/fixtures/` |
| `--wire <wire-dir>` | 额外扫 wire payload 目录 | — |
| `--schema` | 参数自省（无 I/O） | — |

输出信封（`--json`）：

```jsonc
{
    "status": "success",
    "summary": { "pass": 32, "warn": 0, "fail": 0 },
    "files": [
        { "path": "test/fixtures/tabl/zt_x.tabl.json", "result": "PASS" },
        { "path": "test/fixtures/tabl/zt_y.tabl.json", "result": "FAIL",
          "errors": [{ "instancePath": "/fields/0/dataType", "keyword": "enum", "message": "must be one of ..." }] }
    ]
}
```

退出码：

| exit | 含义 |
|---|---|
| 0 | 全部 PASS（可含 WARN） |
| 1 | 至少一个 FAIL 或解析失败 |
| 2 | USAGE（未知 option / 缺参数） |