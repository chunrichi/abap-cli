---
type: reference
title: SAP 开发任务覆盖率矩阵
description: abap-cli 当前能 / 不能完成的 SAP 开发任务全景 — 用于未来 spec 选题 + 用户预期管理
tags: [abap-cli, coverage, roadmap, scope]
created at: 2026-09-01 00:00:00
changed at: 2026-09-01 00:00:00
---

# SAP 开发任务覆盖率矩阵

abap-cli 的终极目标：**用 CLI + agent 覆盖绝大部分 SAP 内支持的开发工作**。本页是一份**诚实快照**——按 SAP 开发任务分类，给出当前覆盖度与缺口。

## 评分图例

| 图标 | 含义 |
|---|---|
| ✅ | 完整支持（含 `--json` + 错误码 + 退出码） |
| 🟡 | 部分支持（少数场景回退或绕过） |
| ⚪ | 仅只读查询（不写 SAP） |
| ❌ | 未实现 |

---

## 1. 对象类型 CRUD

| 任务 | 命令 | 覆盖 | 备注 |
|---|---|---|---|
| 创建 OO 类（CLAS） | `create CLAS` | ✅ | 含 template 骨架 |
| 修改 OO 类（CLAS） | `pull / push` | ✅ | lock → write → activate 闭环 |
| 创建接口（INTF） | `create INTF` | ✅ | |
| 创建报表程序（PROG） | `create PROG` | ✅ | 4 种 programType 都有 |
| 创建函数组（FUGR） | `create FUGR` | ✅ | 多文件布局 |
| 创建/修改 DDIC 域（DOMA） | `create / pull / push DOMA` | ✅ | ICF |
| 创建/修改 DDIC 数据元素（DTEL） | `create / pull / push DTEL` | ✅ | ICF |
| 创建/修改透明表（TABL） | `create / pull / push TABL` | ✅ | 三件套 + ICF |
| 创建/修改结构（STRU） | `create / pull / push STRU` | ✅ | 三件套 + ICF |
| 创建/修改 SICF 节点（HTTP） | `create / pull /push HTTP` | ✅ | ICF |
| 创建/修改事务码（SE93 / TRAN） | `create / pull TRAN` | ✅ | ICF，5 种 transactionType |
| Table Type（TTYP） | `create / pull / push TTYP` | ✅ | ADT 主通道；ECC EHP5/6 自动 ICF 兜底 |
| Pool/Cluster Table | — | ❌ | 仅 TABL/STRU |
| View（VIEW） | `select` 仅查 | ⚪ | 仅查询；不能创建 view |
| CDS View（DDLS） | `create / pull / push DDLS` | ✅ | 仅 ADT；ECC 旧内核硬错 `DDLS_NOT_SUPPORTED_ON_ECC` |
| CDS Table Function | — | ❌ | |
| AMDP 类 | — | ❌ | |
| Enhancement（ENHO / ENHS） | — | ❌ | |
| BAdI 定义/实现 | — | ❌ | |
| Package | `pull --package` 仅查 | ⚪ | 不能创建 package |
| 文本元素（textpool） | `pull --textpool` | ✅ | 但不与 push 链路一体 |
| 消息类（MSAG） | `create / pull / push MSAG` | ✅ | ADT 主通道；ECC EHP5/6 自动 ICF 兜底 |
| Lock Object | — | ❌ | |
| Search Help | — | ❌ | |
| Authorization Object | — | ❌ | |
| SAPscript / Smart Form | — | ❌ | |
| Web Dynpro | — | ❌ | |
| Adobe Form | — | ❌ | |
| IDoc / ALE 配置 | — | ❌ | |
| Workflow | — | ❌ | |
| XSLT（STRANS） | — | ❌ | |

**覆盖率**：CRUD 主体（CLAS / INTF / PROG / FUGR / DOMA / DTEL / TABL / STRU / HTTP / TRAN）= **10/10** ✅；高级对象（CDS / AMDP / Enhancement / BAdI / IDoc / Form / Workflow）= **0/7** ❌。

---

## 2. 运行时执行与查询

| 任务 | 命令 | 覆盖 | 备注 |
|---|---|---|---|
| 跑 OO 类（classrun） | `run <class>` | ✅ | 走 ADT /sap/bc/adt/oo/classrun |
| 跑 PUBLIC STATIC 方法 | `run <class> --method` | ✅ | 走 ICF wrapper（需 `extension deploy`） |
| SELECT 表数据 | `select --table` | ✅ | 走 ICF /data/query；最大 10000 行 |
| SELECT with WHERE / LIMIT / ORDER BY | `select --where --limit --order-by` | ✅ | 全功能 |
| COUNT-only | `select --count-only` | ✅ | |
| 翻页 OFFSET | `select --offset` | ✅ | 最大 offset 100000 |
| ST22 读 dumps | `dumps` | ✅ | 仅查询 |
| 事务码解析 | `tcode` | ✅ | TSTC → TSTCT；ICF |
| 单元测试运行 | — | ❌ | spec 候选；需要 ABAP Unit 集成 |
| ATC 静态检查 | `check atc` | ✅ | 但 `--variant` 必须已存在 |
| SE16N 等价 | `select` | ✅ | |
| SE16H（带 HINT） | — | ❌ | |
| SE11（数据浏览器） | — | ❌ | |
| SM37（作业） | — | ❌ | |
| ST05（SQL 跟踪） | — | ❌ | |
| STA（运行时统计） | — | ❌ | |

**覆盖率**：核心（classrun / select / dumps / tcode / atc）= **5/5** ✅；性能/调试（trace / job / SE16H）= **0/4** ❌。

---

## 3. 传输请求（Transport）

| 任务 | 命令 | 覆盖 | 备注 |
|---|---|---|---|
| 列出 transport | `transport list` | ✅ | --mine / --all / --open |
| 创建 transport | `transport create` | ✅ | --type workbench / customization |
| 查看 transport 详情 | `transport show` | ✅ | 含嵌套任务 |
| 解析 transport | `transport resolve` | ✅ | |
| 分配 transport | `transport assign` | ✅ | |
| 释放 / 解锁 transport | — | ❌ | spec 候选；SE01 等价 |
| 删除 transport | — | ❌ | spec 候选 |
| 拉取 transport 内全部对象 | `pull --tr` | ✅ | 024 实现 |
| 推送时绑定 transport | `push --tr` | ✅ | |

**覆盖率**：7/9（release / delete 缺）。

---

## 4. 元数据查询（只读）

| 任务 | 命令 | 覆盖 | 备注 |
|---|---|---|---|
| Quick Search | `search` | ✅ | 带 type/package/limit/page 过滤 |
| Object Structure | `inspect --structure` | ✅ | |
| Includes | `inspect --includes` | ✅ | |
| Locks | `inspect --locks` | ✅ | 查持有者 |
| Activation 状态 | `inspect --activation` | ✅ | 分 active / inactive |
| Where-used | `where-used` | ✅ | 直接引用 |
| Cross-reference（增强版） | — | ❌ | spec 候选；需要 REPS 全文扫描 |
| 包内对象列表 | `pull --package` | ✅ | |
| 对象差异（本地↔SAP） | `diff` | ✅ | |
| 工作区状态（哪些改了） | `status` | ✅ | --remote-only / --local-only |

**覆盖率**：9/10（cross-reference 缺）。

---

## 5. 跨系统与版本管理

| 任务 | 命令 | 覆盖 | 备注 |
|---|---|---|---|
| 拉取远端系统 active 版本 | `pull --remote <id>` | ✅ | 走 ICF `/version-source` |
| 远端版本未传输时返回空 | — | ✅ | `data.source === ''` |
| 拉取未激活版本 | — | ❌ | pull.md fixme：active vs latest 区分 |
| 跨 transport 迁移 | `pull NDK1 → push DEVK1` | ✅ | 命令组合 |
| 多 profile 切换 | `profile list/show/add` | ✅ | |
| 系统健康检查 | `profile test` | ✅ | 分层：TLS / AUTH / ADT / ICF |

**覆盖率**：5/6（latest/inactive 区分缺）。

---

## 6. 配置与连接

| 任务 | 命令 | 覆盖 | 备注 |
|---|---|---|---|
| 初始化 workspace | `init` | ✅ | 向导 / 非向导 |
| 添加 connection profile | `profile add` | ✅ | |
| 删除 profile | `profile delete` | ✅ | 非 TTY 需 --yes |
| 导入/导出 profile | `profile export/import` | ✅ | |
| Basic auth（user/password） | `profile add --auth basic` | ✅ | 密码在 OS keychain |
| Browser SSO 捕获 | `profile login` | ✅ | 127.0.0.1 loopback |
| OAuth password | `profile add --auth oauth_password` | ✅ | |
| Cert mTLS | `profile add --auth cert` | ✅ | 需 cert/key 文件 |
| 路径解析 | — | ✅ | BTP trial 包路径校验 |
| 配置刷新缓存 | `runtime-cache.ts` | ✅ | 自动 |

**覆盖率**：10/10 ✅。

---

## 7. ICF 扩展与代理（自托管后端）

| 任务 | 命令 | 覆盖 | 备注 |
|---|---|---|---|
| 部署 ICF 服务 | `extension deploy` | ✅ | on-prem / Steampunk / BTP trial |
| 检查 ICF 状态 | `extension status` | ✅ | 版本 + 已部署 |
| 解析 SICF 节点（HTTP 类型） | `pull / create / push HTTP` | ✅ | ICF |
| 解析事务码（TRAN 类型） | `pull / create / push TRAN` | ✅ | ICF |
| DDIC CRUD（DOMA/DTEL/TABL/STRU） | `pull / create / push` | ✅ | ICF |
| 数据查询（SELECT） | `select` | ✅ | ICF |
| classrun wrapper | `extension deploy` | ✅ | ZCL_ABAP_VIBE_RUNNER |
| tcode wrapper | `tcode` | ✅ | ICF |

**覆盖率**：8/8 ✅。

---

## 8. 扩展与插件（abap-cli 第三方）

| 任务 | 命令 | 覆盖 | 备注 |
|---|---|---|---|
| 安装 npm 扩展 | `extensions install` | 🟡 | spec 023；通过 lockfile + sha512 |
| 列出扩展 | `extensions list` | ✅ | 含 loaded / failed 状态 |
| 更新 lockfile | `extensions lock` | ✅ | `--allow-unsigned` 可选 |
| 命令扩展（type: command） | — | ✅ | 通过 `registerCommand` |
| 验证扩展（type: validation） | — | ✅ | dispatch beforeCommand |
| 生命周期扩展 | — | ✅ | dispatch beforeParse / afterCommand |
| 撤销扩展 | — | ❌ | spec 候选 |

**覆盖率**：5/6（撤销缺）。

---

## 9. 文档与诊断

| 任务 | 命令 | 覆盖 | 备注 |
|---|---|---|---|
| Doctor（环境诊断） | `doctor` | ✅ | `--fix` 自动修 |
| --schema（命令 schema 自描述） | `--schema` | ✅ | 全部 19 命令 |
| --json / --pretty-json | `--json / --pretty-json` | ✅ | 全部命令 |
| Skill bundle | `init --agent` | ✅ | copilot/claude/cursor/generic |
| Wiki | `wiki/` | ✅ | 32 篇 |
| Wiki + okf 自动生成 | `scripts/build-commands-doc.mjs` | ✅ | 单一事实源 |
| 错误码自描述 | `CliError.references` | ✅ | 指向 skills/.../references/errors.md |
| Release notes | `CHANGELOG.md` | ✅ | Keep a Changelog |

**覆盖率**：8/8 ✅。

---

## 10. 缺失的主要能力（按优先级）

| 缺失能力 | 候选 spec | 价值 | 工作量估计 |
|---|---|---|---|
| ABAP Unit 测试运行 | — | 高（端到端验证） | 中 |
| AMDP 类 | — | 中（数据库近计算） | 中 |
| Enhancement（ENHO / ENHS） | — | 中（遗留代码改造） | 中 |
| BAdI 定义/实现 | — | 中（扩展点） | 中 |
| Cross-reference / Where-used 全集 | — | 中（重构影响面） | 中（大） |
| Transport release / delete | — | 低（日常边缘） | 小 |
| Pull latest/inactive 版本 | pull.md fixme | 中（未激活修复） | 小 |
| `abap delete` | — | 中（生命周期闭合） | 中 |
| RAP / CAP 模型 | — | 低（云端专用） | 大 |
| IDoc / ALE / Workflow | — | 低 | 大 |
| Performance trace（ST05 / STA） | — | 低（性能调优） | 中 |
| Background job（SM36 / SM37） | — | 低（运维） | 中 |
| Authorization Object | — | 低（安全配置） | 中 |
| SAPscript / Smart / Adobe Form | — | 低（打印） | 中 |

**最值得做（高价值 + 中等工作量）**：ABAP Unit 测试运行、Enhancement、Cross-reference 全集、Pull latest/inactive 版本。

## AFF Fixture Coverage (spec 033 SC-005)

> Auto-generated by `scripts/build-aff-fixture-matrix.sh` from `npm run validate:aff --json test/fixtures/`.
> Last run: 2026-09-03T12:47:42.196Z

Per-type fixture-level schema validation. The matrix answers
`spec 033 SC-005`: 10 supported types × ≥ 1 fixture × official schema.

| Type | Fixtures | PASS | WARN | FAIL |
|------|----------|------|------|------|
| CLAS | 1 | 1 | 0 | 0 |
| INTF | 1 | 1 | 0 | 0 |
| PROG | 1 | 1 | 0 | 0 |
| FUGR | 5 | 5 | 0 | 0 |
| TABL | 10 | 10 | 0 | 0 |
| STRU | 3 | 3 | 0 | 0 |
| DOMA | 5 | 5 | 0 | 0 |
| DTEL | 3 | 3 | 0 | 0 |
| HTTP | 1 | 1 | 0 | 0 |
| TRAN | 1 | 1 | 0 | 0 |

### Schema paths

| Type | Schema file |
|------|-------------|
| CLAS | `tmp/abap-file-formats/file-formats/clas/clas-v1.json` |
| INTF | `tmp/abap-file-formats/file-formats/intf/intf-v1.json` |
| PROG | `tmp/abap-file-formats/file-formats/prog/prog-v1.json` |
| FUGR | `tmp/abap-file-formats/file-formats/fugr/fugr-v1.json` |
| TABL | `tmp/abap-file-formats/file-formats/tabl/tabl-v1.json` |
| STRU | `tmp/abap-file-formats/file-formats/tabl/tabl-v1.json` (alias) |
| DOMA | `tmp/abap-file-formats/file-formats/doma/doma-v1.json` |
| DTEL | `tmp/abap-file-formats/file-formats/dtel/dtel-v1.json` |
| HTTP | `tmp/abap-file-formats/file-formats/http/http-v1.json` |
| TRAN | `tmp/abap-file-formats/file-formats/tran/tran-v1.json` |

Companion files (TABL/STRU `.settings.json`) validate against `tabt-v1.json`.
PROG and HTTP fixtures are handcrafted (upstream abap-file-format 0.5.0
lacked examples at spec 033 cut-off).

---

# references

- 详细 wiki 索引：[`wiki/index.md`](index.md)
- 决策录：[`wiki/design-decisions/`](design-decisions/)
- 对象详细文档：[`wiki/objects/`](objects/)
- 命令文档：[`docs/commands.md`](../docs/commands.md)
- 端到端剧本：[`wiki/agent-cookbook.md`](agent-cookbook.md)
- 路线图草稿：[`wiki/roadmap.md`](roadmap.md)
