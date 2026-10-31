---
type: command
title: abap delete
description: "从 SAP 删除单个 ABAP 对象（lock → delete → unlock）：--type 必填消歧、--yes 显式确认、非 $TMP 对象必须用 --tr 指定传输请求。"
tags: [abap-cli, command, delete, adt, lock, transport, cleanup]
created at: 2026-10-29 14:30:14
changed at: 2026-10-31 16:20:00
---

# abap delete

从 SAP 删除一个 ABAP 对象。这是**写命令**：先按名字和类型解析对象，再 `lock → DELETE → unlock`——无论删除是否成功都会尽力释放锁，避免留下 ADT 锁。

删除规则与 `abap push` 对齐：`$TMP` 对象不需要 transport；其它包的对象必须用 `--tr` 指定一个**打开且可修改**的传输请求。DEVC（包）例外见下方 gotcha：包删除**不加锁**，transportable 判定依据是包的软件组件而不是所在包。`--type` 必填——同名对象可能同时存在多种类型（如 CLAS 与 PROG），不传会报 `AMBIGUOUS_OBJECT`；非交互环境（Agent / CI）必须显式 `--yes`。命令**只删 SAP 端对象，不删除本地文件**；`src/<name>.*` 需要自己清理，否则下一次 `push` 会把它重新创建出来。

## Usage

```bash
abap delete <object> --type <type> [--tr <request>] --yes
abap delete --schema --json
```

## Options

- `<object>`: SAP 对象名（如 `ZCL_MY_CLASS`），不是本地文件名；内部走 ADT quickSearch 解析成对象 URL。
- `--type <type>`: **必填**。对象类型码（`CLAS` / `PROG` / `INTF` / `FUGR` / `DEVC` / `TABL` / `VIEW` / `TRAN` / ...），大小写不敏感。`DEVC` 走独立删除路径（包资源按名字直接寻址，不依赖 quickSearch，也不加锁）；`VIEW` 走 ICF `DELETE /ddic/view/<name>`（仅 `$TMP`，先激活 inactive 版本再 `RS_DD_DELETE_OBJ`）。
- `--tr <request>`: 传输请求号。`$TMP` 对象可省略；其它包必填。
- `--yes`: **必填**。显式确认删除；无 TTY 时缺失直接报 `USAGE`。
- `--schema`: 打印本命令参数 schema 并退出，不调用 SAP。
- `--json` / `--pretty-json`: 全局输出模式，见 [agent-integration](../../docs/agent-integration.md)。

## 前置条件

- 工作区已绑定 profile（`.abap.json`），SAP 可达且凭据有效。
- 对象存在且名字、类型正确；`--tr` 必须是对象所属的打开请求（已释放 / 已关闭的请求会被 SAP 拒绝）。
- 非 `$TMP` 对象需要一个可修改的 transport：先 `abap transport list --open` 或 `abap transport create`。
- 对象没有被其他用户锁住。

## Examples

```bash
# 删除 $TMP 里的临时探针类（不需要 transport）
abap delete ZCL_ZR_CHK9 --type CLAS --yes --json

# 删除非 $TMP 对象：必须带 --tr
abap delete ZR_OLD --type PROG --tr NDK900123 --yes

# 删除 $TMP 下的本地子包（无需 transport，不加锁）
abap delete '$MY_PACKAGE' --type DEVC --yes --json

# 删除 transportable 包：软件组件非 LOCAL，必须带 --tr
abap delete ZPKG_SUB --type DEVC --tr NDK900123 --yes --json

# 同名对象同时是 CLAS / PROG 时用 --type 消歧
abap delete ZFOO --type PROG --tr NDK900123 --yes
```

## Expected Output

成功（`--json`；`$TMP` 对象没有 `transport` 字段，`lockReleased` 反映解锁结果）：

```json
{
  "status": "success",
  "meta": { "command": "abap delete", "version": "1.0.0", "timestamp": "2026-10-31T05:20:11.482Z", "durationMs": 1432, "warnings": [] },
  "data": { "object": "ZCL_ZR_CHK9", "type": "CLAS", "packageName": "$TMP", "deleted": true, "lockReleased": true }
}
```

DEVC 的 envelope 与其他类型同形，但 `packageName` 是**父包**、`lockReleased` 恒为 `false`（包删除不做
lock/unlock）：

```json
{
  "status": "success",
  "meta": { "command": "abap delete", "version": "1.0.0", "timestamp": "2026-10-31T08:09:44.747Z", "durationMs": 1490, "warnings": [] },
  "data": { "object": "$ZCLI_TC_PKG10", "type": "DEVC", "packageName": "$TMP", "deleted": true, "lockReleased": false }
}
```

失败示例（错误信封走 stderr；这里是非 `$TMP` 对象漏传 `--tr`，exit 2）：

```json
{
  "status": "error",
  "meta": { "command": "abap delete", "version": "1.0.0", "timestamp": "2026-10-31T05:21:03.117Z", "durationMs": 803, "warnings": [] },
  "error": {
    "code": "MISSING_TRANSPORT", "category": "USAGE",
    "message": "Object ZCL_MY_CLASS is in package ZDEV; --tr is required",
    "details": { "object": "ZCL_MY_CLASS", "type": "CLAS", "packageName": "ZDEV" },
    "example": "abap delete ZCL_MY_CLASS --type CLAS --tr NDK900123 --yes"
  }
}
```

## 关键错误码

| 错误码 | 类别 / exit | 触发场景 | 恢复 |
|---|---|---|---|
| `USAGE` | USAGE / 2 | 缺 `<object>` / `--type`，或非 TTY 缺 `--yes` | 补参数，参考 `error.example` |
| `OBJECT_NOT_FOUND` | NOT_FOUND / 8 | 名字不存在或类型不匹配 | `abap search <name> --exact` 核对 |
| `AMBIGUOUS_OBJECT` | NOT_FOUND / 8 | 同名多类型且没给 `--type` | 用 `--type` 消歧 |
| `TYPE_NOT_SUPPORTED` | VALIDATION_ERROR / 7 | 该类型没有 ADT delete 端点（如 CDS 视图类类型） | 换受支持的类型；映射以底层 ADT 响应为准 |
| `MISSING_TRANSPORT` | USAGE / 2 | 非 `$TMP` 对象没给 `--tr` | 补 `--tr`，或把对象移到 `$TMP` |
| `LOCK_FAILED` | LOCKED / 9 | SAP 没返回 `LOCK_HANDLE`，通常对象被他人锁住 | 让对方释放锁，或 SE11 检查锁条目后重试 |
| `DELETE_FAILED` | SAP_ERROR / 6 | 加锁后的删除失败（请求已关闭、权限不足等） | 看 `error.details.sapErrorBody` 的 SAP 原文 |

## 真机证据

- **VIEW（数据库视图）**：`abap delete <name> --type VIEW` 走 ICF `DELETE /ddic/view/<name>`；仅 `$TMP` 视图可删（可传输视图返回 `VIEW_DELETE_UNSUPPORTED`，exit 7，请在 SE11 删除）。真机证据待补（SAP stateful 会话阻塞恢复后）。
- **DEVC（包）已在 S/4HANA 8.134.214.7:44300（profile `test`）验证**：`$TMP` 下真实创建 `$ZCLI_TC_PKG10` 后 `abap delete '$ZCLI_TC_PKG10' --type DEVC --yes --json` 成功（复用创建命令的会话时 SAP 先报「包已锁定」，命令自动 logout + 新会话重试后成功），随后 `pull` 返回 404；非 LOCAL 包（ZLOCAL）在缺 `--tr` 时被 `MISSING_TRANSPORT`（exit 2）拦截、未发起删除。证据：`tests/261031002-realsap-devc/`（本地，不入库）。
- **TRAN（事务码）删除走 ICF `DELETE /tran/<tcode>`**（SE93 没有 ADT 端点）：S/4HANA 8.134.214.7:44300（profile `test`）上 `abap delete ZCLI_TC_T1 --type TRAN --yes` 成功，TSTC/TSTCT/TSTCP/TSTCC/TSTCA 与 TADIR 行一并清除，随后 `pull` 返回 404。仅 `$TMP` 事务可删；可传输事务返回 `TRAN_DELETE_UNSUPPORTED`（exit 7，请在 SE93 删除以便记录到请求）。证据：`tests/261031003-realsap-tran/`（本地，不入库）。
- **其它类型未验证**：本页没有记录 CLAS / PROG 等 `abap delete` 在 A4H / S/4HANA 上的真机执行结果。
- 对象解析依赖的 ADT quickSearch quirk（裸名可能 0 命中，需要 `*NAME*` 回退）在 vhcala4hci（A4H）验证过，见 `src/abap_cli/core/resolve.ts` 注释；删除动作本身未验证。

# More

## gotcha

- **本地文件不会删**：命令只调 SAP 的 delete 端点。删完记得清理 `src/` 下对应文件，否则后续 `push` 会把对象重新建出来。
- **`$TMP` 判定依赖搜索结果的包名**：ADT 搜索没返回 `packageName` 时按非 `$TMP` 处理并强制要求 `--tr`，不代表对象真的在传输包里。
- **`--tr` 不能随便传**：必须是对象所属的、打开可修改的请求；传不相关或已关闭的请求会被 SAP 拒绝，最终表现为 `DELETE_FAILED`。
- **`lockReleased: false`**：删除可能已成功但解锁失败；锁可从 SE11 → Utilities → Lock entries 手工清理。DEVC 恒为 `false`（包删除根本不加锁）。
- **DEVC 不加锁**：先 lock 再 `DELETE /sap/bc/adt/packages/<name>` 会被 SAP 以「包已锁定」拒绝。命令对包直接 DELETE（transportable 包带 `corrNr`）。
- **DEVC 的 stale 会话锁**：若更早的 ADT 会话（通常是创建该包的命令）仍持有 enqueue 锁，删除首次会失败；命令内置一次 logout + 新会话重试。仍失败说明锁属于其他用户/会话。
- **DEVC 不能删非空包**：包内仍有对象或子包时 SAP 拒绝删除。
- **DEVC 的 transport 规则**：判定依据是包的软件组件——`LOCAL` 视为本地包（无需 `--tr`），其余（`HOME` / `ZLOCAL` 等）必须 `--tr`。
- **没有 `--dry-run`**：`delete` 不支持预览，`--schema` 是唯一的零副作用路径。

# references

- 实现：`src/abap_cli/commands/delete.ts`、`src/abap_cli/flows/edit/delete.ts`；对象解析 `src/abap_cli/core/resolve.ts`
- 生成参数表：[docs/commands.md](../../docs/commands.md)；`--json` 契约：[agent-integration.md](../../docs/agent-integration.md)
- 所属 skill：[skills/abap-cli-edit/SKILL.md](../../skills/abap-cli-edit/SKILL.md)
