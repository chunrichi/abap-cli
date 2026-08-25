# 项目要求

**大胆探索，小心求证，勇于重构**

## rules

- 设计实现时考虑 LM Agent 使用优化以及 Token-efficient
- 为每个 command 使用 skill okf 编写 wiki 知识库。
- spec 是设计文档，不进 git 仓库，wiki/commands/ 下的 okf 文档才是最终的命令参考。

## Token-efficient

1. abap cli 的 --json 结构化输出（Structured Output）时只保留 Agent 所需的关键字段，避免冗余信息。
