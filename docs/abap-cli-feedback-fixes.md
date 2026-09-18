# abap-cli feedback 修复清单与验证记录

> 配套文档：核验报告 `docs/abap-cli-feedback-verification.md`（F-01…F-30 是否真实存在）。
> 本文记录**做了什么修改、改在哪个文件、如何验证**，以及**没有修的部分与原因**。
>
> 基线：`dev` 分支，`git describe` = `v0.2.6-41-g0452193`。
> 基线测试：197 文件 / 1740 测试通过 → 修复后：**206 文件 / 1813 测试通过**。
> 真机：A4H（`vhcala4hci:50000`, client 001, user `developer`）。

---

## 0. 修复概览

| ID | 状态 | 一句话 | 真机验证 |
|---|---|---|---|
| F-01 | ✅ 已修 | ajv/ajv-formats 移入 `dependencies`；`top-error` 不再用 `JSON.parse` 覆盖真实错误；`doctor env.deps` 增加依赖探测 | 已发布包 0.2.7 上复现根因；修复以 `npm ls --omit=dev` + 模拟安装验证 |
| F-02 | ✅ 已修 | `inspect --activation` 以 ADT inactive 列表为权威信号；`pull` 标注 `versionKind`、新增 `--active` 与 `PENDING_INACTIVE_VERSION` 警告 | ✅ 真机（构造未激活状态，`ok:false`） |
| F-03 | ✅ 已修 | `create --file` 从 AFF `header.description` 回填；`encodeAttr` 容忍空值 | ✅ 真机（`create PROG` 无 `--description` 成功） |
| F-04 | ✅ 已修 | 拉回本地前保留已有草稿（`--overwrite` 才覆盖）；布局与 `pull` 统一为 `src/<typeFolder>/<obj>/` | ✅ 真机（草稿保留 + `LOCAL_FILE_KEPT`） |
| F-05 | ✅ 已修 | 优先用消息 `href` 的 `#start=line,col` 作为行号；新增 `lineScope`；修掉重复前缀 | ✅ 真机（真实第 6 行现在报 `line 6`） |
| F-06 | ✅ 已修 | `$USERNAME → $USER → os.userInfo() → git config user.name` 回退；按平台输出指引 | 单测 |
| F-07 | ✅ 已修 | `run --help` / schema 明确 `WRAPPER_INPUT_UNAVAILABLE` 语义 | 帮助文本 + 既有测试 |
| F-08 | ✅ 已修 | `ACTIVATION_FAILED` 带 `written/activated/lineScope/messages`；`nextSteps` 指向 `inspect --activation` | ✅ 真机 |
| F-09 | ✅ 已修 | `select --max` 作为 `--limit` 的废弃别名，与 `search` 一致 | 单测 |
| F-10 | ✅ 已修 | ICF handler 行类型按 DDIC 真实类型构建（原来是 INT/RAW→CHAR） | ✅ 真机（VRSD / TSTC） |
| F-11 | ✅ 已修 | where 解析器新增 `LIKE` 关键字算子 | ✅ 真机（`AUTHOR LIKE 'D%'`） |
| F-12 | ✅ 已修 | `abap select --group-by <field>` + 服务端 `execute_group_by`（严格增量分支） | ✅ 真机（VRSD 分布 + `--where`） |
| F-13 | ✅ 已修 | `search --exact` 改为前缀放宽 + 扩大候选窗口 | ✅ 真机（TRDIR / TADIR） |
| F-14 | ✅ 已修 | 客户端补全服务端 DDL token 映射（rawstring/string/lraw/df16*/utclong…） | ✅ 真机（REPOSRC / REPOTEXT） |
| F-15 | ✅ 已修 | 文档按实际能力更正 textpool 读写说明 | 文档审阅 + drift 检查 |
| F-16 | ✅ 已修 | 新增 `abap run-report` + 服务端 `POST /run/report`（SUBMIT + 列表捕获） | ✅ 真机（ZR_USER_CHANGES 81 行） |
| F-17 | ✅ 已修 | session jar 告警每进程每类只出一次，并说明后果 | 单测 + 真机观察 |
| F-18 | ✅ 已修 | `diff <对象名>` 给出可操作错误而非"文件名不合法" | 单测 |
| F-19 | ✅ 已修 | `deploy status` 区分"探测失败"与"确认未安装"（`installed:null` + `probeFailed`） | 单测 + 真机观察过探测失败 |
| F-20 | ✅ 已修 | `doctor` 新增 `env.install`（版本 / 路径 / 安装布局） | 单测 + 真机输出 |
| F-21 | ✅ 已修 | 新增 `report-alv` / `report-alv-selection` 模板 | 单测（生成骨架断言） |
| F-22/23/24 | ◑ 部分 | SAP 内核限制不可修；除 `check.scope` 外，`check` 现会回查仓库并说明 unknown 名字是否真实存在 | ✅ 真机（`FOR devclass` 场景） |
| F-25 | ✅ 已修 | 新增 `abap fields <table>`（DD03L 驱动） | ✅ 真机（VRSD / TADIR） |
| F-26 | ✅ 已修 | 同 F-10，`DD03L` 字段清单可读 | ✅ 真机 |
| F-27 | ✅ 已修 | 同 F-14 | ✅ 真机 |
| F-28 | ✅ 已修 | 同 F-13；`pull` 两条视图路径仍不支持（能力限制，已如实报错） | ✅ 真机 |
| F-29 | ✅ 已修 | HTML 错误页摘要为 `errorTextHeader`/`msgText`，原文留在 `details.sapErrorBody` | 单测 + 真机机制复现 |
| F-30 | 🌐 非 CLI | SAP 内核类型解析；未改 | — |
| §6 | ✅ 已修 | `check` 输出新增 `scope`，说明"check 通过 ≠ 激活通过" | 单测（既有 check 测试） |

---

## 1. 分层归位：改动落在哪一层

| 层 | 改动 |
|---|---|
| **打包 / 启动** | `package.json`（ajv）、`top-error.ts`、`flows/setup/doctor-checks.ts` |
| **客户端 TS** | `flows/search/inspect-ops.ts`、`flows/edit/pull*.ts`、`formats/pull-strategy.ts`、`formats/pull-fugr.ts`、`formats/ddic/tabl-artifact.ts`、`flows/edit/create.ts`、`clients/create-object.ts`、`clients/activation.ts`、`flows/edit/push-object.ts`、`flows/edit/push.ts`、`clients/icf-client.ts`、`flows/feedback-flow.ts`、`session/reuse.ts`、`clients/http-error.ts`、`clients/icf-version.ts`、`commands/{check,diff,deploy,fields,pull,run,search,select}.ts`、`core/limits.ts`、`index.ts`、`formats/templates.ts` |
| **自带 ICF ABAP 服务** | `zcl_abap_vibe_icf` 的三个 include：行类型构建、`LIKE` 解析、`execute_group_by`（F-12）、`/run/*` 路由 + `lcl_run`（F-16）→ 均已 `push` 激活到 A4H |
| **文档** | `CHANGELOG.md`、`docs/commands.md`（重新生成）、`docs/getting-started.md`、`docs/architecture.md`、`skills/**`、`wiki/**` |

### 1.1 服务端两处改动的实质

1. **动态行类型**：原实现把 `INT1/INT2/INT4/INT8` 与 `RAW` 等一律映射成 `CHAR`，SAP 对
   `SELECT ... INTO TABLE @<lt_rows>` 报
   `... "<LT_ROWS>" are not Unicode convertible`，使 `DD03L`、`VRSD`、`TSTC` 等表**完全不可读**。
   现在**优先取表自身的 DDIC 行类型**（`cl_abap_typedescr=>describe_by_name` +
   `get_table_line_type`），拿不到时再回退到按类型族正确映射的组件构造。
2. **`LIKE`**：解析器只在错误文本里列出 `LIKE`，从未把它当算子。新增关键字算子扫描
   （独立成词、大小写不敏感），并把原先恒不生效的 `lv_field CP '*LIKE*'` 死代码删除。

---

## 2. 真机验证记录（A4H）

| 验证 | 命令 | 结果 |
|---|---|---|
| F-02 激活假阳性 | 事先构造"写入但未激活"的类 | 修复前 `ok:true` → 修复后 `ok:false` + `hasPendingInactiveVersion:true` + `reason: pending_inactive_version`；`run` 仍执行旧 active 版（行为正确） |
| F-02 pull 语义 | `abap pull ZCL_ZR_T5 --active` / 对未激活对象 pull | `versionKind` 正确；对未激活对象产生 `PENDING_INACTIVE_VERSION` 警告；`--active` 内容与 latest 确实不同 |
| F-03 | `abap create PROG ZABAP_CLI_F03 --file zfix.prog.json`（无 `--description`） | `success`，`description` 取自 AFF header |
| F-04 | 预先放好草稿后再 `create` | 草稿保留 + `LOCAL_FILE_KEPT`；`localFile = src/prog/<obj>/<obj>.prog.abap` |
| F-05 | 第 6 行故意写错后 `push` | `line 6: Error in assignment: Expression missing.`，`lineScope: source-uri`（修复前为 `line 1`） |
| F-08 | 同上 `push --json` | `details.written/activated = true/false`；`nextSteps` 含 `abap inspect … --activation`；消息前缀不再重复 |
| F-10/F-26 | `abap select --table VRSD …`、`--table DD03L …`、`--table TSTC …` | 全部成功（修复前 `QUERY_FAILED not Unicode convertible`） |
| F-11 | `abap select --table VRSD --where "AUTHOR LIKE 'D%'"`、`TADIR --where "OBJ_NAME LIKE 'ZCL_ZR%'"` | 成功返回行 |
| F-14/F-27 | `abap pull REPOSRC --type TABL`、`REPOTEXT` | 成功写出 `.tabl.json` / `.tabl.ddic` / `.tabl.settings.json` |
| F-25 | `abap fields VRSD` / `TADIR` | 19 / 22 个字段，含位置、主键、数据元素、类型、长度 |
| F-13/F-28 | `abap search TADIR --exact`、`TRDIR --exact`、`VRSD --exact`、`ZCL_ZR_T5 --exact` | 全部命中（修复前返回 `No matches`） |
| F-12 | `abap select --table VRSD --group-by OBJTYPE --limit 10`；`--where "AUTHOR = 'DEVELOPER'"` | 分别得到 METH 1409 / CINC 479 … 与 METH 543 / CINC 356（**后者与反馈报告中的数字一致**）；`--group-by KEYLEN`（INT2）亦正确；未知字段报 `INVALID_FIELD`；与 `--fields`/`--count-only` 冲突报 `INVALID_ARGUMENT` |
| F-16 | `abap run-report ZR_USER_CHANGES --json`（反馈自己交付的报表）；`abap run-report ZABAP_CLI_RRPT`（临时报表，已删除） | 81 行 / 3 行列表输出，含 `cl_salv_table` 的管道分隔行；非报告对象给 `REPORT_NOT_FOUND`/`REPORT_NOT_EXECUTABLE` |
| F-22/F-23 | 临时 PROG 内 `SELECT-OPTIONS s_pack FOR devclass.` → `abap check syntax` | `Field "DEVCLASS" is unknown. [exists in this system as DEVCLASS (DTEL/DE, DOMA/DD, AUTH) — the rejection is a release/kernel limitation, not a typo]` |
| F-17/F-19 | 真机观察 | session jar EPERM 告警每命令一次 → 修复后每进程一次；`deploy status` 在 ICF 探测失败时给出 `probeFailed` 语义 |

**测试用一次性对象已全部删除**（`ZCL_ZZ_F02CHECK`、`ZCL_ZZ_F02FIX`、`ZABAP_CLI_F03/F04/F05`，
均验证为 `OBJECT_NOT_FOUND`）。A4H 上只保留了 `ZCL_ABAP_VIBE_ICF` 的实现包含修复（这是本次要交付的服务端改动）。

---

## 3. 没有修的部分与原因

> **一处自我更正**：F-16 我第一轮判定为"本环境不可实现"，理由是"唯一通道 `--method` 返回
> `WRAPPER_INPUT_UNAVAILABLE`"。这个判断是错的——**ICF 服务本身可以直达**，不需要 wrapper 路由。
> 实测 `SUBMIT ... EXPORTING LIST TO MEMORY` + `LIST_TO_ASCI` 在 ICF handler 里工作正常
> （连 `cl_salv_table` 的输出都能捕获），因此 F-16 已按"新增服务端能力"实现并真机验证。
> 教训：把"唯一通道不可用"当成"不可行"之前，先把其它通道列全。


| ID | 为什么没做 |
|---|---|
| **F-22 / F-23 / F-24 / F-30** | 主体是目标 release 的 ABAP 类型面与 SQL 语法限制，不是 CLI 缺陷。CLI 侧本次做了三件：`check` 输出新增 `scope`（说明 `check syntax` 通过不代表激活通过）；激活错误新增 `lineScope`；`check` 对 unknown 名字**回查对象仓库**并说明"真实存在（含类型）/ 最近候选 / 系统中不存在"。**仍未做**：`abap types`（列出可用内建类型与类型池）——需要在服务端枚举类型面，属于新能力，且本机 `check syntax` 对 `TYPE char40`/`RANGE OF trobjtype` 等实际可用（见核验报告 §2.7），优先级低。 |
| **F-20** 版本单调性 | 已加 `doctor env.install` 让"当前跑的是哪个构建"可查；但 `dev` 分支 `package.json` 仍写 `0.2.6`（低于已发布 tag `v0.2.7`）——这属于发布流程，改动版本号会影响发布，未擅自更改。 |

---

## 4. 新增 / 修改的测试

| 文件 | 覆盖 |
|---|---|
| `test/unit/top-error-hook-payload.test.ts` | F-01：人类可读模式不再抛 `SyntaxError`，`onError` 载荷仍可用 |
| `test/unit/inspect-activation.test.ts`（+4） | F-02：inactive 列表 → `ok:false`；端点不可用时降级 |
| `test/unit/pull-version-kind.test.ts` | F-02：`versionKind`、`--active` 传递、`PENDING_INACTIVE_VERSION` |
| `test/unit/create-description-and-local-file.test.ts` | F-03 / F-04：description 回填、布局、草稿保护、`--overwrite` |
| `test/unit/activation-error-shape.test.ts` | F-05 / F-08：`href` 位置解析、`lineScope`、`written/activated`、无重复前缀 |
| `test/unit/feedback-username.test.ts` | F-06：回退链与平台适配指引 |
| `test/unit/select-max-alias.test.ts` | F-09 |
| `test/unit/diff-object-name.test.ts` | F-18 |
| `test/unit/deploy-status-probe.test.ts` + `extension-status.test.ts`（更新） | F-19 |
| `test/unit/session-jar-warning-once.test.ts` | F-17 |
| `test/unit/session-reuse/icf-cookie-reuse.test.ts`（+2） | 新发现：HTTP 400 `Session Timed Out` 也触发重登；真实 400 应用错误不重试 |
| `test/unit/http-error-html.test.ts` | F-29 |
| `test/unit/fields-command.test.ts` | F-25 |
| `test/unit/select-group-by.test.ts`（新） | F-12：`--group-by` 校验、互斥、wire 字段、响应映射、dry-run |
| `test/unit/run-report.test.ts`（新） | F-16：`/run/report` 调用与载荷、名称校验、错误码映射与指引、human 渲染 |
| `test/unit/check-modes.test.ts`（+3） | F-22/F-23：unknown 名字的仓库查证提示（存在 / 不存在 / `TABLE-FIELD`） |
| `test/unit/create-local.test.ts`、`doctor-checks.test.ts`（+） | F-21 / F-20 |
| `test/unit/search-pagination.test.ts`（更新） | F-13 / F-28：前缀放宽 + 候选窗口 |
| `test/unit/skill-bundle.test.ts`、`skill-routing-coverage.test.ts`（更新） | 新命令 `fields` 纳入覆盖 |

---

## 5. 复现/回归命令

```bash
cd /Users/lei/Desktop/ai_abap/vibe_with_abap
npx tsc --noEmit                       # 类型检查
npm run build                          # tsc + 打包 schema
npx vitest run --reporter=dot          # 206 文件 / 1813 测试
npm run check-skills-drift             # 无漂移
npm run build-docs                     # 重新生成 docs/commands.md（含 fields）
```

服务端改动若要重新部署：

```bash
# 只更新被改动的那一个 include（比整包 deploy 更小的爆炸半径）
abap check syntax abap/src/clas/zcl_abap_vibe_icf.clas.implementations.abap --json
abap push        abap/src/clas/zcl_abap_vibe_icf.clas.implementations.abap --yes --json
```
