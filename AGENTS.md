# 项目要求

**大胆探索，小心求证，勇于重构**

> 本文件是本仓库的 repo-level 合约。根 `AGENTS.md` 会被 DSH 等 coding agent 自动加载。
> `.agents/skills/` 下的子 skill 只在本文件之上叠加领域规则，不覆盖本文档内容。

## 规则

- 设计与实现优先考虑 LM Agent 使用优化与 token 经济性；`--json` 输出只保留 Agent 所需的关键字段。
- 命令的机器契约只有一个事实源：命令 schema（`abap <cmd> --schema --json`）。`docs/commands.md`、`skills/*/references/commands-quick.md` 由 `npm run docs:build` 生成，禁止手改；`wiki/commands/<cmd>.md` 用 `okf` skill 手写叙述页（前置条件 / gotcha / 真机证据），生成器只补缺失 stub。
- 设计文档（spec / `specs/`）不进 git；需要长期保留的结论写进 wiki 或本文件。
- 不把 bug / spec / PR 编号写进 commit、PR 描述、代码注释或 wiki；文档不写解释性标注。
- 永不提交 `.env` 或 `.abap.json`（均在 `.gitignore` 中）；SAP 密码只通过 `abap profile add/set` 写入 OS keychain。

## 架构（三层）

- **CLI**（`src/abap_cli/`）：TypeScript 薄客户端，所有命令都支持 `--json`；命令清单唯一入口是 `src/abap_cli/registry/commands.ts`。
- **SAP**（`abap/`）：ABAP，DDIC CRUD 的 ICF 服务处理器。
- **Agent**：`skills/` + `agents/` 是随 npm 包分发给用户的内容；`.agents/skills/` 是本仓库开发用的本地技能，不随包分发。
- **分发**：`npm run build` 产物为 `dist/index.js`（`rootDir: src/abap_cli`）；npm 包只含 `dist`、`abap/src`、`skills`、`agents`。

## 关键约定

- 源对象（Class、Interface、Program、CDS）：通过 `abap-adt-api` 走 ADT REST API。
- DDIC 对象（Domain、DataElement、Table、Structure、TableType 等）：自建 ICF 服务（`/sap/abap_cli`），RESTful JSON 通信。
- 文件格式遵循 SAP abap-file-format 约定；DDIC 的 JSON schema 由 ICF 服务端定义。本地布局为 AFF 原生扁平：所有产物平铺在 `src/`，文件名 `<name>.<type>[.<sub_type>][.<content_type>].<ext>`，命名空间用括号 token（`/UI2/CL_JSON` → `(ui2)cl_json`）。
- 配置放在 `.abap.json`（gitignored）；凭证写入 OS keychain。
- 所有新增 CLI 命令必须注册到 `src/abap_cli/registry/commands.ts`（`COMMAND_SPECS` + lazy load），并补 `wiki/commands/<cmd>.md` 与所属 skill 的 `metadata.commands`。
- 沿用既有命令模式：`export function register<Name>Command(program: Command)`。
- `abap/src/` 下的 ABAP 代码遵循 abap-file-format 文件命名约定。

## 工作风格

- 倾向**重写**而非打补丁：不要叠加兼容层、deprecated 别名、wrapper；允许 breaking change。旧 extension 机制已整体移除，不要在没有新设计文档的情况下重新引入。
- 每次 breaking 必须：在 `CHANGELOG.md` 顶部（按既有 `## [Unreleased]` 格式）记录，并在 commit / PR 描述中写明迁移路径或影响面。
- 改动必须由 `test/` 覆盖；真实 SAP 端到端用例放 `tests/`（本地执行，不入库）。
- 开发流程细则（会话接续、分支/PR/commit 格式、verify 闸门、文档与 handoff 同步、依赖升级、真机门禁、交付自检）：本机加载 `.agents/skills/repo-workflow/SKILL.md`（`.agents/` 为本地开发资产、不入库）；干净克隆以 `docs/development.md` 的 Delivery Workflow 一节为准。

## 验证

- `npm run verify` = build + vitest + `docs:check` + skills 漂移检查；改命令后先 `npm run build && npm run docs:build`，生成物必须一起提交。
- pre-push hook 已配置在 `.githooks/`；首次克隆需执行 `bash scripts/setup-hooks.sh`。
- `check-skills-drift` 只覆盖命令名 / SKILL 版本 / script spawn / ICF 版本；`docs:check` 只覆盖生成物、wiki 页存在性与 README 命令覆盖。两者都不校验每句散文，别把绿灯当成文档全对。

## 可联调的 on-prem 环境

- URL: http://vhcala4hci:50000
- User: developer
- Client: 001
- Password: 见本地 `.abap.json` / keychain（不入库）
- 工作目录: `tmp/s4h`

## 可联调的 BTP Trial 环境

- 工作目录: `tmp/trial`

## Agent 上下文布局

- 仓库合约：根 `AGENTS.md`（本文件）。
- 本地技能：`.agents/skills/`（DSH 项目级技能根；启动只加载 name+description，正文按需）。当前含 `abap-style` / `abap-testing` / `okf` / `repo-workflow`（开发流程与交付纪律）。
- 随包分发：`skills/`、`agents/abap-developer.agent.md`，由 `abap init --agent <copilot|claude|cursor|generic>` 拷入用户项目。
- `.github/` 只承载 CI（`workflows/`、Dependabot）；Copilot 时代的 instructions 已删除，本文件是唯一指令源。

## 子任务与交接

- 长上下文任务可用 subagent / teammate 拆分，每个只处理一个子任务，完成后由主 agent 整合。
- 会话交接写在 `tmp/handoff/YYYYMMDD-HHMM-<status>-<topic>.md`，带状态（`plan` / `wip` / `done` / `blkd`），供下一个 session 直接接手。
- 结论沉淀进 `wiki/design-decisions/`；`tmp/` 与 `tests/` 不入库。
