# Changelog

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
