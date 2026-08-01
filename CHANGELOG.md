# Changelog

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
