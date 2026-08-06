# Changelog

## [Unreleased]

### Added
- **DDIC 对象 CRUD 与 Textpool 支持（014-ddic-crud-textpool）** — SAP 端 `ZCL_ABAP_VIBE_ICF` handler 扩展 `/ddic/*`（POST 创建/覆盖式更新、GET 拉取；GOX 标准函数 `GOX_GEN_TABLE_STD`/`GOX_GEN_DTEL_STD`/`GOX_GEN_DOMA_STD` 创建，`DDIF_GET` 系列读取；支持 DOMA/DTEL/TABL/STRU 四类，TTYP 延后）与 `/textpool/*`（`READ_TEXT_POOL`/`SAVE_TEXT_POOL` 读写三类文本元素）。CLI 端：`abap create DOMA|DTEL|TABL|STRU <name> --file <json>` 创建/覆盖（本地 abap-file-format JSON，命名空间/必需字段/传输请求客户端校验，`data.action` 区分 created/updated）；`abap pull <name> --type <DOMA|DTEL|TABL|STRU>` 拉取为 `src/<name>.<type>.json`；`abap pull <name> --textpool` 与 `abap push <name>.<type>.texts|selections|headings.<lang>.properties` 读写文本元素（**混合模式**：ADT 文本元素 API 可用时走 ADT，ECC/旧系统走 ICF `/textpool/*`；能力在 `connection add/set` 与 `abap init` 建立连接时**一次探测并持久化**到 SystemProfile 的 `adtTextpool`，后续直接读缓存路由、**无运行时退回**）。`--json` 结果含 `route`（adt/icf）字段可被 Agent 解析。服务版本 0.1.0→0.2.0（CLI `ICF_SERVICE_VERSION`、handler `gc_version`、mock 三处同步）。mock-adt 新增 `/ddic/*` 与 `/textpool/*` 端点（`MOCK_DDIC_FAIL`/`MOCK_TEXTPOOL_WRITE_UNSUPPORTED` 注入）。新增测试：`ddic-json-map`（17）、`ddic-create`（13）、`ddic-pull`（4）、`textpool-properties`（17）、`textpool-capability`（9）、`textpool-cli`（3）。**迁移说明**：DDIC 四类从 `DDIC_NOT_SUPPORTED` 拒绝转为可用；TTYP 仍拒绝；`connection add/set` 现在会在写 profile 后做一次信息性文本池能力探测（失败不阻断）。
- **ICF 接口实现与部署集成（013-icf-interface-implementation）** — SAP 端新增 `abap/src/clas/`（abapGit 类型子目录布局）：handler class `ZCL_ABAP_VIBE_ICF`（`IF_HTTP_EXTENSION` + `/ui2/cl_json`，根路径 `/sap/zabap_vibe/` 返回统一 JSON `{status, data:{service, version}}`，未知路径/方法返回统一错误 JSON）与 setup class `ZCL_ABAP_VIBE_ICF_SETUP`（`IF_OO_ADT_CLASSRUN`，幂等创建/绑定/激活 `/sap/zabap_vibe` SICF 节点，弥补 ADT 缺失的 SICF 配置激活能力）。`abap deploy` 部署源码后自动经 ADT classrun 触发 setup（`--dry-run` 报告 `icfNode.status: "planned"` 零变更），结果含 `icfNode` 节点状态；setup 失败以结构化 `SAP_ERROR`（exit 6）呈现。`abap init` 写配置后追加信息性 ICF 部署检查（四态 `not_deployed`/`current`/`outdated`/`unreachable`，后者降级为 `meta.warnings` 的 `ICF_CHECK_DEGRADED`，不阻断 init）。`AdtClientWrapper` 暴露 `runClass`；新增 `src/abap_cli/icf/service-version.ts`（`ICF_SERVICE_VERSION` 常量 + 版本读取/比较）；mock-adt 新增 classrun 端点与版本化 ICF 根。`test/unit/deploy-icf-setup.test.ts`（4 用例）与 `test/unit/init-icf-version.test.ts`（4 用例）覆盖 deploy 触发/dry-run/幂等/失败与 init 四态。
- **激活状态校验与修复（013 dogfooding 产出）** — `abap inspect <object> --activation`（只读）逐 part 对比 active 与 latest 源码，报告 `{ ok, parts: [{ includeType, sourceUri, active }] }`，用于发现"报 activated 但实际未激活"的 stale 状态；新增 `abap activate <object>`（`--yes`/`--tr`）收集该对象全部 inactive 项（method/OSI 级）批量激活，修复仅激活根 URI 导致的方法/源码级激活遗漏。`AdtClientWrapper` 暴露 `inactiveObjects` 与 `activateAll`。真实 SAP 验证：stale 检出 → 7 项激活 → 再校验 `ok`。

### Fixed
- **`abap --help` local/SAP command grouping (P2.9)** — every `LazyCommandSpec` now carries an optional `scope: 'local' | 'sap'` (default `'sap'`). The four local commands (`init`, `connection`, `doctor`, `report-stuck`) are explicitly annotated; the remaining 12 stay SAP-scoped. `registerLazyCommands` appends a `Local commands (no SAP connection required):` block to the root `--help` so an agent can identify drift-free-of-environment commands at a glance. The flat `Commands:` list above is preserved unchanged (back-compat). When no spec is `local`, the section is omitted. `test/unit/lazy-commands.test.ts` adds 4 cases (scope annotation correctness, scoped help section, no-local empty section, process-level root help grouping); all 224 unit tests pass.
- **Transport write protection (P0.3)** — `abap transport create` and `abap transport assign` are now treated as write operations and follow the same `--yes` / `--dry-run` contract as `push`, `deploy`, `sync`, and `doctor --fix`. In non-TTY mode they refuse with `VALIDATION_ERROR` (exit 7) and `nextSteps` pointing to `--yes` or `--dry-run`; `--dry-run` reports the plan (`{ transport: null, package, ref, dryRun: true }` for create, `{ object, transport, assigned: false, dryRun: true }` for assign) without making any mutating SAP call. TTY mode is unaffected (no interactive prompt added). `test/unit/transport-metadata.test.ts` covers all 6 branches (rejection, dry-run, --yes, option ordering); all 220 unit tests pass.
- **Error-contract CI enforcement (P0.2)** — every `throw new <Error>` in the command boundary directories (`commands/`, `config/`, `formats/`, `sync/`, `clients/`, `crypto/`) must now construct a `CliError`, enforced by `test/unit/cli-error-boundary.test.ts` (3 cases: lint scan, allow-list sanity, non-empty boundary dirs). The test fails fast with the exact `file:line` when a raw `Error` (or any non-`CliError` subclass) is thrown. The only allow-listed raw throw is `commands/lazy.ts`'s internal "lazy command did not register" assertion — a programmer bug, not a user-facing path. As part of the rollout, `config/user-config.ts` (corrupt `~/.abap-cli/systems.json`) now throws `CliError('CONFIG_ERROR', …)` and `formats/file-resolver.ts` (unresolvable filename) now throws `CliError('FILE_PARSE_ERROR', …)`, both with `nextSteps` + `example`. `test/unit/cli-error-boundary-shapes.test.ts` asserts the new error shapes (2 cases); all 214 unit tests pass.
- **`abap search --page-all`** (P1.8) — auto-page through every result until the server returns less than `--limit` rows. Replaces the manual `--page N` loop an agent otherwise had to script. New JSON envelope shape: `{ pageAll: true, pagesFetched, limit, total }` (no more `page`/`truncated` when paging completes). The default `--page-all-max` is `50` pages (≈ 1000 items at the default `--limit`); when the cap is hit the result is `truncated: true` and a `PAGINATION_LIMITED` warning surfaces in `meta.warnings`. `--page-all` and `--page` are mutually exclusive (rejected with `INVALID_ARGUMENT`). Filters (`--exact` / `--package`) are applied to the accumulated set across pages so they don't drop matches; `uri` is used for cross-page de-duplication. The `--schema` introspection now lists `--page-all` / `--page-all-max` and registers `[--page, --page-all]` as an exclusive group. `test/unit/search-page-all.test.ts` covers every branch (7 cases); all 208 unit tests pass.

### Fixed
- **stdout/stderr separation audit (P1.7)** — `--json` failure paths used to leak plain-text help (and `console.error`/`console.log` strings) into stdout, breaking the JSON envelope contract (stdout must be empty on failure). Refactored the top-level commander error handler into `src/abap_cli/top-error.ts` (`handleTopLevelError` + `firstSubcommandArg` + `resolveSubcommand`) and routed every commander / CliError path through it. Now: `--json` mode on `commander.missingArgument` / `commander.help` (bare subcommand) / `commander.unknownCommand` / `commander.unknownOption` / `CliError` keeps stdout empty and emits the JSON envelope plus the subcommand's help body on stderr. Human mode preserves the existing UX (help on stdout, structured error on stderr). True help exits (`--help`/`--version`/no-args root) still follow contract §1.4 (plain text on stdout, exit 0, no JSON envelope). Bonus: the `commander.missingArgument` branch now resolves the **deepest** matching subcommand (e.g. `abap transport create` shows `transport create` help, not `transport`'s). `test/unit/output-streams.test.ts` (15 cases) covers every branch via injected streams + a fake exit; all 201 unit tests pass.

### Changed
- **Lazy command registration (P1.6)** — `src/abap_cli/index.ts` no longer eagerly imports all 16 command modules at startup. Commands are declared as a `COMMAND_SPECS` table (name + description + dynamic `import()`) and registered via `registerLazyCommands` in `src/abap_cli/commands/lazy.ts`; a command's module (and its heavy deps: keytar, abap-adt-api, clack) is imported only when that command is actually dispatched or its `--help`/`help <cmd>` is requested. Root `--help` still lists every command. The CLI entry now uses `program.parseAsync()` so commander's synchronous help/error throws (raised inside the async lazy dispatch) are caught by the existing structured-error handler instead of leaking as unhandled rejections. No public CLI behavior changed; `test/unit/lazy-commands.test.ts` covers lazy dispatch, subcommand/help loading, and description consistency with the command modules.

## [0.7.0] - 2026-08-05

### Added
- **统一 CLI 输出契约（012-unify-cli-output-contract）** — every `--json` envelope now carries a unified `meta` block (`command` / `version` / `timestamp` / `durationMs` / `warnings`) on both success (`{ status, meta, data }`) and failure (`{ status, meta, error }`). Errors now carry an explicit `error.category` (USAGE/CONFIG_ERROR/TLS_ERROR/AUTH_ERROR/SAP_ERROR/VALIDATION_ERROR/NOT_FOUND/LOCKED/UNKNOWN) that maps 1:1 to the exit code, so agents can branch on JSON alone. The unified contract is documented as the single source of truth in `specs/012-unify-cli-output-contract/contracts/cli-output.md` and enforced by `test/unit/output-contract-audit.test.ts`.
- `abap search --schema` / `abap create --schema [type]` — agent-facing parameter introspection (P0.1): prints the machine-readable command schema (arguments, options with types/defaults, mutual-exclusion groups, examples) as JSON on stdout and exits `0` without any SAP call. `create --schema` without a type lists the supported types; with a type it adds the per-type `templates` (also reflected in `--template`'s `allowedValues`) and reports unsupported types via `supported: false` + `reason` (`DDIC_NOT_SUPPORTED` / `TYPE_NOT_SUPPORTED`). The previously required `search <query>` / `create <type> <name>` arguments are now optional so `--schema` can run without them; a real invocation still enforces them with the `USAGE` error (exit `2`).
- `abap create local <type> <name>` — experimental: create a local draft skeleton file (`src/<obj>/<obj>.<type>.abap`, abap-file-format layout) without contacting SAP. Zero SAP requests / no credential reads; reuses `create`'s type map, template registry and error codes (`TYPE_NOT_SUPPORTED` / `DDIC_NOT_SUPPORTED` / `INVALID_ARGUMENT` / `FILE_EXISTS`); `--template` / `--dir` (default `src/`). Land the draft via `abap create ... --no-pull` then `abap push <file> --tr <tr>` (documented in `--help` and `docs/commands.md`).

### Fixed
- `abap inspect` was imported but never registered in `index.ts`, so the command silently did not exist; it is now wired up and runs as documented.
- `abap init` (interactive, existing profile) now persists the fallback-typed password to the OS keychain. Previously it re-prompted "Use stored password?" on every run and the typed password was never saved.
- `abap push` no longer builds its failure envelope by hand — the aggregate failure now throws a structured `CliError` through the unified renderer (previously a raw `JSON.stringify` + manual `process.exit` in `push.ts`, which bypassed the error contract and duplicated the error-code table).
- Unmapped exceptions no longer masquerade as `SAP_ERROR` (exit 6) — they now surface as `code: UNKNOWN` / `category: UNKNOWN` with the generic exit code `1` (exit 1 was previously unreachable).
- A push whose edit lock cannot be released is no longer reported as a failure: the file is recorded as successful and the issue surfaces as an `UNLOCK_WARNING` in `meta.warnings` (exit stays `0`).

### Changed
- **Error-code migration (breaking, see migration table below)**: `UNLOCK_WARNING` and `NOT_IMPLEMENTED` are removed from the `ErrorCode` set; `OBJECT_EXISTS`, `FILE_EXISTS`, `COMMAND_MOVED`, `PUSH_FAILED` are kept but formally normalized into the documented error-code table (their category/exit code are unchanged). All `Warning:`/`console.warn` outputs across `search`/`init`/`deploy`/`connection`/`stuck-reports` are now structured `meta.warnings` (or `Warning:` stderr lines in human mode).
- Documentation synced with the CLI: `docs/commands.md` now covers all current options/subcommands (check `--syntax/--content/--atc` modes, pull `--include-tests/--include-all-parts`, push `--no-activate/--dry-run/--fail-fast/--atomic`, create `--template/--no-pull/--check-only/--audit`, transport `show/resolve/assign`, connection/init TLS options, full error-code table); README command table, scope version (v0.6), getting-started and architecture docs updated; `docs/development.md` documents the vitest unit-test suite.
- Bare `abap` and bare `abap connection` (no subcommand) print their help text to stdout and exit `0`. Commands missing required arguments/options (e.g. `abap search` without a query) print that subcommand's help to stdout followed by the structured `USAGE` error on stderr, exit `2`. Unknown commands still return the structured `USAGE` error.
- Added `abap connection add <name>` — creates a new profile (refuses when the name exists). `connection set <name>` is now strictly "modify an existing profile" and points to `add` when the profile is missing. All create-profile guidance (`init`, `doctor`, probe errors) now uses `connection add`.
- `abap pull` now writes the official abap-file-format layout: one directory per object (`src/<object>/`) containing the mandatory `<name>.<type>.json` metadata (formatVersion + header, from `objectStructure`) plus `<name>.<type>.abap` source parts (includes as `<name>.<type>.<subtype>.abap`). `create` (create-then-pull) and `sync --pull` follow the same layout.
- Class local-type includes now use the abap-file-format names `definitions` / `implementations` instead of the internal `locals_def` / `locals_imp` (breaking file-name change). Already-pulled classes need their `.clas.locals_def.abap` / `.clas.locals_imp.abap` files renamed to `.clas.definitions.abap` / `.clas.implementations.abap`; push/check/diff/status/sync resolve the new names automatically.
- Pull is now organized behind a per-type `PullStrategy` (`src/abap_cli/formats/pull-strategy.ts`): CLAS/PROG/INTF share the objectStructure + source-parts layout, and the strategy is the extension point for future types. Unsupported pull types fail with `TYPE_NOT_SUPPORTED`.
- `abap pull` now supports FUGR (`--type FUGR`) per the abap-file-format fugr layout: `<name>.fugr.json`, `sapl<name>.reps.abap/.json` (function-pool main program), `l<name>top.reps.abap/.json` (TOP include), and one `<name>.fugr.<fm>.func.abap/.json` per function module (processingType from `fmodule:processingType`). The generated UXX include is skipped per the spec. Sub-objects are enumerated via quickSearch (`L<group>*` for includes, `*<group>*` for function modules).
- `abap push` now supports the FUGR files produced by `abap pull`: FUGR sub-objects (function modules, includes) are independently locked ADT objects, so each file locks its own target (group / include / function module), writes its source, then activates the enclosing function group. Shared layout/enumeration in `formats/fugr-layout.ts` keeps pull and push in sync. CLAS/PROG/INTF push (object-lock model) is unchanged.
- `abap pull` PROG metadata now includes `generalInformation.programType` (from `program:programType`; real SAP already returns the enum, mock-style raw `1`/`M`/`S`/`I` is also mapped, and includes without the attribute are inferred from the `PROG/I` type), so a program vs. an include is distinguishable in the `<name>.prog.json`.
- Namespaced object names (e.g. `/UI2/CL_JSON`) map to the `#`-escaped directory `#ui2#cl_json/` with matching file names, so no nested directory levels are created; `resolveFile` restores `/` for push/check/diff/status/sync round-trips.
- `abap init` no longer creates the `src/` and `ddic/` work directories — it only writes `.abap.json`. Directories are created on demand by `pull` / `create` / `sync --pull`.
- `abap auth test` removed — merged into `abap connection test <name>`. `connection test` now sets the worst-failing-layer exit code (TLS→4, AUTH→5, ADT/ICF→6); `--verbose` (a no-op on `auth test`) is dropped. Migration: `abap auth test --system <name>` → `abap connection test <name>`.
- `abap system` renamed to `abap connection` — breaking change. Migration: `abap system list|show|set|use|test|delete|export|import` → `abap connection …`. The old `system` command is removed (no alias); help text and error `nextSteps` across all commands now reference `abap connection`.
- Removed the interactive menu behind bare `abap system` (previously reachable on a TTY). Bare `abap connection` now prints a `USAGE` error listing subcommands. `abap connection set <name>` without flags still opens the field-editing wizard on a TTY.
- Unchanged (out of scope): the `--system <name>` option on `init` / `auth test` / `doctor`, the `~/.abap-cli/systems.json` storage file, and the internal `SystemProfile` naming.

### 错误码迁移表（012 统一输出契约）

| 旧 | 新 | 迁移说明 |
|---|---|---|
| `ErrorCode UNLOCK_WARNING` | `WarningCode UNLOCK_WARNING` | 不再是错误码。解锁失败但推送成功时，告警出现在 `meta.warnings`，文件记为成功，退出码 0 |
| `ErrorCode NOT_IMPLEMENTED` | 移除 | 死代码（全库无调用）。如未来需要，用 `VALIDATION_ERROR` |
| 无形状异常 → `SAP_ERROR` (exit 6) | → `UNKNOWN` (exit 1) | 修复：无法归类的异常不再伪装成 SAP 错误；HTTP 形状异常仍为 `SAP_ERROR` |
| `OBJECT_EXISTS` / `FILE_EXISTS` / `COMMAND_MOVED` / `PUSH_FAILED` | 保留，正式规范化 | 类别与退出码不变（USAGE/2、USAGE/2、VALIDATION_ERROR/7、VALIDATION_ERROR/7），纳入合同文档权威清单 |

## [0.6.0] - 2026-08-04

### Added
- `abap doctor` — one-command environment diagnosis (environment / config / connection sections with per-item ok/err + prioritized `nextSteps`); `--verbose` detail; `--fix` applies only safe, reversible fixes (`--yes`-gated)
- `abap auth test --system <name>` — layer-by-layer connection diagnosis (`tls` → `auth` → `adt` → `icf`) with per-layer `nextSteps`; exit code reflects the worst failing layer (TLS→4, AUTH→5, ADT/ICF→6)
- `abap inspect <object>` — read-only object metadata probe (`--structure` / `--includes` / `--locks` / `--package`); never acquires a lock
- `abap diff [file]` — local↔SAP comparison with per-part `direction` + bounded line-change `summary` (`--all` / `--remote` / `--local-only` / `--limit`); read-only
- `abap sync` — chained status/pull/push workflow (`--status` default, `--pull`, `--push`, `--dry-run` zero-write plan, `--yes`); divergent parts are never silently overwritten (conflict guard)
- `abap report-stuck` — local feedback-loop record (`--goal` / `--tried` / `--where`) returning a `STUCK-` report id; global `--report-stuck` flag on any failing command + `ABAP_REPORT_STUCK=1` auto-trigger after repeated failures; credentials never recorded; non-blocking degrade to `STUCK-DEGRADED-`
- `test/mock-adt/server.js` — `/sap/zabap_vibe/` ICF root route (`MOCK_ICF_FAIL`), `MOCK_AUTH_FAIL` (401 on compatibility graph), and `ZCL_MULTI` multi-include class fixture
- Fixed: ADT quickSearch requires `*` wildcards on real SAP — `resolveObject` now retries with `*NAME*` when an exact-name search returns zero hits (mock's substring matching had hidden this)

### Verified
- Unit: 112 tests across 24 files (38 new: doctor 7 / auth 7 / inspect 8 / diff 6 / sync 6 / report-stuck 6) — `npm run verify` green
- Mock end-to-end: all six commands verified offline against `test/mock-adt/server.js`
- Real SAP (HANA vhcala4hci): `auth test` tls/auth/adt ok (icf 404 — self-built ICF service not deployed on this system, expected); `doctor` env/config ok with icf reported as a diagnosed item; `inspect` real object metadata + `OBJECT_NOT_FOUND` for unknown; `diff` divergent summary on a real object; `sync` status/dry-run/conflict guard; `report-stuck` local record

## [0.5.0] - 2026-08-03

### Added
- `abap search <query>` — search ABAP objects (class/interface/program/function group/DDIC) by name via the ADT repository search API, returning `{ name, type, uri, description, packageName }`; `--type` filter (normalized to uppercase) and `--max` result limit (default 100); empty result is success (exit 0); query string (incl. `*` wildcards) passed through to SAP
- `test/mock-adt/server.js` search route now honors the `maxResults` parameter for offline `--max` verification

### Verified
- Mock end-to-end: basic search (`ZCL_DEMO` full fields), prefix query, empty result (exit 0), `--type clas` lowercase normalization → CLAS only, `--max 2` truncation, default limit, `USAGE` (blank query) / `INVALID_ARGUMENT` (`--max abc`) rejected before any SAP request, headless `--json` agent loop (search → pull)

## [0.4.0] - 2026-08-02

### Added
- `abap transport list [--open]` — list current user's transport requests (workbench + customizing) with request number/description/status/owner; `--open` filters to open (unreleased) requests; empty result is success (exit 0)
- `abap transport create <description> [--package <package>]` — create a new transport request (default `$TMP` local request) via the ADT `createTransport` API; the created request is usable by push/create via `--tr`, closing the "no request → create → `--tr`" loop without SAP GUI
- Unified `--json` output and error codes (`INVALID_ARGUMENT`/`TRANSPORT_CREATE_FAILED`/`CONFIG_ERROR`/`SAP_ERROR`) consistent with pull/push/check/create
- `tmp/mock-adt/server.js` transport fixtures (released/customizing) + POST `/sap/bc/adt/cts/transports` create route for offline verification

### Verified
- Mock end-to-end: list (workbench/customizing buckets, `--open` filter, empty result), create (default `$TMP`, `--package`, blank description `INVALID_ARGUMENT`), closed loop (list → create → push `--tr`), NO_TRANSPORT path, headless `--json` agent loop
- Real SAP (HANA vhcala4hci): `transport create` created local requests (e.g. `A4HK900116`/`A4HK900118`/`A4HK900120`); local requests don't appear in `list` (workbench modifiable) but work via `--tr`; closed loop verified (create CLAS without `--tr` → `NO_TRANSPORT`, with `--tr` → activated); Dogfooding loop (CLI transport create → pull → edit → push `--tr`, no Eclipse/SAP GUI)

## [0.3.0] - 2026-08-02

### Added
- `abap create <type> <name>` — create new source objects (CLAS/INTF/PROG/FUGR) in SAP via the ADT REST API with `--package`/`--description`/`--tr`/`--no-activate`/`--json`
- Default source skeletons per type (class writes DEFINITION + IMPLEMENTATION), so a created object can be immediately pulled, edited and pushed back (create → pull → edit → push loop)
- Activation after create reuses the push flow (lock → write skeleton → activate → unlock, `finally`-guaranteed release); `--no-activate` creates and writes the skeleton without activating
- Transport resolution reuses the existing order (`--tr` > `.abap.json` > user's open request > `NO_TRANSPORT`)
- Object name normalization (lowercase/underscore → uppercase) and type mapping (CLAS/OC, INTF/OI, PROG/P, FUGR/F)
- DDIC types (DOMA/DTEL/TABL/STRU/TTYP) rejected with a clear `DDIC_NOT_SUPPORTED` (ICF service, later phase); unknown types rejected with supported-type list
- `tmp/mock-adt/server.js` now handles object creation (ADT createObject POST) for offline end-to-end verification

### Verified
- Mock end-to-end: create → pull round-trip (skeleton consistency), edit → push iteration, duplicate create → `OBJECT_EXISTS`, `--no-activate` lifecycle, `NO_TRANSPORT`, unknown/DDIC type rejection, headless `--json` agent loop
- Real SAP (HANA vhcala4hci): create INTF/PROG/FUGR/CLAS with `$TMP` + local transport, pull round-trip zero-diff, `OBJECT_EXISTS`, `--no-activate` → push activate, Dogfooding loop on `ZCL_ICF_DEMO` (create → pull → edit → push, no Eclipse/SAP GUI)
- Freshly created classes have a readiness delay for `objectStructure` on real SAP ("wrong input data"); `create` falls back to the stable `<objectUrl>/source/main` URL for CLAS/INTF/PROG (FUGR uses objectStructure, ready immediately)

## [0.2.0] - 2026-08-02

### Added
- `abap pull` — download source objects (Class/Interface/Program/Function Group) to `src/`, all class includes, abap-file-format naming, `--type`/`--dir`/`--json`
- `abap push` — full lock → write → activate → unlock flow with `--tr`/`--check-only`/`--all`/`--json`; per-file independent results; `finally`-guaranteed lock release
- `abap check` — content-based syntax check only (no SAP-side changes), `--all`/`--json`
- Unified output helpers (`output/json.ts`): consistent `{ status, data|error }` JSON contract + exit codes
- ADT orchestration layer (`sync/`): object resolution, transport resolution, push flow
- `tmp/mock-adt/server.js` — local mock ADT server for offline end-to-end verification

### Fixed
- Activation uses the array overload (`InactiveObject` with full fields) — the string overload's `?context=main` is rejected by real SAP ("currently editing") for both programs and classes
- `abapsource:sourceUri` may be relative to the object URL on real systems; now normalized to an absolute `/sap/bc/adt/...` path
- Object type suffixes (`PROG/P`, `CLAS/OC`) stripped for file extensions (`bcalv_grid_demo.prog.abap`)
- Push skips the content-based check before activation (it leaves an edit session in real SAP); activation performs the full syntax check; `--check-only` still uses the content-based check
- Empty source parts (e.g. empty `locals_imp`) skip the content-based check (abap-adt-api rejects empty content)

### Verified
- Real SAP (HANA 4.0) end-to-end: pull real program + class (5 includes), round-trip consistency, activation, transport fallback, `NO_TRANSPORT`, real syntax error detection via `abap check`

## [0.1.0] - 2026-07-31

### Added
- Initial project structure with three-layer architecture (CLI / SAP / Agent)
- CLI framework with commander.js (10 commands registered)
- ADT client wrapper (abap-adt-api)
- ICF client for self-built DDIC services
- File format handlers (abap-source, ddic-json, file-resolver)
- Project configuration management (.abap.json + .env)
- Placeholder directories for ABAP source (abap/src/) and Agent prompts (skills/, agents/)
