---
type: reference
title: SAP 开发任务覆盖率矩阵
description: abap-cli 当前能 / 不能完成的 SAP 开发任务全景 — 用于未来 spec 选题 + 用户预期管理
tags: [abap-cli, coverage, roadmap, scope]
created at: 2026-09-01 00:00:00
changed at: 2026-10-31 18:00:00
---

# SAP 开发任务覆盖率矩阵

abap-cli 的终极目标：**用 CLI + agent 覆盖绝大部分 SAP 内支持的开发工作**。本页是一份**诚实快照**——按 SAP 开发任务分类，给出当前覆盖度与缺口。对象类型补充的排序与取舍见 [roadmap](roadmap.md)。

> 当前规模：**29 个顶层命令**、**23 个对象类型**（21 类可 create、23 类可 pull、21 类有 push 入口）、**6 个 skill + 1 个 agent**。基线：`v1.0.0` + 后续 Unreleased 改动。

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
| 创建报表程序（PROG） | `create PROG` | ✅ | 多种 programType + 模板 |
| 创建函数组（FUGR） | `create FUGR` | ✅ | 多文件布局；`--func` 建 FM |
| 创建/修改 DDIC 域（DOMA） | `create / pull / push DOMA` | ✅ | ICF |
| 创建/修改 DDIC 数据元素（DTEL） | `create / pull / push DTEL` | ✅ | ICF |
| 创建/修改透明表（TABL） | `create / pull / push TABL` | ✅ | 三件套 + ICF；AFF 不覆盖索引 |
| 创建/修改结构（STRU） | `create / pull / push STRU` | ✅ | 三件套 + ICF |
| 创建/修改锁对象（ENQU） | `create / pull / push ENQU` | ✅ | ICF；`create --file` |
| 创建/修改编号范围对象（NROB） | `create / pull / push NROB` | ✅ | pull 主 ADT + ICF 兜底；`create --file` |
| 创建/修改 SICF 节点（HTTP） | `create / pull / push HTTP` | ✅ | ICF |
| 创建/修改事务码（SE93 / TRAN） | `create / pull / push / delete TRAN` | ✅ | ICF `/tran` GET/POST/PUT/DELETE；dialog/report/parameter/variant，OO 明确拒绝；真机 23/23 TC |
| Table Type（TTYP） | `create / pull / push TTYP` | ✅ | ADT 主通道；ECC 自动 ICF 兜底 |
| 消息类（MSAG） | `create / pull / push MSAG` | ✅ | ADT 主通道；ECC 自动 ICF 兜底 |
| CDS View（DDLS） | `create / pull / push DDLS` | ✅ | 仅 ADT；ECC 旧内核硬错 `DDLS_NOT_SUPPORTED_ON_ECC` |
| Service Definition（SRVD） | `create / pull / push SRVD` | ✅ | ADT；`create --file` |
| Access Control（DCLS） | `create / pull / push DCLS` | ✅ | ADT；`create --file` |
| Metadata Extension（DDLX） | `create / pull / push DDLX` | ✅ | ADT；`create --file` |
| Annotation Definition（DDLA） | `create / pull / push DDLA` | ✅ | ADT；`create --file` |
| Behavior Definition（BDEF） | `pull / push BDEF` | 🟡 | SAP 不接受 CLI 创建（无 ADT create 端点），只能 pull / push |
| Service Binding（SRVB） | `pull SRVB` | ⚪ | metadata-only；binding 在 SAP GUI 管理 |
| Pool/Cluster Table | — | ❌ | 仅 TABL/STRU |
| 创建/修改数据库视图（VIEW） | `create / pull / push / delete VIEW` | 🟡 | ICF `/ddic/view`；自建 `view-v1.json`（本地扩展）；DD25V/DD26V/DD27P/DD28J 全量映射；删除仅 `$TMP`；**真机验证待补**（ABAP deploy 需 stateful 会话，恢复后按六阶段补证） |
| Search Help（SHLP） | — | ❌ | 候选补充类型，见 roadmap |
| Authorization Object / Field（AUTH / SUSO） | — | ❌ | 候选补充类型，见 roadmap |
| Enhancement（ENHO / ENHS） | — | ❌ | 候选补充类型，见 roadmap |
| BAdI 定义/实现 | — | ❌ | 可用 `where-used` 查引用 |
| AMDP 类 / CDS Table Function | — | ❌ | |
| 创建/删除包（DEVC） | `create / pull / delete DEVC` | ✅ | ADT `DEVC/K`；软件组件 LOCAL 的包名须以 `$`/`TEST` 开头；**push 不支持**（ADT 拒绝 `PUT`），改包需 SAP GUI 或删后重建 |
| 文本元素（textpool） | `pull --textpool` / `push *.texts.*.properties` | 🟡 | 读可用；写依赖系统 ADT text-elements 写端点，旧系统（如 A4H/ECC）走 ICF 写桩时返回 `TEXTPOOL_WRITE_UNSUPPORTED` |
| XSLT / STRANS | — | ❌ | 候选补充类型，见 roadmap（`/version-source` 只读版本管理已含 XSLT） |
| SAPscript / Smart Form / Adobe Form | — | ❌ | |
| Web Dynpro / ITS / BSP | — | ❌ | |
| IDoc / ALE 配置 | — | ❌ | |
| Workflow | — | ❌ | |

**覆盖率**：基础开发对象（CLAS / INTF / PROG / FUGR / DOMA / DTEL / TABL / STRU / ENQU / VIEW / NROB / HTTP / TTYP / MSAG / DDLS / CDS-RAP 5 类）已形成 create/pull/push 闭环（VIEW 真机待补）；`DEVC` 的 create / pull / delete 闭环也已打通（push 因 ADT 无更新端点而不支持）。

高级/遗留对象（SHLP / AUTH / ENHO-ENHS / BAdI / AMDP / forms / Web Dynpro / IDoc / Workflow / XSLT）= **0/10** ❌；VIEW 已从 ❌ 推进到 🟡（CLI/ABAP/mock 全链路完成，真机证据待补）。

---

## 2. 运行时执行与查询

| 任务 | 命令 | 覆盖 | 备注 |
|---|---|---|---|
| 跑 OO 类（classrun） | `run <class>` | ✅ | 走 ADT /sap/bc/adt/oo/classrun |
| 跑 PUBLIC STATIC 方法 | `run <class> --method` | ✅ | 走 ICF wrapper（需 `deploy`） |
| **跑 ABAP Unit 测试** | `test <object>` | ✅ | ADT ABAP Unit `/sap/bc/adt/abapunit/testruns`；只输出汇总 + 失败项，`--strict` 让告警也失败 |
| SELECT 表数据 | `select --table` | ✅ | 走 ICF /data/query；最大 10000 行 |
| SELECT with WHERE / LIMIT / ORDER BY | `select --where --limit --order-by` | ✅ | 全功能 |
| COUNT-only | `select --count-only` | ✅ | |
| 翻页 OFFSET | `select --offset` | ✅ | 最大 offset 100000 |
| 表字段清单 / 反查 | `fields` | ✅ | DD03L / DD02L；`--find` 反查 |
| ST22 读 dumps | `dumps` | ✅ | 仅查询 |
| 事务码解析 | `tcode` | ✅ | TSTC → TSTCT；ICF |
| ATC 静态检查 | `check atc` | ✅ | `--variant` 必须已存在 |
| SE16N 等价 | `select` | ✅ | |
| SE16H（带 HINT） | — | ❌ | |
| SE11（数据浏览器） | — | ⚪ | 对象元数据走 `inspect`；DDIC 读写走 create/pull/push |
| SM37（作业） | — | ❌ | |
| ST05（SQL 跟踪） | — | ❌ | |
| STA（运行时统计） | — | ❌ | |

**覆盖率**：核心（classrun / ABAP Unit / select / fields / dumps / tcode / atc）= **7/7** ✅；性能/调试（trace / job / SE16H）= **0/3** ❌。

---

## 3. 传输请求（Transport）

| 任务 | 命令 | 覆盖 | 备注 |
|---|---|---|---|
| 列出 transport | `transport list` | ✅ | 仅 `--open`（无 `--mine` / `--all`） |
| 创建 transport | `transport create` | ✅ | `--type workbench / customization` |
| 查看 transport 详情 | `transport show` | ✅ | 含嵌套任务 |
| 解析 transport | `transport resolve` | ✅ | |
| 分配 transport | `transport assign` | ✅ | |
| 释放 / 解锁 transport | — | ❌ | 待办（本轮按约定不做） |
| 删除 transport | — | ❌ | 待办（本轮按约定不做） |
| 拉取 transport 内全部对象 | `pull --tr` | ✅ | |
| 推送时绑定 transport | `push --tr` | ✅ | |

**覆盖率**：7/9（release / delete 缺，属"请求管理"范围，本轮明确不做）。

---

## 4. 元数据查询（只读）

| 任务 | 命令 | 覆盖 | 备注 |
|---|---|---|---|
| Quick Search | `search` | ✅ | 带 type/package/limit/page 过滤 |
| Object Structure | `inspect --structure` | ✅ | |
| Includes | `inspect --includes` | ✅ | |
| Locks | `inspect --locks` | ✅ | 查持有者 |
| Activation 状态 | `inspect --activation` | ✅ | 分 active / inactive |
| Where-used | `where-used` | ✅ | 直接引用（对象级，非全文扫描） |
| Cross-reference（增强版） | — | ❌ | 需要 REPS 全文扫描 |
| 包内对象列表 | `pull --package` / `list` | ✅ | |
| 对象差异（本地↔SAP） | `diff` | ✅ | |
| 工作区状态（哪些改了） | `status` | ✅ | `--remote-only` / `--local-only` |
| 对象生命周期收尾 | `delete` | ✅ | lock → delete → unlock；非 `$TMP` 需 `--tr` |

**覆盖率**：10/11（cross-reference 缺）。

---

## 5. 跨系统与版本管理

| 任务 | 命令 | 覆盖 | 备注 |
|---|---|---|---|
| 拉取远端系统 active 版本 | `pull --remote <id>` | ✅ | 走 ICF `/version-source` |
| 拉取 local/latest 版本 | `pull`（默认） | ✅ | 当前工作区版本（未激活改动） |
| 拉取 active 版本 | `pull --active` | ✅ | 与 latest 区分，配合 `inspect --activation` 使用 |
| 远端版本未传输时返回空 | — | ✅ | `data.source === ''` |
| 跨 transport 迁移 | `pull NDK1 → push DEVK1` | ✅ | 命令组合 |
| 多 profile 切换 | `profile list/show/add` | ✅ | |
| 系统健康检查 | `profile test` | ✅ | 分层：TLS / AUTH / ADT / ICF |

**覆盖率**：7/7 ✅。

---

## 6. 配置与连接

| 任务 | 命令 | 覆盖 | 备注 |
|---|---|---|---|
| 初始化 workspace | `init` | ✅ | 向导 / 非向导 |
| 添加 connection profile | `profile add` | ✅ | |
| 删除 profile | `profile delete` | ✅ | 非 TTY 需 --yes |
| 导入/导出 profile | `profile export/import` | ✅ | |
| Basic auth（user/password） | `profile add --password` | ✅ | 唯一登录方式；密码在 OS keychain |
| 历史 auth profile 迁移 | `profile show/set` | ✅ | 旧 cert/SSO/OAuth profile → basic |
| 路径解析 | — | ✅ | BTP trial 包路径校验 |
| 会话 cookie 查看 | `session info` | ✅ | 只读 |
| AFF 校验 | `validate:aff` | ✅ | 本地官方 schema 校验 |

**覆盖率**：9/9 ✅。

---

## 7. ICF 扩展与代理（自托管后端）

| 任务 | 命令 | 覆盖 | 备注 |
|---|---|---|---|
| 部署 ICF 服务 | `deploy` | ✅ | on-prem / Steampunk / BTP trial；`--dev` 开发形态 |
| 检查 ICF 状态 | `deploy status` | ✅ | 版本 + 已部署 |
| DDIC CRUD（DOMA/DTEL/TABL/STRU/ENQU/NROB） | `pull / create / push` | ✅ | ICF；`/ddic/<type>` |
| 双通道 DDIC（TTYP/MSAG） | `pull / create / push` | ✅ | ADT 主 + ECC ICF 兜底 |
| 解析 SICF 节点（HTTP 类型） | `pull / create / push HTTP` | ✅ | ICF |
| 解析事务码（TRAN 类型） | `pull / create / push / delete TRAN` | ✅ | 读写闭环；删除仅 `$TMP`（见 §1） |
| 数据查询（SELECT） | `select` / `fields` | ✅ | ICF |
| 报表运行 | `run-report` | ✅ | ICF；经典 list，5000 行/200k 字符 |
| classrun wrapper | `deploy` | ✅ | ZCL_ABAP_VIBE_RUNNER |
| tcode wrapper | `tcode` | ✅ | ICF |
| MIME Repository | `mime create / delete / push` | ✅ | ICF；当前只有 folder/resources 两类端点 |

**覆盖率**：11/11（TRAN 写路径已实现；OO 事务按规范拒绝）。

---

## 8. 文档与诊断

| 任务 | 命令 | 覆盖 | 备注 |
|---|---|---|---|
| Doctor（环境诊断） | `doctor` | ✅ | `--fix` 自动修 |
| --schema（命令 schema 自描述） | `--schema` | ✅ | 全部 29 命令 |
| --json / --pretty-json | `--json / --pretty-json` | ✅ | 全部命令 |
| Skill bundle | `init --agent` | ✅ | copilot/claude/cursor/generic |
| Wiki | `wiki/` | ✅ | 69 篇（命令页 29 个） |
| 命令文档生成 | `scripts/gen-docs.mjs`（docs:check 入 verify） | ✅ | 单一事实源 |
| 错误码自描述 | `CliError.references` | ✅ | 指向 skills/.../references/errors.md |
| Release notes | `CHANGELOG.md` | ✅ | Keep a Changelog |

**覆盖率**：8/8 ✅。

---

## 9. 缺失的主要能力（按优先级）

| 缺失能力 | 价值 | 工作量 | 状态 / 去向 |
|---|---|---|---|
| VIEW（DDIC 视图） | 高 | 中 | 候选补充类型（ICF `DDIF_VIEW_GET/PUT` 路线），见 roadmap |
| SHLP（搜索帮助） | 高 | 中 | 候选补充类型（ICF `DDIF_SHLP_GET/PUT` 路线），见 roadmap |
| DEVC（Package 创建/管理） | 高 | 小-中 | 候选补充类型（ADT `DEVC/K`），见 roadmap |
| XSLT（转换） | 中 | 中 | 候选补充类型（ICF `CL_O2_API_XSLTDESC` 路线），见 roadmap |
| ENHO / ENHS（增强） | 中-高 | 大 | 先只读 pull，再 push；见 roadmap |
| AUTH / SUSO 授权对象 | 中 | 中-大 | 本轮按约定暂不做；见 roadmap |
| TRAN OO 事务写入 | 中 | 中 | 规范 FM `RPY_TRANSACTION_INSERT` 无 class/method 参数；需 SE93 BDC，ICF 上下文不可用，继续走 SE93 |
| DOMA/DTEL `.docu.json` 长文本 | 中 | 中 | AFF `docu-v1` 未 vendor；需 ICF 长文本读写 + 真机验证 |
| Cross-reference / where-used 全集 | 中 | 中-大 | 需 REPS 全文扫描 |
| Transport release / delete | 低 | 小 | 本轮按约定不做 |
| 表单（SFPF / SSFO / SAPscript） | 中 | 大 | 按需；AFF 只覆盖 SFPF |
| IDoc / ALE | 中 | 大 | 按需；AFF 无格式 |
| Web Dynpro / ITS / BSP | 低 | 大 | AFF 无格式，不建议 |
| 性能 trace（ST05 / STA） / 后台作业（SM36/SM37） | 低 | 中 | 按需 |
| Pool / Cluster Table、TABL 索引 | 低 | 中 | AFF 不覆盖；按需扩展 |

**路线图与取舍**见 [roadmap](roadmap.md)（对象类型补充 P0/P1/P2 与"不做"清单）。

## AFF Fixture Coverage

> 手工维护：`abap validate:aff --json test/fixtures/` 的按类型汇总。
> Last run: 2026-10-31（34 个 fixture，PASS 34 / WARN 0 / FAIL 0，13 个类型）。

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
| ENQU / HTTP / TRAN / TTYP / MSAG / DDLS | 各 1 | 各 1 | 0 | 0 |

> 尚未有 fixture 的类型：SRVB / SRVD / BDEF / DCLS / DDLX / DDLA（RAP/CDS 家族）与其它新类型；补类型时应同步补 fixture。

### Schema paths

| Type | Schema file |
|------|-------------|
| CLAS | `src/abap_cli/schema/clas-v1.json` |
| INTF | `src/abap_cli/schema/intf-v1.json` |
| PROG | `src/abap_cli/schema/prog-v1.json` |
| FUGR | `src/abap_cli/schema/fugr-v1.json`（+ `func-v1` / `reps-v1`） |
| TABL | `src/abap_cli/schema/tabl-v1.json`（+ `tabt-v1`） |
| STRU | `src/abap_cli/schema/tabl-v1.json` (alias) |
| DOMA | `src/abap_cli/schema/doma-v1.json` |
| DTEL | `src/abap_cli/schema/dtel-v1.json` |
| ENQU | `src/abap_cli/schema/enqu-v1.json` |
| NROB | `src/abap_cli/schema/nrob-v1.json` |
| HTTP | `src/abap_cli/schema/http-v1.json` |
| TRAN | `src/abap_cli/schema/tran-v1.json` |
| TTYP | `src/abap_cli/schema/ttyp-v1.json`（上游无此格式，本地维护） |
| MSAG | `src/abap_cli/schema/msag-v1.json` |
| DDLS / SRVD / BDEF / DCLS / DDLX / DDLA | 同名 `*-v1.json` |

Companion files (TABL/STRU `.settings.json`) validate against `tabt-v1.json`。PROG 与 HTTP fixture 为手写样本（引入 fixture 时上游 abap-file-format 尚未提供 examples）。

---

# references

- 详细 wiki 索引：[`wiki/index.md`](index.md)
- 决策录：[`wiki/design-decisions/`](design-decisions/)
- 对象详细文档：[`wiki/objects/`](objects/)
- 对象类型矩阵：[`wiki/object-types.md`](object-types.md)
- 命令文档：[`docs/commands.md`](../docs/commands.md)
- 端到端剧本：[`wiki/agent-cookbook.md`](agent-cookbook.md)
- 路线图：[`wiki/roadmap.md`](roadmap.md)
