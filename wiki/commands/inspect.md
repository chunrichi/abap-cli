---
type: command
title: abap inspect
description: 只读探测 SAP 对象元数据 — structure / includes / locks / activation / package / versions / symbols，不获取锁、不修改 SAP
tags: [abap-cli, command, inspect, metadata, read-only, agent-loop, versions, symbols]
created at: 2026-08-09 22:40:00
changed at: 2026-11-01 00:20:00
---

# abap inspect

只读探测 SAP 对象元数据，**不获取锁、不修改 SAP**。给 agent 一个稳定的"对象是什么样 / 现在状态如何 / 历史改过什么 / 成员在哪一行"探针——是 `abap-object` skill 决策树的关键工具。

## Usage

```bash
abap inspect <object> [--structure] [--includes] [--locks] [--activation] [--package]
abap inspect <object> --versions [--include <part>] [--limit <n>] [--show <version>] [--out <file>]
abap inspect <object> --symbols [--kinds method,attribute] [--name-pattern <regex>]
abap inspect ZCL_FOO --structure --json
abap inspect ZCL_FOO --activation --json    # 诊断 stale 激活
abap inspect ZCL_FOO --versions --json      # 版本历史（ADT versions feed）
abap inspect ZCL_FOO --symbols --json       # 扁平符号表 + 行号
```

## Options

| flag | 含义 |
|---|---|
| `--structure` | 含结构元素（methods / attributes / events） |
| `--includes` | 含 class include parts 列表 |
| `--locks` | 含锁 / transport 归属（只读） |
| `--package` | 含对象包名 |
| `--activation` | 校验 active vs latest source per part（只读；检测 stale 激活） |
| `--versions` | 读版本历史（ADT versions feed；只读） |
| `--include <part>` | `--versions` 的 include：main / definitions / implementations / macros / testclasses（默认 main） |
| `--limit <n>` | 版本条数上限（默认 50，1–200） |
| `--show <version>` | 取某一版本的源码（需 `--versions`） |
| `--out <path>` | 把 `--show` 的源码写入文件（不写 `data.source`） |
| `--symbols` | 把类/接口结构树扁平化为符号表 + 源码行号 |
| `--kinds <list>` | 按 kind 过滤 `--symbols`（逗号分隔：method / attribute / event / …） |
| `--name-pattern <regex>` | 按名字过滤 `--symbols`（大小写不敏感正则） |
| `--type <type>` | 对象类型消歧（CLAS / PROG / INTF 等） |
| `--schema` | 打印本命令参数 schema（unified envelope，无 SAP 调用） |

无 flag 时返回对象基础元数据；`--activation` 是最常用的诊断 flag；`--versions` / `--symbols` 用于"改前省 token / 改后可追溯"。

## --activation（核心诊断）

逐 part 对比 active 源码 vs latest（inactive）源码，输出 `{ ok, parts: [...] }`：

> **仅对 ADT structure 暴露 include parts 的对象生效**（CLAS / INTF / PROG 等）。
> 对象没有 include parts（如 FUGR）时不输出 `activation` 键——`data` 只有
> `metadata`，退出码仍为 0。Agent 必须把缺失的 `activation` 视为「该对象类型不
> 适用」，而非错误；FUGR 这类对象的激活/收敛用 `abap status` / `abap diff` 验证。

- `ok: true` — 每个 *implementation* part 的 active = latest（没有 stale）
- `ok: false` — 有 implementation part 未激活或不一致

> **OO 类 `source/main` part 的 `active` 字段不可信**：
>
> OO 类（`CLAS/OC`、`INTF/OI`）的 `source/main` 是 SAP 系统生成的 INCLUDE 程序，
> 其 active 版本由服务端重生成（lowercase、`create private .`、合成 section
> 头），字节永远不与用户写入的 latest 一致——这是 SAP 语义而非 CLI 缺陷。
>
> 这类 part 会带 `note` 字段说明，**Agent 不应根据 `main.active: false` 触发
> `abap activate`**；应读 `ok`（基于 `definitions` / `implementations` /
> `testclasses` / `macros` 的 active 一致性）。

每 part 结构：

```jsonc
{
  "includeType": "main" | "definitions" | "implementations" | "testclasses" | "...",
  "sourceUri": "/sap/bc/adt/oo/classes/zcl_foo/source/main",
  "active": true | false,
  // 仅 OO 类的 `main` 出现：解释 SAP 系统生成 INCLUDE 的字节 mismatch。
  "note": "SAP-managed INCLUDE: active version is regenerated server-side ..."
}
```

## --versions（版本历史）

读取对象（或类 include 分片）的 ADT versions Atom feed，返回 `{ include, count, versions[] }`，每项含 `version / date / author / title / uri`（对象级 feed 还可能带 `transport`）。

- `version` 取 feed 的 `atom:id`（与 ADT 编辑器里看到的版本号一致）；上游库的 `revisions()` 只看 transport 链接，在类 include feed 上会返回空版本号，因此这里自行解析 feed（见 `formats/versions-feed.ts`）。
- 默认 `--include main`；CLAS / INTF 可指定其它 include。非类对象只支持 main（传 `--include` → `INVALID_ARGUMENT`）。
- `--show <version>` 取该版本源码：`--json` 时进 `data.versions.shown.source`；配 `--out <file>` 时写入文件并回 `data.versions.shown.out`（cwd 相对 POSIX 路径）。
- 没有 versions link（例如对象从未纳入版本管理）→ `TYPE_NOT_SUPPORTED`（exit 7），**不要当空历史**。
- `--show` / `--out` / `--include` 必须与 `--versions` 同时使用，否则 `USAGE`（exit 2）。

```jsonc
{
  "versions": {
    "include": "main",
    "count": 2,
    "versions": [
      { "version": "000002", "date": "2026-10-31T10:00:00Z", "author": "DEV", "title": "Second version", "uri": "/sap/bc/adt/oo/classes/zcl_foo/source/main?version=000002" }
    ],
    "shown": { "version": "000002", "source": "CLASS zcl_foo DEFINITION PUBLIC.\n..." }
  }
}
```

## --symbols（结构符号 + 行号）

把 ADT `objectstructure` 树扁平化为一层 `symbols[]`，每项：`name / kind / type / visibility / level / startLine / endLine`（以及 `constructor / final / redefinition / testmethod` 可选布尔）。行号来自结构元素 atom link 的 `#start=12,4;end=40,7` fragment；后端不返回 fragment 时 `startLine/endLine` 为 `null`。

- 仅 CLAS / INTF 支持；其它类型返回 `{ supported: false, reason }`（exit 0），不要当空符号表。
- `count` 始终返回（即使 `symbols` 被 `stripEmpty` 去掉），agent 按 `supported` + `count` 判断。
- `--kinds` 与 `--name-pattern` 在 CLI 侧过滤；非法正则会提前 `INVALID_ARGUMENT`（exit 2）。

```jsonc
{
  "symbols": {
    "supported": true,
    "count": 2,
    "symbols": [
      { "name": "RUN", "kind": "method", "type": "CLAS/OM", "visibility": "public", "startLine": 5, "endLine": 9 },
      { "name": "MV_COUNT", "kind": "attribute", "type": "CLAS/OA", "visibility": "private", "startLine": null, "endLine": null }
    ]
  }
}
```

## 使用场景

- **推送后激活验证**：`push` 报 `activated` 但 `inspect --activation` 仍报 `ok: false` → method/OSI 层级没激活（013 dogfooding）→ 用 `abap activate <obj> --yes` 修复
- **锁归属诊断**：`push` 报 `LOCK_FAILED` 时，`inspect --locks` 看谁持有 + 该对象绑定到哪个 transport
- **包与对象关系**：选 `--package` 在批量 pull 前看每个对象的归属

## --json 输出信封

```jsonc
{
  "status": "success",
  "meta": { "command": "abap inspect", ... },
  "data": {
    "metadata": { "object": "ZCL_FOO", "type": "CLAS", "uri": "..." },
    "structure": { /* methods / attributes / events */ },
    "includes": ["main", "definitions", "implementations", "testclasses"],
    "locks": {
      "editor": "DEVUSER",
      "transport": "DEVK900123"
    },
    "package": "ZDEV",
    "activation": {
      "ok": false,
      "parts": [
        { "includeType": "main", "sourceUri": ".../source/main", "active": true, "note": "SAP-managed INCLUDE: ..." },
        { "includeType": "implementations", "sourceUri": ".../source/implementations", "active": false }
      ]
    }
  }
}
```

`--activation.ok: false` 时 `data.parts[]` 列出未激活 part；恢复路径在 `nextSteps` 里直接给 `abap activate <obj> --yes`。

`activation` 键只在该对象 ADT structure 暴露 include parts 时出现（见上节）——
对没有 include parts 的对象（如 FUGR），即使传了 `--activation`，`data` 也只有
`metadata`、没有 `activation` 键。

## Examples

```bash
# 基础元数据
abap inspect ZCL_FOO --json

# 诊断 stale 激活
abap inspect ZCL_FOO --activation --json

# 查锁 / 归属
abap inspect ZCL_FOO --locks --json

# 查结构（methods / attrs）
abap inspect ZCL_FOO --structure --json

# 多个 flag 组合
abap inspect ZCL_FOO --includes --locks --package --json
```

## Expected Output

```json
{
  "status": "success",
  "meta": { "command": "abap inspect", "version": "0.2.0", ... },
  "data": {
    "metadata": { "object": "ZCL_FOO", "type": "CLAS", "uri": "/sap/bc/adt/oo/classes/zcl_foo" },
    "includes": ["main", "definitions", "implementations", "testclasses"],
    "package": "ZDEV",
    "activation": { "ok": true, "parts": [...] }
  }
}
```

## 关键错误码

| 错误 | 类别 / exit | 含义 | 恢复 |
|---|---|---|---|
| `OBJECT_NOT_FOUND` | NOT_FOUND / 8 | 对象不存在 | `abap search <name>` 校对 |
| `TYPE_NOT_SUPPORTED` | VALIDATION_ERROR / 7 | 对象没有 versions feed（`--versions`） | 改用 `--activation` 校验状态 |
| `INVALID_ARGUMENT` | USAGE / 2 | `--limit` 越界 / 坏正则 / 未知 version / `--include` 不适用 | 按 `error.details` 校正参数或先列版本 |
| `SAP_ERROR` | SAP_ERROR / 6 | ADT 元数据查询失败 | `abap doctor` 诊断 ADT 探针 |

## 关联命令

- **`abap activate`**：修复 `--activation.ok: false` 的 stale 状态
- **`abap push`**：`LOCK_FAILED` 时用 `--locks` 查持有者
- **`abap search`**：对象不存在时先 search 校对
- **`abap pull`**：拉对象的本地副本（需要 lock；inspect 是只读）

# More

## fixme

- [ ] OO 类 `source/main` 的 `active` 由 SAP 服务端重生成，字节级比较永远不一致；只能靠 `hasPendingInactiveVersion` + 非 main part 判定（`note` 已随 part 返回，agent 不应据 `main.active` 触发 `abap activate`）
- [ ] `--locks` 读的是 `transportInfo`（transport 归属），不是 ADT 编辑会话锁；他人持锁时它给不出当前锁持有者

## todo

- [ ] `--structure` 仍直接透传 ADT `objectStructureElements`，嵌套语义未在页面展开；需要扁平符号时用 `--symbols`
- [ ] `--activation` 对没有 include parts 的对象（如 FUGR）不返回 `activation` 键；这类对象的收敛验证仍靠 `status` / `diff`，待统一
- [ ] 真机证据待补：旧 release 上 `hasPendingInactiveVersion` 不可查询时的 fallback 行为
- [ ] 真机证据待补：`--versions` / `--symbols` 在 S/4HANA 上的行号与 versions feed 形状（当前只有 mock/unit 证据）

# references

- 实现: [src/abap_cli/commands/inspect.ts](../../src/abap_cli/commands/inspect.ts) · [src/abap_cli/flows/search/inspect-ops.ts](../../src/abap_cli/flows/search/inspect-ops.ts)（`inspectObject` / `checkActivation` / `readVersions` / `flattenSymbols` / `parseLineRange`）
- 对象解析: `src/abap_cli/core/resolve.ts`（`resolveObject` / `getObjectParts`）、`src/abap_cli/clients/adt-client.ts`（`objectStructure` / `objectStructureElements` / `transportInfo` / `adtFeed` / `getObjectSource`）、`src/abap_cli/formats/versions-feed.ts`（versions Atom feed 解析）
- 文档: [docs/commands.md#abap-inspect](../../docs/commands.md#abap-inspect)
- 相关命令页: [abap activate](activate.md)、[abap diff](diff.md)、[abap status](status.md)、[abap pull](pull.md)
- 测试: `test/unit/inspect.test.ts`、`test/unit/inspect-activation.test.ts`、`test/unit/inspect-versions-symbols.test.ts`（versions 列表/show/out/NOT_SUPPORTED/参数校验、symbols 扁平化/行号/过滤/非类对象）
- 修复脚本：直接走 `abap inspect <obj> --activation --json` + `abap activate <obj> --yes --json`（agent 按 SKILL.md 错误恢复表现写）
