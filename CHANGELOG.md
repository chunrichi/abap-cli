# Changelog

## [Unreleased]

### Fixed
- `abap init` (interactive, existing profile) now persists the fallback-typed password to the OS keychain. Previously it re-prompted "Use stored password?" on every run and the typed password was never saved.

### Changed
- Bare `abap` and bare `abap connection` (no subcommand) now print their help text to stdout and exit `0`, instead of failing with `Error: (outputHelp)` / a `USAGE` error (exit 2). Unknown commands and missing arguments still return structured `USAGE` errors.
- Added `abap connection add <name>` — creates a new profile (refuses when the name exists). `connection set <name>` is now strictly "modify an existing profile" and points to `add` when the profile is missing. All create-profile guidance (`init`, `doctor`, probe errors) now uses `connection add`.
- `abap pull` now writes the official abap-file-format layout: one directory per object (`src/<object>/`) containing the mandatory `<name>.<type>.json` metadata (formatVersion + header, from `objectStructure`) plus `<name>.<type>.abap` source parts (includes as `<name>.<type>.<subtype>.abap`). `create` (create-then-pull) and `sync --pull` follow the same layout.
- Namespaced object names (e.g. `/UI2/CL_JSON`) map to the `#`-escaped directory `#ui2#cl_json/` with matching file names, so no nested directory levels are created; `resolveFile` restores `/` for push/check/diff/status/sync round-trips.
- `abap init` no longer creates the `src/` and `ddic/` work directories — it only writes `.abap.json`. Directories are created on demand by `pull` / `create` / `sync --pull`.
- `abap auth test` removed — merged into `abap connection test <name>`. `connection test` now sets the worst-failing-layer exit code (TLS→4, AUTH→5, ADT/ICF→6); `--verbose` (a no-op on `auth test`) is dropped. Migration: `abap auth test --system <name>` → `abap connection test <name>`.
- `abap system` renamed to `abap connection` — breaking change. Migration: `abap system list|show|set|use|test|delete|export|import` → `abap connection …`. The old `system` command is removed (no alias); help text and error `nextSteps` across all commands now reference `abap connection`.
- Removed the interactive menu behind bare `abap system` (previously reachable on a TTY). Bare `abap connection` now prints a `USAGE` error listing subcommands. `abap connection set <name>` without flags still opens the field-editing wizard on a TTY.
- Unchanged (out of scope): the `--system <name>` option on `init` / `auth test` / `doctor`, the `~/.abap-cli/systems.json` storage file, and the internal `SystemProfile` naming.

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
