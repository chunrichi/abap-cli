# abap CLI 建议汇总（命令优化 / 新命令扩展 / 差异化新命令）

> 本文档脱离既有 spec（001–014）与旧 roadmap 框架，从工具终局形态出发整理。
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
| `--schema` | 仅 `search`/`create` 有 | 推广到所有命令（尤其 `push`/`pull`），形成统一自描述协议 | agent 无需读文档即可调用任意命令 | - [ ] |
| `--dry-run` | 各命令实现不一（有的出 plan 有的只是 no-op） | 统一为"输出机器可读 plan 对象 + exit 0"，统一 `--plan` 命名 | 一致可组合原则 | - [ ] |
| `doctor --fix` | 只做安全可逆修复 | `doctor --fix --all` 分级（安全/需确认），输出"修复前后 diff" | 提升自助修复能力 | - [ ] |

## 二、建议扩展的新命令（补齐能力空白）

| 命令 | 功能 | 使用场景 | 价值 | 状态 |
|------|------|---------|------|------|
| `abap delete` | 删除对象（source/DDIC），支持 `--dry-run`/`--force` | 目前完全没有删除能力 | 补齐对象生命周期最后一块 | - [ ] |
| `abap test` | 运行 ABAP 单元测试（复用 `runClass`，跑 `cl_abap_unit_assert` 类），输出测试结果 JSON | 修改类后验证不破坏既有测试 | 让"改-验"闭环自动化 | - [ ] |
| `abap where-used` / `references` | 查询对象引用/使用处（SE85/RSWBO 数据） | agent 重构前评估影响面 | 重构安全性的关键信息 | - [ ] |
| `abap release` | 释放传输请求（`WS_RELEASE` 类） | 变更完成后的收尾 | 与 `transport create` 对称 | - [ ] |
| `abap watch` | 监听本地目录，文件变更自动 `check`→`push` | 本地编辑时实时反馈 | 开发者体验提升（注意与 agent 模型配合） | - [ ] |
| `abap export` | 批量导出对象快照（含文本池/DDIC）到可版本化目录 | 备份、迁移、审计 | 使本地成为可版本化的完整镜像 | - [ ] |
| `abap package` | 包管理：`list`/`show`/`create`、查看包内对象与依赖 | 探索系统结构、批量操作 | 弥补 `pull --package` 之外的管理能力 | - [ ] |
| `abap upgrade` | 对比本地 CLI 内置 ICF 服务版本与远端，一键升级 | 版本漂移（`deploy status` 已能探测 outdated） | 把 `deploy` 的升级路径独立出来 | - [ ] |
| `abap logs` | 查看 ICF 服务/应用日志、ATC 结果历史 | 排障、审计 | 诊断闭环 | - [ ] |

## 三、真正的差异化新命令（脱离 roadmap 的终局能力）

| 命令 | 功能 | 为什么这是空白 | 价值 | 状态 |
|------|------|--------------|------|------|
| `abap run` | 执行类方法或 report（`ZCL_X=>method` 或 classrun），返回 stdout/返回码 | 底层 `runClass` 已存在（`deploy` 在用）但只对内部暴露；现在 agent 只能"编译"不能"运行" | 从静态开发跨到动态验证：push 后直接跑一次看结果。agent 闭环里最缺的一环 | - [ ] |
| `abap select` | 只读查询表数据（`--table ZTAB --fields ... --where ... --limit`），走 ICF 新增 `/data` 端点 | 014 spec 只做 DDIC **定义** CRUD，完全不碰**数据**；ABAP 排障 90% 是"看这条记录" | 给 agent 提供 SE16N 等价能力，测试/验证/排障全自动化 | - [ ] |
| `abap gen` | 基于系统元数据生成代码：给表名 → 生成 CRUD 类/报告/选择屏幕骨架 | `create --template` 是**静态**模板，不知道系统里有什么 | 把"系统知识"变成生成输入，agent 生产力放大器 | - [ ] |
| `abap impact` | 影响分析：对象被谁引用、引用链、激活风险，输出 JSON 调用图 | `search`/`inspect` 只答"是什么"，不答"改它会炸什么" | 重构安全性的核心决策数据 | - [ ] |
| `abap docs` | 从对象生成文档（类/接口/方法说明、签名、依赖） | 现在全是读代码 | 让 agent 读懂存量代码后给出总结 | - [ ] |
| `abap snapshot` | 把整个包/传输导出为可版本化完整快照（含数据），可跨系统比对/恢复 | 现在 pull 是单对象的 | 备份、迁移、多系统同步的地基 | - [ ] |

## 四、跳出"命令集合"的重新设计

| 项目 | 设想 | 价值 | 状态 |
|------|------|------|------|
| `abap serve`（协议化） | 常驻进程 + JSON-RPC 行协议，暴露现有全部能力；CLI 命令保留为人类 fallback，共享同一 `flows/` 层 | 免冷启动（keytar/abap-adt-api 加载重）、复用连接池、支持流式进度/取消；改变 agent 调用方式 | - [ ] |
| 领域 DSL 收敛 | 从 18 个扁平命令收敛为少量核心动词 + 通配对象寻址：`get`/`put`/`status`/`run`/`data` | 让 agent 只记 5 个动词而非 18 个专名；`--schema` 已提供机器自描述 | - [ ] |
| 多 agent 并发协调 | `abap lock <obj> --owner <agent-id>` 显式声明归属、超时自动释放；`push` 前强制检查 owner，冲突返回 `LOCKED` 并指认持有者 | 从"单 agent 工具"到"多 agent 平台"的架构性转变 | - [ ] |
| 撤销/时间旅行 | `abap restore <obj> --from <snapshot>` 从快照恢复到 SAP，配合 `snapshot` 形成"提交点→实验→回滚"循环 | 让 agent 敢于试验，可逆操作 | - [ ] |

## 五、优先级建议

| 优先级 | 项 | 理由 |
|--------|-----|------|
| P0 | `abap run` | 底层已就绪、改动最小、收益最大——补上"验证"这个 agent 闭环缺口 |
| P1 | `abap select`（数据层） | ICF 服务已建好，扩展一个端点即可；覆盖开发最高频需求 |
| P1 | `abap serve`（协议化） | 改变交付形态，与"agent-native"目标完全一致 |
| P2 | `abap gen` / `abap impact` | 生产力放大器，但依赖前两者稳定 |
| P2 | 多 agent 协调 / 快照回滚 | 从单工具到平台的关键，但场景还没到 |
