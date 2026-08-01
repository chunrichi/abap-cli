<!-- Sync Impact Report
  Version change: 1.0.0 → 1.1.0
  Added sections:
    - Principle VII: Dogfooding 驱动开发
  Modified sections:
    - Development Workflow (补充 dogfooding 流程)
    - 标题（项目改名 abap-vibe → abap-cli，2026-08-02）
  Removed sections: none
  Follow-up TODOs: none
-->

# abap-cli Constitution

## Core Principles

### I. Agent-First 设计
所有功能通过 CLI 命令可调用。输出支持 JSON（Agent 可解析）和人类可读两种格式。Agent 能做的事不依赖交互式 prompt。

### II. 三层架构分离
项目由三层组成，职责清晰不混杂：
- **CLI 层**（TypeScript）：薄客户端，负责 HTTP 调用、文件读写、结果展示
- **SAP 层**（ABAP ICF 服务）：业务逻辑层，DDIC 对象的创建/修改/验证在 SAP 内部完成
- **Agent 层**（Skill/Prompt）：AI Agent 的行为编排，定义工作流和约束

### III. 文件格式遵循 SAP abap-file-format 规范
本地文件格式以 SAP abap-file-format（https://github.com/SAP/abap-file-formats）为基准。源码对象的文件扩展名和目录结构与 abapGit 惯例保持一致。DDIC 对象的 JSON schema 由 ICF 服务端定义并保持向后兼容。

### IV. 最小可用范围优先
第一版只覆盖核心对象类型，不追求全面覆盖。每新增一种对象类型需要明确的使用场景驱动，并同步更新 CLI 命令、ICF 接口和 Skill 文档。

### V. SAP 端一致性
自建 ICF 服务遵循 SAP 标准开发规范。DDIC 创建操作必须在同一个 LUW 内保证事务完整性。所有 ICF 接口返回统一的 JSON 响应结构（含 status / data / error 字段）。

### VI. 安全与凭证隔离
SAP 凭证不硬编码、不提交到版本控制。支持项目级配置文件 + 环境变量覆盖。Agent 不应被赋予超出必要范围的 SAP 权限。

## Technology Stack

- **CLI**: TypeScript + Node.js，通过 npm/npx 分

### VII. Dogfooding 驱动开发
SAP 端 ICF ABAP 服务的开发必须使用 CLI 自身完成（pull → edit → push → check 循环）。不允许绕过 CLI 直接在 Eclipse/SAP GUI 中开发 ICF 服务代码。这样确保 CLI 在实际使用中被持续验证和打磨，问题在开发阶段即被发现。发
- **ADT 客户端**: 复用 `abap-adt-api` npm 包处理源码对象的 CRUD 及开发工具链（语法检查、激活、ATC 等）
- **DDIC 服务**: SAP 端自建 ICF 服务（RESTful JSON），覆盖 Domain、Data Element、Table、Structure、Table Type 的创建与修改
- **文件格式**: abap-file-format 规范，源码用纯文本 `.abap`，DDIC 用 `.json`

## Development Workflow

- CLI 和 ICF 服务可以独立开发和测试
- Skill 文档先于实现定义（先写 spec，再写代码）
- Agent 测试通过
- ICF ABAP 服务的开发遵循 Dogfooding 原则：用 CLI 的 pull/push/check 命令完成代码的下载、编辑、上传和验证实际的 pull → edit → push 端到端工作流验证

## Quality Gates

- CLI 命令必须有 `--json` 输出模式
- ICF 服务必须返回结构化错误信息（不能只有 HTTP 状态码）
- 每种支持的对象类型必须有完整的 pull → edit → push 端到端测试

## Governance

1 Constitution 是项目的最高设计约束。所有实现决策必须与上述原则一致。修改 Constitution 需要记录变更原因并更新版本号。

**Version**: 1.1.0 | **Ratified**: 2026-07-31 | **Last Amended**: 2026-08-02
