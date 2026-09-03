---
type: reference
title: abap-cli 架构与序列图
description: 三层架构图 + 端到端 pull/push 序列图（Mermaid 渲染）
tags: [abap-cli, architecture, diagram, mermaid, sequence]
created at: 2026-09-01 00:00:00
changed at: 2026-09-01 00:00:00
---

# abap-cli 架构与序列图

## 1. 三层架构图

```mermaid
flowchart LR
  subgraph User["用户工作区"]
    A[".abap.json<br/>项目配置"]
    Src["src/<br/>源码/DDIC/HTTP/TRAN<br/>本地文件"]
  end

  subgraph Agent["Agent 层 (Markdown)"]
    Skill["skills/abap-cli-*<br/>4 领域 + 1 meta"]
    Agent2["agents/abap-developer<br/>9 步工作流"]
  end

  subgraph CLI["CLI 层 (TypeScript)"]
    Index["index.ts<br/>命令注册 + 启动"]
    Flows["flows/<br/>业务流"]
    Clients["clients/<br/>ADT / ICF / Auth"]
    Output["output/<br/>envelope + error codes"]
    Formats["formats/<br/>abap-file-format 双向映射"]
  end

  subgraph SAP["SAP 层 (ABAP)"]
    ADT["ADT REST API<br/>源对象 CRUD"]
    ICF["/sap/zabap_vibe<br/>自建 ICF 服务<br/>(DDIC/HTTP/TRAN/select)"]
  end

  User --> Agent
  Agent -->|"`abap <cmd> --json`"| CLI
  CLI -->|"HTTP + JSON"| ADT
  CLI -->|"HTTP + JSON"| ICF
  CLI --> Src
  ICF -.->|"编排 CLI 命令"| CLI
```

### 关键边界

| 边界 | 协议 | 方向 |
|---|---|---|
| Agent → CLI | 子进程 + JSON envelope (stdout/stderr) | 双向 |
| CLI → ADT | HTTPS + XML/JSON | CLI → SAP |
| CLI → ICF | HTTPS + JSON | CLI → SAP |
| CLI → 本地文件 | fs/promises | 双向 |

---

## 2. 端到端 `pull` 序列图

```mermaid
sequenceDiagram
  autonumber
  participant A as AI Agent
  participant CLI as abap-cli
  participant SAP as SAP ADT
  participant FS as 本地 fs

  A->>CLI: abap pull ZCL_X --json
  CLI->>CLI: 解析 argv + 加载 .abap.json
  CLI->>CLI: AdtClientWrapper.create()
  CLI->>SAP: GET /sap/bc/adt/.../objectStructure
  SAP-->>CLI: XML (parts + metadata)
  CLI->>CLI: resolveObject() + 路由 (CLAS/DOMA/TABL/...)
  CLI->>SAP: GET /sap/bc/adt/.../source/main (×N includes)
  SAP-->>CLI: 源码
  CLI->>CLI: abap-file-format normalize
  CLI->>FS: write src/clas/zcl_x/zcl_x.clas.json
  CLI->>FS: write src/clas/zcl_x/zcl_x.clas.abap
  CLI-->>A: { status: "success", meta, data: { object, type, entries, written, skipped, failed } }
  A->>A: edit zcl_x.clas.abap
```

---

## 3. 端到端 `push` 序列图（含失败分支）

```mermaid
sequenceDiagram
  autonumber
  participant A as AI Agent
  participant CLI as abap-cli
  participant SAP as SAP ADT

  A->>CLI: abap push src/clas/zcl_x/ --tr DEVK900001 --yes --json
  CLI->>CLI: resolveLocalTargets() — 扫目录
  CLI->>SAP: POST .../lock (lockhandle)
  SAP-->>CLI: lockhandle (or 423 Locked)
  alt 锁失败
    CLI->>CLI: 抛 LOCK_FAILED (exit 9)
    CLI-->>A: { status: "error", error: { code: "LOCK_FAILED", nextSteps: [...] } }
  else 锁成功
    CLI->>SAP: PUT .../source/main (setObjectSource)
    SAP-->>CLI: 200 (or 4xx syntax)
    CLI->>SAP: POST .../activate
    SAP-->>CLI: 200 (or 4xx activation errors)
    CLI->>SAP: DELETE .../lock
    SAP-->>CLI: 204
    CLI-->>A: { status: "success", meta, data: { transport, lockhandle, activation: { ok, errors[] } } }
    A->>A: inspect ZCL_X --activation 复核
  end
```

---

## 4. ICF 自托管服务调用（DDIC / HTTP / TRAN / SELECT）

```mermaid
sequenceDiagram
  autonumber
  participant A as AI Agent
  participant CLI as abap-cli
  participant ICF as ICF /sap/zabap_vibe
  participant ABAP as ABAP 运行时

  Note over CLI,ICF: 仅当目标命令是 DDIC/HTTP/TRAN/select/run --method 时

  A->>CLI: abap pull ZMY_TABLE --type TABL --json
  CLI->>CLI: 路由识别 typeUpper === 'TABL' → runPullDdic()
  CLI->>ICF: GET /ddic/TABL/ZMY_TABLE
  ICF->>ABAP: read TABL definitions via abap-file-format
  ABAP-->>ICF: formatVersion + header + format + fields
  ICF-->>CLI: JSON wire payload (main + ddicSource + settings)
  CLI->>CLI: extractTablArtifactWire() → wireToLocal()
  CLI-->>A: { data: { files: ["zmy_table.tabl.json", "zmy_table.tabl.ddic", ...] } }
```

---

## 5. Auth Strategy 路由

```mermaid
flowchart TD
  Start["profile add / init"] --> Auth{auth.method}
  Auth -->|basic| B["User + Password<br/>→ ADTClient.password<br/>→ keychain"]
  Auth -->|browser_sso| SSO["sso-loopback.ts<br/>127.0.0.1 捕获 cookie<br/>→ Cookie header"]
  Auth -->|cert| C["X.509 cert + key<br/>→ https.Agent<br/>→ 'x509-cert-auth' 占位密码"]
  Auth -->|oauth_password| O["Username + Password<br/>→ reentranceticket / oauth2<br/>→ Bearer token"]
  B --> Apply["buildAuth() → ClientOptions"]
  SSO --> Apply
  C --> Apply
  O --> Apply
  Apply -->|应用到 ADT + ICF| Done["同一认证对 ADT 与 ICF 通用"]
```

---

## 6. 错误处理与退出码

```mermaid
flowchart LR
  Cmd["CLI 命令"] --> Throw["throw CliError(code, msg)"]
  Throw --> Render["renderError('json', err, meta)"]
  Render --> Stderr["stderr: {status, meta, error}"]
  Render --> Exit["exit exitCodeFor(category)"]
  Throw -.->|"HTTP 异常"| Wrap["http-error.ts<br/>wrapHttpError()"]
  Wrap --> Render
  Exit -->|1 UNKNOWN| E1["环境/未知"]
  Exit -->|2 USAGE| E2["缺参/拼错"]
  Exit -->|3 CONFIG_ERROR| E3["profile 缺失"]
  Exit -->|4 TLS_ERROR| E4["证书/TLS"]
  Exit -->|5 AUTH_ERROR| E5["401/403"]
  Exit -->|6 SAP_ERROR| E6["SAP 5xx/ICF error"]
  Exit -->|7 VALIDATION_ERROR| E7["语义校验"]
  Exit -->|8 NOT_FOUND| E8["对象/类/表"]
  Exit -->|9 LOCKED| E9["对象被锁"]
```

---

## 7. 扩展加载信任链

```mermaid
sequenceDiagram
  autonumber
  participant CLI as CLI 启动
  participant LF as extensions.lock.json
  participant AR as argv sniff
  participant LZ as lazy loader
  participant EX as 扩展 npm 包

  CLI->>LF: readLockfile()
  CLI->>AR: isMetaExtensionsCommand(argv)?
  alt meta 命令 (extensions list/lock)
    AR->>LZ: loadAll(config.extensions)
  else 普通命令
    AR->>LZ: tryLoadCommandExtensionsForArgv(argv)
    LZ->>LF: 查每条扩展的 sha512
    LZ->>EX: import(pkg) — 仅匹配 argv 的 type: command
  end
  LZ->>LF: node:crypto verify sha512
  alt 哈希不匹配
    LZ-->>CLI: throw EXTENSION_LOAD_FAILED (exit 3)
  else 哈希通过
    LZ->>EX: 加载模块
    EX->>CLI: register(program)
  end
  CLI->>CLI: preAction hook: loadRemainingExtensions (validation + lifecycle)
```

---

## 8. 端到端命令全景

```mermaid
mindmap
  root((abap))
    读
      search
      where-used
      inspect
      tcode
      dumps
      diff
      status
    写
      create
        local
      pull
      push
      check
        syntax
        content
        atc
      activate
    运行时
      run
      select
    配置
      init
      profile
        add
        set
        test
        delete
        export
        import
        login
      doctor
      transport
        list
        create
        show
        resolve
        assign
    扩展
      extension
        deploy
        status
      extensions
        list
        lock
```

---

# references

- 架构文档：[`docs/architecture.md`](../docs/architecture.md)
- 设计决策录：[`wiki/design-decisions/`](design-decisions/)
- 命令文档：[`docs/commands.md`](../docs/commands.md)
- 错误码实现：[`src/abap_cli/output/error-codes.ts`](../src/abap_cli/output/error-codes.ts)
- 退出码实现：[`src/abap_cli/output/exit-codes.ts`](../src/abap_cli/output/exit-codes.ts)
