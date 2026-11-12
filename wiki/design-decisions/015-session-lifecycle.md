---
type: decision
title: 会话复用的存储与生命周期
description: 把「写盘成功」改为「durable 存储 + 会话身份完整 + 未被拒绝」才保留会话；移除 $TMPDIR 兜底，新增工作区存储与结构化降级告警
tags: [abap-cli, design-decisions, session, reuse, sm04, cookie, sap-contextid, agent-sandbox]
created at: 2026-11-01 12:10:00
changed at: 2026-11-01 12:10:00
---

# 会话复用的存储与生命周期

## 决策

CLI 只在满足全部条件时于命令结束后保留 SAP 会话，否则登出：

1. jar 写入了 **durable 会话存储**：`ABAP_CLI_SESSION_DIR` → `~/.abap-cli/sessions` → `<workspace>/.abap-cli/sessions`；
2. jar 含 stateful `SAP_SESSIONID_*` **及其 `sap-contextid`**（两者是一个身份，不能拆开）；
3. 回放没有被连续拒绝（`reuseFailures < 2`）。

`$TMPDIR` 不再是存储候选。没有可用存储时降级为「每条命令登录 + 登出」，并以 `SESSION_REUSE_DISABLED` 等结构化 warning 暴露在 `--json` 的 `meta.warnings`。

释放会话优先走 ADT 的 close-session 交换（`GET /sap/bc/adt/core/http/sessions`，带 `sap-contextid` 与 stateless 会话类型）；NW 7.50 没有该资源时回退 stateless discovery，最后才回退旧 ICF logoff。关闭失败不再静默，stderr 输出 `WARN`。

## 上下文

CLI 是短生命周期进程，跨命令复用 SAP 会话靠一个加密的 session jar。此前的实现有两个叠加缺陷：

- **持久化判定错误**：只要某个候选路径 `writeFileSync` 成功就认为「下一条命令可复用」。在 agent sandbox（HOME 只读、`$TMPDIR` 可能是 per-process）里，jar 写到下一条进程读不到的位置，本进程仍保留会话 → 一条命令一个 SM04 孤儿会话；结束时的安全网（`drainUnreusableClients`）因此永远不触发。
- **会话身份不完整**：为了规避匿名 `sap-contextid` 导致的 `400 Session not found`，实现把**所有** `sap-contextid` 都从 live cookie map 和 jar 中丢掉。但在 S/4HANA 上，stateful ADT 请求缺少配对 context cookie 时会被**静默**路由到新会话（HTTP 200、无报错）：jar 里的登录会话从未被真正复用。实测 5 条 `abap search` → 5 个新会话；补上 context cookie 后 → 1 个会话。

同时 ICF 内置服务默认 stateful：每个走 ICF 的命令在 SM04 留一个会话；客户端此前注入 ADT jar cookie 也从未真正加入 ICF 会话。

## 被否决方案

- **继续用 `$TMPDIR` 兜底 + 更聪明的探测**：无法证明「下一条命令能看到同一个目录」；两阶段握手/子进程探针都不可靠且昂贵。只在显式 `ABAP_CLI_SESSION_DIR` 下允许（用户对 durability 负责）。
- **常驻 session broker（unix socket / 命名管道）**：能彻底解决跨进程问题，但要处理 socket 路径限制、Windows 命名管道、daemon 生命周期/版本/安全/沙箱后台进程策略，复杂度远大于收益；暂不引入。
- **jar 存 OS keychain**：sandbox 可行，但 Windows Credential 大小限制、Linux 无 keychain、与现有「key 存 keychain、jar 存文件」模型冲突；列为备选。
- **jar TTL / 最大空闲时间**：SAP 会话过期由「401 一次 + 重新登录」自然覆盖，TTL 只会增加无谓登录；用连续失败计数自愈替代。
- **read-only 命令全走 stateless ADT**：可能进一步减少会话，但库的 `login()` 同时负责设置 basic auth、且 stateless 下部分 ADT 语义未验证；留作后续优化。

## 当前代价

- 会话 jar 多了一个候选位置（`<workspace>/.abap-cli/`），agent 工作区会出现该目录（自忽略、0700/0600、加密）。
- `abap session info --json` 的 `data` 形状是 breaking change：改用 `store` / `candidates` / `jar`，老脚本需要迁移。
- 连续两次被 SAP 拒绝后，后续命令要等 10 分钟或 `abap session reset` 才恢复复用；期间是「登录 + 登出」（正确但慢一点）。
- SIGKILL / OOM 仍无法执行收尾，会话依赖 SAP 侧超时回收（会话账本未实现）。

## 后果

`SM04` 不再按命令数增长：能复用时跨命令只保留一个会话，不能复用时每条命令都关闭会话；ICF 请求不再占用用户会话。关闭走 ADT close-session，因此禁用 ICF logoff（403）的系统也不再泄漏会话；关闭失败会显式告警，便于人工清理。agent/sandbox 场景无需配置即可工作，诊断信息（`abap session info` / `doctor` / `meta.warnings`）能直接回答「为什么没复用」。实现见 `src/abap_cli/session/{store,manager,cookies,jar,key}.ts`、`clients/{adt-session-close,session-http,raw-adt-session}.ts` 与 `wiki/commands/session.md`。
