# abap CLI 建议汇总（命令优化 / 新命令扩展 / 差异化新命令）

> 本文档脱离既有 spec 与旧 roadmap 框架，从工具终局形态出发整理。
> 每项均以 checkbox 追踪落地状态；表格内 `- [ ]` 即待办。

## 一、现有命令的优化

| 命令 | 现状问题 | 优化建议 | 价值 | 状态 |
|------|---------|---------|------|------|
| `push` | 大文件/多文件串行、失败后需手动重试 | 支持 `--resume`（记录已成功文件，失败续传）；`push --all` 并行推送（`--concurrency N`，注意锁冲突） | 减少长任务重复劳动 | - [ ] |
| `push` / `pull` | lock 失败即中止整个流程 | 明确 `--retry N` + 退避策略；`push --atomic` 补充"预检锁"步骤 | 可靠重试（对应 agent 友好原则"可安全重试"） | - [ ] |
| `search` | 每次查询都走 SAP，无缓存 | 本地结果缓存 + `--stale N` 过期提示；对象名解析结果复用 | 高频 agent 调用显著提速 | - [ ] |
| `status` vs `diff` | 功能重叠（都是本地↔SAP 差异），仅粒度不同 | 合并为一个命令 + `--detail` 开关，或 `status` 支持 `--summary`/`--json` 两种粒度 | 减小 agent 需记忆的命令面 | - [ ] |
| `check` | 三种模式已子命令化 | 增加 `--all-modes`（内容+语法+ATC 一次跑完）并聚合结果；`check atc --out` 结果持久化到本地 | 推前一次把关（"默认高信号"） | - [ ] |
| `transport` | 缺 `release` 能力，`assign` 后仍需手工 | 补充 `abap transport release <req> --tr <target>`；`transport list` 增加 `--mine/--all` | 闭合传输生命周期管理 | - [ ] |
| `--schema` | 已覆盖全部命令（1.0.0） | — | agent 无需读文档即可调用任意命令 | - [x] |
| `--dry-run` | 各命令实现不一（有的出 plan 有的只是 no-op） | 统一为"输出机器可读 plan 对象 + exit 0"，统一 `--plan` 命名 | 一致可组合原则 | - [ ] |
| `doctor --fix` | 只做安全可逆修复 | `doctor --fix --all` 分级（安全/需确认），输出"修复前后 diff" | 提升自助修复能力 | - [ ] |

## 二、建议扩展的新命令（补齐能力空白）

| 命令 | 功能 | 使用场景 | 价值 | 状态 |
|------|------|---------|------|------|
| `abap delete` | 删除对象（source/DDIC），支持 `--dry-run`/`--force` | 已实现：`abap delete <obj> --type <type> --yes`（非 `$TMP` 需 `--tr`） | 补齐对象生命周期最后一块 | - [x] |
| `abap test` | 运行 ABAP 单元测试，输出测试结果 JSON | 修改类后验证不破坏既有测试 | 已实现：`abap test <object>`（ADT `/sap/bc/adt/abapunit/testruns`，`--risk` / `--duration` / `--all` / `--strict`，失败 `TEST_FAILED` exit 7） | 让"改-验"闭环自动化 | - [x] |
| `abap where-used` / `references` | 查询对象引用/使用处（SE85/RSWBO 数据） | 已实现：`abap where-used`（ADT 引用查询） | 重构安全性的关键信息 | - [x] |
| `abap release` | 释放传输请求（`WS_RELEASE` 类） | 变更完成后的收尾 | 与 `transport create` 对称 | - [ ] |
| `abap watch` | 监听本地目录，文件变更自动 `check`→`push` | 本地编辑时实时反馈 | 开发者体验提升（注意与 agent 模型配合） | - [ ] |
| `abap export` | 批量导出对象快照（含文本池/DDIC）到可版本化目录 | 备份、迁移、审计 | 使本地成为可版本化的完整镜像 | - [ ] |
| `abap package` | 包管理：`list`/`show`/`create`、查看包内对象与依赖 | 探索系统结构、批量操作 | 弥补 `pull --package` 之外的管理能力 | - [ ] |
| `abap upgrade` | 对比本地 CLI 内置 ICF 服务版本与远端，一键升级 | 版本漂移（`deploy status` 已能探测 outdated） | 把 `deploy` 的升级路径独立出来 | - [ ] |
| `abap logs` | 查看 ICF 服务/应用日志、ATC 结果历史 | 排障、审计 | 诊断闭环 | - [ ] |

## 三、真正的差异化新命令（脱离 roadmap 的终局能力）

| 命令 | 功能 | 为什么这是空白 | 价值 | 状态 |
|------|------|--------------|------|------|
| `abap run` | 执行类方法或 report（`ZCL_X=>method` 或 classrun），返回 stdout/返回码 | 已实现：`abap run`（classrun / PUBLIC STATIC 方法） | 从静态开发跨到动态验证：push 后直接跑一次看结果。agent 闭环里最缺的一环 | - [x] |
| `abap select` | 只读查询表数据（`--table ZTAB --fields ... --where ... --limit`），走 ICF 新增 `/data` 端点 | 已实现：`abap select`（ICF `/data` 端点，只读） | 给 agent 提供 SE16N 等价能力，测试/验证/排障全自动化 | - [x] |
| `abap gen` | 基于系统元数据生成代码：给表名 → 生成 CRUD 类/报告/选择屏幕骨架 | `create --template` 是**静态**模板，不知道系统里有什么 | 把"系统知识"变成生成输入，agent 生产力放大器 | - [ ] |
| `abap impact` | 影响分析：对象被谁引用、引用链、激活风险，输出 JSON 调用图 | `search`/`inspect` 只答"是什么"，不答"改它会炸什么" | 重构安全性的核心决策数据 | - [ ] |
| `abap docs` | 从对象生成文档（类/接口/方法说明、签名、依赖） | 现在全是读代码 | 让 agent 读懂存量代码后给出总结 | - [ ] |
| `abap snapshot` | 把整个包/传输导出为可版本化完整快照（含数据），可跨系统比对/恢复 | 现在 pull 是单对象的 | 备份、迁移、多系统同步的地基 | - [ ] |

## 四、跳出"命令集合"的重新设计

| 项目 | 设想 | 价值 | 状态 |
|------|------|------|------|
| `abap serve`（协议化） | 常驻进程 + JSON-RPC 行协议，暴露现有全部能力；CLI 命令保留为人类 fallback，共享同一 `flows/` 层 | 免冷启动（keytar/abap-adt-api 加载重）、复用连接池、支持流式进度/取消；改变 agent 调用方式 | - [ ] |
| 领域 DSL 收敛 | 从 29 个扁平命令收敛为少量核心动词 + 通配对象寻址：`get`/`put`/`status`/`run`/`data` | 让 agent 只记 5 个动词而非 29 个专名；`--schema` 已提供机器自描述 | - [ ] |
| 多 agent 并发协调 | `abap lock <obj> --owner <agent-id>` 显式声明归属、超时自动释放；`push` 前强制检查 owner，冲突返回 `LOCKED` 并指认持有者 | 从"单 agent 工具"到"多 agent 平台"的架构性转变 | - [ ] |
| 撤销/时间旅行 | `abap restore <obj> --from <snapshot>` 从快照恢复到 SAP，配合 `snapshot` 形成"提交点→实验→回滚"循环 | 让 agent 敢于试验，可逆操作 | - [ ] |

## 五、优先级建议

| 优先级 | 项 | 理由 |
|--------|-----|------|
| P0 | ~~`abap run`~~ / ~~`abap select`~~ / ~~`abap test`~~ | 均已在 1.0.0 后实现（见第三节），从待办中移除 |
| P0 | 现有类型内补完（TRAN 写路径 / DOMA-DTEL 长文本 / AFF schema 同步） | 见第六节；决定 agent 闭环质量 |
| P1 | `abap serve`（协议化） | 改变交付形态，与"agent-native"目标完全一致 |
| P1 | 对象类型补充 P1 批（VIEW / SHLP / XSLT；DEVC 已完成） | 见第六节；高价值且 SAP 侧路线已探明 |
| P2 | `abap gen` / `abap impact` | 生产力放大器，但依赖前两者稳定 |
| P2 | 多 agent 协调 / 快照回滚 | 从单工具到平台的关键，但场景还没到 |

## 六、对象类型补充路线（2026-10 评估）

> 判据：**开发价值 × SAP 侧可行性（ADT / DDIC API）× AFF 成熟度 × agent 闭环收益**。
> 对比依据：abap-cli 23 类 vs SAP abap-file-formats 上游 102 个类型格式（2026-10-30 HEAD）vs abapGit 168 个 TADIR handler（2026-10-29 HEAD）。
> 本轮范围约定：**P0 不做 transport request 管理（release/delete）；P1 暂不做授权字段（AUTH）**。

### 6.1 P0：先在现有类型内补完

- [x] **ABAP Unit 运行**：`abap test`（ADT `/sap/bc/adt/abapunit/testruns`，只输出 summary + failures）
- [x] **`create local` 错误落盘修复**：`SRVD`/`DCLS`/`DDLX`/`DDLA` 改为 `TYPE_NOT_SUPPORTED`，不再写 REPORT 骨架
- [x] **AFF vendor schema 与上游对齐 + 溯源治理**（重新同步 6 个漂移 schema，README 记录来源）
- [x] **wiki 漂移修正**：object-types / coverage-matrix / create / pull / push / architecture
- [x] **TRAN 写路径**：ABAP `/tran` GET/POST/PUT/DELETE 经 `RS_CORR_INSERT` + `RPY_TRANSACTION_INSERT` 实现（dialog/report/parameter/variant；OO 拒绝）；`abap create/pull/push/delete TRAN` 闭环，真机 23/23 TC
- [ ] **DOMA/DTEL `.docu.json`**：vendor `docu-v1.json` + ICF 长文本读写（需真机验证）
- [ ] **AFF schema 季度同步**：`scripts/sync-aff-schema.sh` 已就绪；新增类型时按需 vendor

### 6.2 P1：高价值新类型（SAP 侧路线已探明）

| 类型 | SAP 侧路线 | 本地格式 | 状态 |
|---|---|---|---|
| `VIEW` | ICF `/ddic/view`：`DDIF_VIEW_GET` / `DDIF_VIEW_PUT` | 自建 `view-v1.json`（AFF 无此格式；按 AFF 命名/JSON 约定，README 标注 local extension） | - [ ] 实现完成（ABAP/CLI/mock/unit/integration）；真机 deploy + 六阶段待 SAP stateful 恢复后补 |
| `SHLP` | ICF `/ddic/shlp`：`DDIF_SHLP_GET` / `DDIF_SHLP_PUT` | 自建 `shlp-v1.json`（同上） | - [ ] |
| `DEVC` | ADT `createObject` `DEVC/K` + `GET /sap/bc/adt/packages/<name>` 读 | AFF `devc-v1.json` | - [x] 已完成（create/pull/delete；push 不支持——ADT 无包更新端点） |
| `XSLT` | ICF + `CL_O2_API_XSLTDESC`（create/load） | AFF `xslt-v1.json` + `.xslt.xml` | - [ ] |

> VIEW / SHLP 因 AFF 上游无格式，需按 TTYP 先例维护本地扩展 schema；可同步向上游 AFF 提 PR，采纳后切回官方 schema。

### 6.3 P2：场景驱动（有真实需求再排）

- **ENHO / ENHS**（增强/BAdI 相关）：先只读 pull（`CL_ENH_FACTORY`），push 后置；复杂度大
- **授权族**：`SUSO` / `SUSH` / `SUSI` / `SUCO` / `SIA5` / `SIAD`（AUTH 本轮暂缓）
- **SVIM / VCLS**（表维护生成器 / 视图簇）：AFF 近 3 个月新增格式；需真机验证 SAP 侧 API
- **TYPE**（type pool，AFF `type-v1` + `.type.abap`）
- **CHKC / CHKO / CHKV**（ATC 检查/变体配置，AFF-stable，纯 JSON）
- **AFF-stable 27 类中的云/作业/UI 类**（APLO/BGQC/CDBO/COTA/DESD/EVTB/EEEC/GSMP/SAJC/SAJT/SMBC/SWCR/NONT/RONT/UIAD/UIPG/UIST/DRTY/DTEB/DSFI/DRAS/DSFD/DTSC/DTIX）：接入成本低，但按 BTP/云需求排期
- **表单/集成**：`SFPF`（AFF 有格式）、`SSFO`/SAPscript、`IDOC`（AFF 无格式，复杂度高）

### 6.4 不做 / 暂缓

- **为 107 个"仅 abapGit 支持"类型写 XML 兼容层**：Web Dynpro/ITS/BSP/W3*、eCATT、Gateway（IW*/G4*）、BW（IOBJ/ODSO）、AIF/AIFC、经典增强框架（CMOD/ENHC/SXCI/SXSD）、SAPscript FORM——与本 CLI 的 AFF 原生路线冲突，除非出现明确"导入/导出 abapGit 仓库"需求
- **AFF 头-only 占位类型**（ADVC/APIC/EDCR/PARA/SMTG）：上游 schema 无实质载荷
- **TABLE 索引 / Pool-Cluster Table**：AFF 不覆盖，按需以本地扩展方式做

### 6.5 新增类型的实现约定

1. `types/registry.ts` 加类型元数据 → 2. `flows/edit/routing.ts#TYPE_ROUTES` 加 create/pull/push 路由（`test/unit/routing.test.ts` 防漂移）→ 3. `formats/<type>/` artifact → 4. schema（AFF 优先；无 AFF 则本地扩展并在 `schema/README.md` 标注）→ 5. 必要时扩展 ICF handler / ADT wrapper → 6. 测试（unit + integration + `tests/` 真机证据）→ 7. `wiki/objects/<type>.md` + 命中矩阵 + `npm run build && npm run docs:build && npm run verify`。DDIC 类必须在 A4H 在线时按 `abap-testing` skill 跑真机回归。
