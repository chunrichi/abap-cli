# commands-quick — abap-cli-performance

`abap-cli-performance` **不直接拥有**任何命令。本 skill 的 `metadata.commands` 是其他领域 skill 的**只读**子集；性能 review 全程不写对象。

## 触发的命令（只读，全部走 `--json`）

| 命令 | 用途 | 归属 skill |
|---|---|---|
| `abap search <obj> --exact --page-all --json` | 定位慢对象的所有者 / 包 | `abap-cli-search` |
| `abap inspect <obj> --structure --includes --json` | 看 method / include 树 | `abap-cli-search` |
| `abap pull <obj> --json` | 拉源代码到本地以读 | `abap-cli-edit`（读路径步骤） |
| `abap check <file> --json` | 改完后语法核验 | `abap-cli-edit` |
| `abap check atc <file> --variant <var> --json` | ATC variant 检查 | `abap-cli-edit` |
| `abap select --table <name> --fields ... --where ... --limit N --json` | 有界数据采集 | `abap-cli-data` |

## 关键约定

- 调查阶段 `search / inspect / pull / select` 全部走 `--json`；不省略 `--json`
- `pull` 是 `abap-cli-edit` 的写路径步骤，本 skill 只用它读本地源代码；**不**做任何 push / activate
- `check` 与 `check atc` 是改后的核验动作——只有 `status: success` 才算 review 通过
- 若需要跑类（classrun）做运行时证据 → handoff 到 `abap-cli-data` 的 `run`

## 错误码快速对照（来自其他 skill）

| 错误 | 来源 | 处理 |
|---|---|---|
| `OBJECT_NOT_FOUND` | `abap-cli-search` | `search <name>` 校对 |
| `LOCK_FAILED` | `abap-cli-edit` | `inspect <obj> --locks` 查持有者；手动释放后重试 |
| `SYNTAX_ERROR` / `ACTIVATION_FAILED` | `abap-cli-edit` | 读 `data.errors` 修复 |
| `WRAPPER_NOT_DEPLOYED` | `abap-cli-data` | handoff 到 `abap-cli-setup` 跑 `extension deploy --yes` |