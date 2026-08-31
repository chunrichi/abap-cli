## [Unreleased]

> 已 release 至 [0.2.2](../CHANGELOG.md#022---2026-08-28)。本段保留为历史归档，便于 review 025 → 028 期间累积变更的原始面貌。请勿在此追加新条目——新条目写 `CHANGELOG.md` 的 [Unreleased]。

### Added
- **扩展机制补全（为内部/下游发行版铺路）** —— 让 `deploy` / `report-stuck` / command-policy 这类内部功能可以完全以扩展形式实现，无需修改核心：
  - `beforeCommand` 钩子支持**否决**：返回 `{block: true, reason}` 即中止命令，报 `EXTENSION_COMMAND_BLOCKED`（`VALIDATION_ERROR` / exit 7）。这是实现"按工作区禁用命令"的通道。
  - `beforeParse` 钩子现在**真正被触发**（此前注册后静默不执行）。
  - 扩展 manifest 接受 `{sourceType:"npm", packageName}`（loader 早已支持，此前被 registry 拒掉），扩展可用私有 npm 包分发。
- **`abap pull --tr <transport>`** —— 一次拉取整个 transport 请求里的对象（含嵌套子任务，按类型去重）。`--json` 返回 `transport` / `requested` / `pulled` / `failed` / `deduplicated` / `entries` / `written` / `skipped`，便于 agent 判断进度。与 `<object>` / `--package` 互斥。
- **`abap create --yes` / `abap push --yes`** —— 写操作在非交互环境（CI / agent 循环）的显式确认。缺 `--yes` 时返回 `VALIDATION_ERROR`（exit 7），错误里附 `nextSteps` + 命令示例，照抄即可。`push` 同时支持 `--dry-run` 跳过 ADT 写入。
- **`abap transport show` 嵌套任务展开** —— `--json` 新增 `tasks[]` 与 `deduplicated` 字段，告知 transport 引用了多少对象（去重后）。方便 agent 判断真实工作量。

### Fixed
- **`CommandExtension` 此前完全不生效** —— 注册的扩展命令只被存进 `program.lazyExtensions`，而没有任何消费方，调用时一律报 unknown command（exit 2）。现改为直接注册为 commander 子命令。

### Changed
- **扩展命令不再允许覆盖内置命令** —— 与内置同名的 `CommandExtension` 在加载期即判定 `failed`（此前记为 `loaded` 但实际不可用）。内置命令始终优先。
- **Skill 包收敛**：随包 skill 由 3 个合为 2 个。`abap-object` 承担对象全生命周期（含 DDIC + `select` / `run` / `tcode`），`abap-setup` 承担接入与基础设施（含 `extension`）。**CLI 命令与输出契约不变**——仅 skill 文档重新归属。Agent 升级后应重新加载 skill 描述以命中合并后的 skill。
- **辅助脚本统一为 Node ESM**：以前随包发的 `.sh` 脚本改写为 `.mjs`，跨平台（macOS / Linux / Windows + WSL）行为一致，不再依赖 `jq`。
- **CLI 顶层 + 子命令 `description` 收紧** —— 对齐上游分支「动词 + 对象 + 关键安全提示」风格：移除 `push` 的步骤流程、`init` 的 flag 枚举、`check` 的子命令全列等内部实现细节；保留写操作的 `--yes` / `--dry-run` 必要提示；保留只读标注以便 agent 区分。`COMMAND_SPECS`（root `--help` 的 stub）与各 `commands/*.ts`（`<cmd> --help` 的真实注册）已双向同步。`--help` 输出体积减小，agent 通过 `description` 也能更快定位命令用途。无输出契约/行为变更。
- **`abap push` 描述完全对齐上游** —— 移除顶层 `(write — requires --yes / ...)` 注释、`commonErrorsAfter()` 帮助文本、option 末尾的 `(FR-012)` / `(mutex with --no-activate)` 内部代号；`--tr` 描述回到「用途」而非「使用条件」（避免误导：实际仅 unbound object 才需 `--tr`）。写操作的非交互安全提示已由 `VALIDATION_ERROR.nextSteps` + 命令示例承担，agent 误调时仍能拿到可粘贴修复命令。- **全部命令的 `argument` / `option` 描述对齐上游** —— `create` 的 `--no-activate/--check-only/--yes` 简化；`pull` 的 `--overwrite/--skip-existing` 去掉赘词；`run` 的 `[class-name]/--timeout` 缩写；`select` 的 `--table/--fields/--limit/--dry-run` 简化；`transport` 的 `--yes` 统一；`inspect` 的 `--locks/--activation` 去冗余 `(read-only)`；`doctor/extension deploy/where-used/status/diff/activate` 等同向收敛。`init` 保留主线独有的 `--source-dir/--show-config/--unset-*`（0.2.0 init 自省/修改能力），不回退。
### Removed
- 冗余辅助脚本（按 SKILL.md 直接两命令链拼出即可）。

