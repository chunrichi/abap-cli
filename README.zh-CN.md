# abap-cli

> **Vibe coding for ABAP.** 开发 ABAP 像写 TypeScript 一样：从本地文件编辑，走 CLI 同步进 SAP，由 AI agent 编排整个流程。

`abap-cli` 把 SAP ADT REST API 包成一条命令链。`pull` 拉对象到本地、`push` 把改动写回 SAP、`check` 做语法检查、`run` / `select` 直接在 SAP 里跑类 / 查表。每条命令都带 `--json` 输出，专为 AI agent 设计。

📖 **English version**: [README.md](README.md)

---

## 它解决什么问题

在 SAP 里改 ABAP 通常意味着：登录 GUI、开 SE80、找 transport、锁对象、改代码、激活、解锁。一个循环 5 分钟起步，且任何一步出错都要重来。

`abap-cli` 把这个循环压缩到一条命令：

```bash
abap pull ZCL_MY_CLASS          # 下载类到本地（含所有 include）
# 用你喜欢的编辑器改 zcl_my_class.clas.abap
abap push src/zcl_my_class/ --tr DEVK900001   # 锁 → 写 → 激活 → 解锁
```

需要写新对象？`create` 一条命令起骨架。语法检查？`check syntax` 不激活、不留锁。需要查表数据？`select` 是 SE16N 的等价物。想知道改动会冲击哪些对象？`where-used` 直接给引用清单。

更进一步：**所有命令都支持 `--json`**，所以 AI agent 能用 `abap-cli` 自己跑循环——`pull` → 改文件 → `check syntax` → `push` → `run` → 验证——不需要 GUI，不需要人在循环里。

---

## 为什么选它

| 你想要的 | 别的工具 | abap-cli |
|---|---|---|
| 在本地编辑器写 ABAP | 没有官方工具 | 单文件级 pull/push，带 lock + activate |
| 不开 SAP GUI 跑查询 | 只能 SE16N / SE16H | `abap select` 是 SE16N 等价，支持 `--where` / `--limit` / `--json` |
| AI agent 帮我改 ABAP | adt-cli 是给脚本的，不是给 agent 的 | 命令都带 `--json` 紧凑输出 + 结构化错误信封 + 退出码 |
| 创建 transport / 找 transport | 必须 SAP GUI | `abap transport list/create/assign` 在 CLI 里闭环 |
| 验证语法但不激活 | 没直接路径 | `abap check syntax` 只查不写，零副作用 |
| 跑一个 ABAP 类看结果 | SE80 / SE24 + 调试器 | `abap run <class>` 一条命令得到结果 |
| 函数组、include、DDIC 对象 | GUI 里手动处理 | `pull` / `push` / `create` 统一覆盖 CLAS/INTF/PROG/FUGR/DOMA/DTEL/TABL |

跟 `abap-adt-api`（Node SDK）比：`abap-cli` 是它的**产品化封装**——你不用写 Node 代码就能享受所有 ADT 能力，并且加了 `--json` 契约、错误码映射、transport 自动解析、DDIC via 自建 ICF 等 agent 友好的层。

---

## 30 秒上手

```bash
npm install -g abap-cli

# 1. 配置 SAP 连接（首次）
abap init                 # 交互向导：填 host / user / 密码 / package / transport
# 或者：abap profile add DEV --host vhcala4hci:50000 --user developer --client 001
#       abap init --profile DEV --yes

# 2. 拉一个对象到本地
abap pull ZCL_MY_CLASS

# 3. 编辑 src/zcl_my_class/zcl_my_class.clas.abap

# 4. 写回 SAP
abap push src/zcl_my_class/ --tr DEVK900001

# 5. 没 transport 的话现创一个
abap transport create "Feature X" --json
```

需要 agent 用？加 `--json` 或 `--pretty-json` 拿结构化输出。例：

```bash
abap search "*user*" --type CLAS --json
abap where-used ZCL_MY_CLASS --json
abap run ZCL_MY_HELPER --json
abap select --table SFLIGHT --fields CARRID CONNID --limit 5 --json
```

---

## 命令速查

| 命令 | 干什么 |
|---|---|
| `abap init` | 绑定工作区到 SAP profile（写 `.abap.json`），可调包 / transport / 源目录；裸跑进入交互向导 |
| `abap profile` | 管理全局连接 profile：`list` / `show` / `add` / `set` / `test` / `delete` / `export` / `import` |
| `abap pull <object>` | 下载源 / DDIC / HTTP 对象到本地（`--type`, `--package`, `--tr <transport>`, `--textpool`, `--remote`, `--overwrite`） |
| `abap push <files...>` | 把本地改动写回 SAP（`--tr`, `--check-only`, `--all`, `--atomic`, `--no-activate`, `--dry-run`, `--yes`） |
| `abap check syntax\|content\|atc <files...>` | 校验本地文件：syntax（走 SAP）/ content（本地）/ atc（`--variant`） |
| `abap search <query>` | 搜 ABAP 对象（`--type`, `--package`, `--exact`/`--fuzzy`, `--page-all`） |
| `abap create <type> <name>` | 在 SAP 新建源 / DDIC / HTTP 对象并激活（`--package`, `--description`, `--tr`, `--template`, `--file`） |
| `abap create local <type> <name>` | 离线生成草稿骨架（不连 SAP） |
| `abap transport list\|create\|show\|resolve\|assign` | transport 管理（写操作需 `--yes`） |
| `abap extension deploy\|status` | 部署 / 探测 SAP 侧 ICF 服务（DDIC / HTTP / tcode 解析的后端） |
| `abap doctor` | 诊断 CLI 环境（`--fix` 应用安全修复） |
| `abap inspect <object>` | 只读查对象元数据（`--structure` / `--includes` / `--locks` / `--activation`） |
| `abap activate <object>` | 激活对象（修陈旧未激活） |
| `abap diff [file]` | 本地 vs SAP 只读对比 |
| `abap status` | 看哪些对象有改动（`--remote-only` / `--local-only` / `--since` / `--all`） |
| `abap run <class>` | 跑 ABAP 类（classrun）或 PUBLIC STATIC 方法（`push → run → verify` 闭环） |
| `abap select --table <name>` | SE16N 等价的只读查表（`--fields` / `--where` / `--limit` / `--order-by` / `--count-only`） |
| `abap where-used <object>` | 对象直接引用查询（refactor 冲击评估） |
| `abap tcode <code>` | 事务码 → 入口程序 + 屏幕（TSTC → TSTCT） |

所有命令支持 `--json`（紧凑）和 `--pretty-json`（缩进）。

---

## 适用对象

- **CLAS / INTF / PROG / FUGR**：source 对象，全功能 pull/push/check/create/activate
- **DOMA / DTEL / TABL / STRU**：DDIC 对象（JSON 描述符），需先 `abap extension deploy` 一次
- **HTTP service**（`/sap/zabap_vibe/http/<name>`）：HTTP handler 对象
- **Read-only 查询**：`select` (TABL/VIEW) / `run` / `tcode` / `where-used` / `search` 不用部署 ICF

---

## 文档

- [docs/getting-started.md](docs/getting-started.md) — 安装 + 首次配置
- [docs/configuration.md](docs/configuration.md) — `.abap.json`、profile、环境变量
- [docs/commands.md](docs/commands.md) — 全命令 + flag 详解
- [docs/agent-integration.md](docs/agent-integration.md) — 给 AI agent 用：`--json` 契约、错误码、skill 编排
- [docs/architecture.md](docs/architecture.md) — 三层架构、扩展点（开发者向）
- [docs/development.md](docs/development.md) — 本地开发、测试、发布（贡献者向）

## License

MIT