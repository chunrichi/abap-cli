# 项目要求

**大胆探索，小心求证，勇于重构**

> 本文件是所有 coding agent 在本项目工作的 repo-level 合约。
> 子 skill（如 `abap-cli-setup`、`abap-cli-edit`、`abap-cli-data`、`abap-cli-search`）只在本文档之上叠加领域规则,不会覆盖本文档内容。

## 规则

- 设计与实现时优先考虑 LM Agent 使用优化与 token 经济性。
- 每个 command 都使用 skill okf 编写 wiki 知识库。
- spec 是设计文档,**不进** git 仓库；`wiki/commands/` 下的 okf 文档才是命令的最终参考。
- 不要将 bug / spec 等编号写入 changlog/commit/PR 描述/代码注释,也不要在 wiki 中写 "fix #123" 或 "see #456"。
- 编写文档的时候，不要编写解释性标注（如 `（内部代号，已脱敏）`、`（已删除）`、`（已弃用）`）。

## Token-efficient

1. abap cli 的 `--json` 结构化输出只保留 Agent 所需的关键字段,避免冗余信息。

## 架构

项目分三层,各层有自己的目录：

- **CLI**（`src/abap_cli/`）：TypeScript。薄客户端,所有命令都支持 `--json` 输出。
- **SAP**（`abap/`）：ABAP。DDIC CRUD 的 ICF 服务处理器。
- **Agent**（`skills/` + `agents/`）：Markdown。Skill 与工作流提示词。

## 关键约定

- 源对象（Class、Interface、Program、CDS）：通过 `abap-adt-api` 走 ADT REST API。
- DDIC 对象（Domain、DataElement、Table）：自建 ICF 服务,RESTful JSON 通信。
- 文件格式遵循 abap-file-format 约定。
- 配置放在 `.abap.json`（gitignored）。
- 环境变量优先级高于 `.abap.json`。

## 工作风格

### 大胆重构

- 倾向**重写**而非打补丁。代码长歪了,就删掉重建；不要叠加兼容层、deprecated 别名、wrapper。
- 允许 breaking change（公共 CLI 行为、模块结构、文件命名）。每次 breaking 都必须：
  1. 在 `CHANGELOG.md` 顶部（按既有 `## [Unreleased]` 格式）记录。
  2. 在 commit / PR 描述中写明迁移路径或影响面。
- 不要为了"兼容"而兼容——旧代码应消失,而不是与新代码共存。
- 改动必须由 `test/` 覆盖;rewrite 之前或同时补测试。

## 测试

### 可联调的 on-prem 环境

- URL: http://vhcala4hci:50000
- User: developer
- Password: Abap123456@
- Client: 001

- 工作目录: `tmp/s4h`

### 可联调的 BTP Trial 环境

- 工作目录: `tmp/trial`

## 在本项目中工作

- 永不提交 `.env` 或 `.abap.json`（两者都在 `.gitignore` 中；密钥早在 secrets 迁到 OS keychain 后就不再依赖 `.env`,详见 `CHANGELOG` 0.2.1 "Removed — env 密码读取"）。
- 所有新增的 CLI 命令必须注册到 `src/abap_cli/index.ts`。
- 沿用既有命令模式：`export function register<Name>Command(program: Command)`。
- `abap/src/` 下的 ABAP 代码遵循 abap-file-format 文件命名约定。
