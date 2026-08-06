# Commands Reference

All commands support the global `--json` option for structured output (Agent-First design). Success output is written to stdout, errors to stderr; both follow the same shape when `--json` is used.

## Global Options

```
-V, --version        output the version number
--json               Output in JSON format
--report-stuck       Record a stuck report when this command fails (feedback loop)
-h, --help           display help for command
```

## JSON Output Contract

Every `--json` envelope carries a `meta` block (`command`, `version`, `timestamp`, `durationMs`, `warnings`). The unified contract is authoritative in `specs/012-unify-cli-output-contract/contracts/cli-output.md`.

```jsonc
// Success (stdout)
{ "status": "success", "meta": { "command": "abap pull", "version": "0.7.0", "timestamp": "...", "durationMs": 42, "warnings": [] }, "data": { ... } }

// Failure (stderr — stdout is empty)
{ "status": "error", "meta": { ... }, "error": { "code": "...", "category": "...", "message": "...", "nextSteps": [...], ... } }
```

Warnings never enter the error envelope: non-fatal warnings (e.g. a deprecated option, or a push whose lock could not be released) appear as structured `meta.warnings` entries (or `Warning: …` stderr lines in human mode) and never change the exit code.

Exit codes (stable contract, only additive across versions): `0` success, `1` unknown/unmapped failure (generic fallback), `2` usage, `3` config, `4` TLS, `5` auth, `6` SAP error, `7` validation, `8` not-found, `9` locked; `>=10` reserved. `error.category` in the JSON always maps 1:1 to the exit code. See the common-errors help block on every command for the full table.

## `abap init`

Initialize workspace configuration for SAP connection.

```bash
abap init [options]
```

| Option | Description |
|--------|-------------|
| `--system <name>` | Name of an existing system profile |
| `--url <url>` | SAP system URL (interactive; in scripts use `abap connection add`) |
| `-c, --client <client>` | SAP client number |
| `-u, --username <user>` | SAP username |
| `-p, --password <password>` | SAP password (stored in keychain) |
| `-l, --language <language>` | SAP language |
| `--tr <transport>` | Default transport number |
| `-t, --transport <transport>` | Deprecated alias for `--tr` |
| `--package <package>` | Default SAP package |
| `--insecure` | Skip SSL certificate verification (self-signed certs, development only) |
| `--ca <path>` | Path to a CA certificate (PEM) for SSL verification |
| `--test-connection` | Probe TLS + auth and report results (implies `--test-tls --test-auth`) |
| `--test-tls` | Probe the TLS handshake |
| `--test-auth` | Probe authentication (after TLS) |
| `--yes` / `--no-input` | Non-interactive confirmation (aliases) |

Non-interactive usage requires either `--system <name>` (reference existing) or a full connection set (`--url` + `--username` + `--password`).

After writing the workspace config, `abap init` performs an informational ICF deployment check (FR-012..FR-015): it probes `/sap/zabap_vibe/` and compares the deployed version with the bundled expected version. The JSON result carries an `icf` field with one of four states: `not_deployed` (hint to run `abap deploy`), `current`, `outdated` (hint to run `abap deploy` to upgrade / `--force` to overwrite), or `unreachable` (degraded to a `meta.warnings` entry — init still succeeds). The check never modifies SAP and never blocks init.

## `abap pull`

Download ABAP objects from SAP to local files. Classes download all include parts.

```bash
abap pull [options] [object-name]
```

| Option | Description |
|--------|-------------|
| `--type <type>` | Object type (CLAS, PROG, INTF, etc.) |
| `--dir <path>` | Output directory (default `src/`) |
| `--package <package>` | Download all objects in a package (bounded by `--limit`, default 20) |
| `--limit <n>` | Batch page size for `--package` |
| `--page <n>` | Batch page number for `--package` |
| `--overwrite` | Allow replacing a local file with different content |
| `--skip-existing` | Skip files that already exist locally |
| `--include-tests` | Include the testclasses source part |
| `--include-all-parts` | Include every source-code part |
| `--textpool` | 014: also pull textpool files (`.texts`/`.selections`/`.headings` `<lang>.properties`) for the object |

**DDIC pull (014)**: `abap pull <name> --type DOMA|DTEL|TABL|STRU` downloads the object definition from the self-built ICF service (`/sap/zabap_vibe/ddic/<type>/<name>`) as a flat `src/<name>.<type>.json` (abap-file-format layout). Unknown DDIC types (e.g. TTYP) are rejected with `DDIC_NOT_SUPPORTED`. Textpool pull uses the mixed-mode route (ADT when the cached capability allows reads, otherwise the ICF `/textpool/*` endpoint); the JSON result carries a `route` field (`adt` / `icf`).

## `abap push`

Push local ABAP files to SAP: lock → set source → syntax check → activate → unlock.

```bash
abap push [options] [files...]
```

| Option | Description |
|--------|-------------|
| `--all` | Push all `.abap` files under the current directory (honours `.abapignore`) |
| `--tr <transport>` | Transport number (see resolution order in [Configuration](configuration.md)) |
| `--check-only` | Only perform a syntax check, do not activate (mutex with `--no-activate`) |
| `--no-activate` | Lock + write + skip check + skip activate + unlock |
| `--dry-run` | Plan only — make no mutating ADT calls |
| `--fail-fast` | Stop at the first failing file (default: keep going) |
| `--atomic` | Validate all files first; write nothing if any file fails validation |

## `abap check`

Validate local ABAP files. Exactly one mode applies; `--syntax` is the default.

```bash
abap check [options] [files...]
```

| Option | Description |
|--------|-------------|
| `--syntax` | Syntax check against SAP (default mode) |
| `--content` | Local-only validation, no SAP round-trip |
| `--atc` | ATC check against SAP |
| `--variant <variant>` | ATC check variant (only with `--atc`) |
| `--all` | Check all `.abap` files under the current directory |
| `--changed` | Check only files changed since the SAP version |
| `--strict` | Treat warnings as failures |

## `abap search`

Search for ABAP objects in the SAP system.

```bash
abap search [options] <query>
```

| Option | Description |
|--------|-------------|
| `--type <type>` | Filter by object type |
| `--limit <n>` | Page size (default `20`); result is truncated at this bound |
| `--page <n>` | 1-based page (default `1`) |
| `--page-all` | Auto-page through every result until the server returns less than `--limit` rows (mutually exclusive with `--page`). The default `--page-all-max` is `50` pages — when reached, the result is marked `truncated: true` and a `PAGINATION_LIMITED` warning surfaces in `meta.warnings`. |
| `--page-all-max <n>` | Hard cap on pages fetched under `--page-all` (default `50`; `50 × 20 = 1000` items by default) |
| `--exact` | Exact name match (mutually exclusive with `--fuzzy`) |
| `--fuzzy` | Substring match (default) |
| `--package <pkg>` | Filter results by package |
| `--max <n>` | Deprecated alias for `--limit` |
| `--schema` | Print the command parameter schema as JSON and exit (no SAP call) |

The query supports `*` wildcards. Truncated results set `truncated: true` with a `hint` suggesting narrowing flags or the next page. Under `--page-all`, the JSON envelope replaces `page` with `pageAll: true`, `pagesFetched`, and `total`.

`--schema` is an agent-facing introspection mode: it prints the machine-readable parameter contract (arguments, options with types/defaults, mutual-exclusion groups, examples) as JSON on stdout and exits `0` without contacting SAP. The `<query>` argument is not required in this mode.

## `abap create`

Create a new ABAP source object (CLAS, INTF, PROG, FUGR) and activate it.

```bash
abap create [options] <type> <name>
```

| Argument | Description |
|----------|-------------|
| `type` | Object type: `CLAS`, `INTF`, `PROG`, `FUGR` |
| `name` | Object name (normalized to uppercase) |

| Option | Description |
|--------|-------------|
| `--package <package>` | Target SAP package (required) |
| `--description <desc>` | Object description (required for source objects) |
| `--tr <transport>` | Transport number |
| `--no-activate` | Create and write the skeleton but do not activate |
| `--template <template>` | Skeleton template (`minimal`, `public-method`, `report`, `selection-screen`, …) |
| `--no-pull` | Skip the create-then-pull local copy (default: pull after create) |
| `--check-only` | Validate the proposed object without creating it |
| `--audit` | Include the before-checksum (extra SAP round-trip, off by default) |
| `--file <path>` | 014: abap-file-format DDIC JSON input (required for `DOMA`/`DTEL`/`TABL`/`STRU`) |
| `--schema` | Print the command parameter schema as JSON and exit (no SAP call) |

**DDIC create (014)**: `abap create DOMA|DTEL|TABL|STRU <name> --file <json> --package <pkg>` creates (or overwrites) the object via the self-built ICF service (`POST /sap/zabap_vibe/ddic/<type>`). The JSON follows the abap-file-format layout (flat or `header.description` for the description). Client-side validation enforces the namespace (Z/Y/slash) and required fields; a non-`$TMP` package requires `--tr`. Success returns `data.action` (`created` / `updated`). Unknown DDIC types (TTYP) are rejected with `DDIC_NOT_SUPPORTED`; unknown types with `TYPE_NOT_SUPPORTED`. `--description` is optional when `--file` supplies it.

**Textpool push (014)**: `abap push <name>.<type>.texts|selections|headings.<lang>.properties` writes the text elements via the mixed-mode route — ADT text-elements API (lock → write → unlock) when the cached capability allows, otherwise the ICF `/textpool/*` endpoint. The JSON result carries a `route` field.

`--schema` is an agent-facing introspection mode: `abap create --schema` prints the general contract (supported types, required `--package`/`--description`, all options); `abap create --schema <type>` adds the type dimension — `templates` for the type (also reflected in `--template`'s `allowedValues`) and `supported: false` with a `reason` (`DDIC_NOT_SUPPORTED` / `TYPE_NOT_SUPPORTED`) for types that cannot be created. Output is JSON on stdout, exit `0`, no SAP call; the `<type>`/`<name>` arguments are not required in this mode.

### `abap create local` (experimental)

**Experimental**: create a local draft skeleton file without contacting SAP. Nothing is sent to SAP and no credentials are read — the draft can be edited offline before landing it via the existing commands.

```bash
abap create local <type> <name> [options]
```

| Argument | Description |
|----------|-------------|
| `type` | Object type: `CLAS`, `INTF`, `PROG`, `FUGR` |
| `name` | Object name (normalized to uppercase) |

| Option | Description |
|--------|-------------|
| `--template <template>` | Skeleton template (`minimal`, `public-method`, `report`, `selection-screen`, …) |
| `--dir <path>` | Output directory (default `src/`) |

The file is written as `src/<obj>/<obj>.<type>.abap` (abap-file-format layout, same as `create`'s create-then-pull output). An existing file is refused with `FILE_EXISTS`; unknown types / DDIC types / unknown templates match `create`'s error codes (`TYPE_NOT_SUPPORTED` / `DDIC_NOT_SUPPORTED` / `INVALID_ARGUMENT`).

To land the draft in SAP:

```bash
abap create CLAS ZCL_DRAFT --package ZPKG --description "desc" --no-pull
abap push src/zcl_draft/zcl_draft.clas.abap --tr <transport>
```

## `abap transport`

Manage SAP transport requests.

### `abap transport list`

List transport requests for the current user (workbench + customizing buckets).

```bash
abap transport list [options]
```

| Option | Description |
|--------|-------------|
| `--open` | Show only open (unreleased) requests |

JSON output:

```jsonc
{ "status": "success", "data": {
  "workbench": [ { "number": "DEVK900001", "description": "...", "status": "D", "owner": "DEV" } ],
  "customizing": []
} }
```

An empty result is still success (exit 0).

### `abap transport create`

Create a new transport request.

```bash
abap transport create <description> [options]
```

| Argument | Description |
|----------|-------------|
| `description` | Transport description (must not be blank) |

| Option | Description |
|--------|-------------|
| `--package <package>` | Target SAP package (default `$TMP`, creates a local request) |

JSON output:

```jsonc
{ "status": "success", "data": { "transport": "DEVK900123", "description": "...", "package": "$TMP" } }
```

The returned transport number can be used with `--tr` on `push` / `create`.

### `abap transport show <req>`

Show structured metadata for a transport request (read-only).

```bash
abap transport show <request-number>
```

### `abap transport resolve <object>`

Show which transport request(s) an object belongs to (read-only).

```bash
abap transport resolve <object-name>
```

### `abap transport assign <object>`

Attach an object to a transport request (no-op when already assigned).

```bash
abap transport assign <object-name> --tr <request-number>
```

| Option | Description |
|--------|-------------|
| `--tr <transport>` | Target transport request (required) |

## `abap connection`

Manage global connection profiles.

```bash
abap connection <command>
```

| Command | Description |
|---------|-------------|
| `list` | List all saved connection profiles |
| `show <name>` | Show details of a profile (no secrets) |
| `add <name>` | Create a new profile (`--url` + `--username` required, `--password` stores the credential) |
| `set <name>` | Modify an existing profile (fields or password) |
| `use <name>` | Switch the current workspace to a profile |
| `test <name>` | Probe a profile: tls → auth → adt → icf (exit code reflects the worst failing layer: TLS→4, AUTH→5, ADT/ICF→6) |
| `delete <name>` | Delete a profile and its stored password |
| `export [names...]` | Export profiles to a portable bundle (`--file`, `--with-passwords`) |
| `import <file>` | Import profiles from a bundle (`--overwrite`) |

**Textpool capability probe (014)**: `abap connection add` / `abap connection set` and `abap init` (when it creates a profile) perform a one-shot informational probe of the ADT text-elements capability (read + write availability) and record it on the profile (`adtTextpool: { read, write, checkedAt }`, plus `systemVersion`). Textpool operations then read this cached result to pick the route (ADT vs ICF) — no runtime probe or fallback. The probe is non-blocking: on failure (e.g. SAP unreachable) the profile simply has no `adtTextpool` record and conservative defaults apply (read→ADT, write→ICF).

`add` / `set` accept the connection fields as options: `--url`, `-c/--client`, `-u/--username`, `-l/--language`, `-p/--password`, plus `--insecure` (skip SSL verification, development only) and `--ca <path>` (PEM CA certificate). `set` additionally supports `--remove-password` (drop the keychain credential) and `--clear-ca` (remove the CA setting).

`connection test <name>` returns one object per layer `{ tls, auth, adt, icf }`, each `{ ok, skipped?, error?, nextSteps? }`. A failing layer drives a non-zero exit code while all layers are still reported (partial results, not a crash).

## `abap atc`

ATC (ABAP Test Cockpit) checks moved to `abap check --atc`. The standalone `atc` command returns a structured `COMMAND_MOVED` redirect.

## `abap status`

Show differences between local files and the SAP system as a standardized `changedParts` list.

```bash
abap status [options]
```

| Option | Description |
|--------|-------------|
| `--remote-only` | Only remote-only differences |
| `--local-only` | Only local-only differences |
| `--limit <n>` | Bounds the result (default `20`); `truncated: true` when capped |
| `--since <iso-date>` | Only files modified at or after the date |
| `--all` | Include unchanged entries |

## `abap deploy`

Deploy the bundled ICF ABAP service to the SAP system.

```bash
abap deploy [options]
```

| Option | Description |
|--------|-------------|
| `--tr <transport>` | Transport number |
| `--package <package>` | Target SAP package (default `ZABAP_VIBE`) |
| `--dry-run` | Plan only — zero mutating SAP calls |
| `--diff` | Per-file change summary |
| `--force` | Bypass safety guards (`forced: true` in the result) |
| `--yes` | Confirm in non-interactive environments |

After deploying the bundled sources, `abap deploy` triggers the bundled ICF setup class (`ZCL_ABAP_VIBE_ICF_SETUP`) via ADT classrun, which creates/binds/activates the `/sap/zabap_vibe` SICF node (idempotent). The JSON result includes an `icfNode` field with the node state (`status`, `action`, `url`, `active`, `handler`); `--dry-run` reports `icfNode.status: "planned"` without triggering setup. A setup failure surfaces as a structured `SAP_ERROR` (exit 6).

## `abap doctor`

Diagnose the CLI environment — environment, configuration, and connections.

```bash
abap doctor [options]
```

| Option | Description |
|--------|-------------|
| `--verbose` | Include detail (versions, paths, underlying messages) |
| `--fix` | Apply only safe, reversible fixes (write operation) |
| `--yes` | Confirm `--fix` without prompting |
| `--system <name>` | Scope the connection section to a named profile |

JSON output: sections `environment` / `config` / `connection`, each item `{ key, status: ok|err, message, suggestion? }`, plus an overall prioritized `nextSteps` list. Connection issues are reported as items — the command never hard-fails on an unreachable system.

## `abap inspect`

Inspect an SAP object's metadata read-only (no local files required).

```bash
abap inspect [options] <object>
```

| Option | Description |
|--------|-------------|
| `--structure` | Include structure elements |
| `--includes` | Include class include parts |
| `--locks` | Include lock / transport ownership (read-only) |
| `--package` | Include the object package name |
| `--activation` | Verify active vs latest source per part (read-only; detect stale activation) |

JSON output: `{ metadata: { object, type, uri, ... }, structure?, includes?, locks?, activation? }`. `--activation` returns `{ ok, parts: [{ includeType, sourceUri, active }] }` — `ok` is true when every part's active source equals its latest (inactive) source. Read-only — never acquires a lock.

## `abap activate`

Activate all inactive items (method/OSI source level) of an object.

```bash
abap activate <object> [options]
```

| Option | Description |
|--------|-------------|
| `--tr <transport>` | Transport number |
| `--yes` | Confirm in non-interactive environments |

A root-URI-only activation can silently no-op while method/OSI items stay inactive (013 dogfooding). `abap activate` collects every inactive item of the object and activates them as a batch. Typical flow: `abap inspect <object> --activation` to check, then `abap activate <object> --yes` to fix.

## `abap diff`

Compare local files against SAP (read-only) with a per-part change summary.

```bash
abap diff [options] [file]
```

| Option | Description |
|--------|-------------|
| `--all` | Compare the whole workspace |
| `--remote` | Only remote-only differences |
| `--local-only` | Only local-only differences |
| `--limit <n>` | Bounds the result (default `20`) |

JSON output: `{ parts: [{ object, part, direction, summary? }], truncated, checked }`. `direction` ∈ `local-only` | `remote-only` | `divergent` | `unchanged`; `summary` is `{ added, removed, changedLines }`. "No differences" is a valid empty result (exit 0).

## `abap sync`

Chain status / pull / push into one workflow.

```bash
abap sync [options]
```

| Option | Description |
|--------|-------------|
| `--status` | Report local↔SAP state (default) |
| `--pull` | Pull remote-only + divergent changes down |
| `--push` | Push local changes up |
| `--dry-run` | Plan only — zero mutating SAP calls |
| `--yes` | Confirm a push that touches divergent changes |

JSON output: `{ direction, dryRun, parts: [{ object, part, direction, action, status, reason? }], skipped, nextSteps }`. `--push` never silently overwrites divergent changes — they are `conflict` and the push fails fast with guidance unless `--yes` is passed. Direction flags are mutually exclusive.

## `abap report-stuck`

Record a stuck-agent report locally (feedback loop).

```bash
abap report-stuck [options]
```

| Option | Description |
|--------|-------------|
| `--goal <text>` | What the agent was trying to do |
| `--tried <text>` | What the agent already tried |
| `--where <cmd>` | Which command it was stuck on |

JSON output: `{ id, recorded, echo: { goal, tried, where } }`. Reports are written to `~/.abap-cli/reports/<id>.json` (`STUCK-<ts>-<rand>`); credentials are never recorded. If the store is unwritable the command degrades to `recorded: false` with a `STUCK-DEGRADED-` id. The same loop is reachable via the global `--report-stuck` flag on any failing command and via `ABAP_REPORT_STUCK=1` (auto-records after repeated failures).

## Error Codes

Every error's `error.category` maps 1:1 to its exit code (see JSON Output Contract). `UNKNOWN` is the generic fallback for unmapped exceptions (exit `1`). The full authoritative list lives in `specs/012-unify-cli-output-contract/contracts/cli-output.md`.

| Code | Meaning |
|------|---------|
| `UNKNOWN` | Unmapped exception fallback (exit 1) |
| `CONFIG_ERROR` | Configuration missing/invalid (run `abap init` / `abap connection add` / `abap connection set`) |
| `SAP_ERROR` | ADT request failed (includes HTTP status) |
| `TLS_ERROR` | TLS handshake / certificate failure |
| `AUTH_ERROR` | 401/403 from SAP (bad credentials) |
| `NO_TRANSPORT` | No transport available; create one with `abap transport create` |
| `OBJECT_EXISTS` | Object already exists (create) |
| `OBJECT_NOT_FOUND` | Object not found |
| `AMBIGUOUS_OBJECT` | Search matched multiple objects |
| `TYPE_NOT_SUPPORTED` | Unknown object type (create) |
| `DDIC_NOT_SUPPORTED` | DDIC object type, later phase (create) |
| `INVALID_ARGUMENT` | Invalid argument (e.g. mutually exclusive flags) |
| `USAGE` | Wrong invocation / missing required arguments |
| `COMMAND_MOVED` | Command retired and redirected (e.g. `atc` → `check --atc`) |
| `VALIDATION_ERROR` | Semantic rejection (e.g. `sync --push` refused over divergent changes) |
| `FILE_EXISTS` | A required file already exists (e.g. `.abap.json` during `init`) |
| `TRANSPORT_CREATE_FAILED` | Failed to create a transport request |
| `CREATE_FAILED` | Object creation failed |
| `LOCK_FAILED` / `LOCKED` | Could not lock the object (locked by another user) |
| `ACTIVATION_FAILED` | Activation failed |
| `SYNTAX_ERROR` | Content-based syntax check failed |
| `OVERWRITE_REQUIRED` | Pull refuses to overwrite a differing local file |
| `FILE_PARSE_ERROR` | Local file could not be parsed |
| `NOT_FOUND` | Generic not-found (parent of `OBJECT_NOT_FOUND` / `AMBIGUOUS_OBJECT`) |
| `TRANSPORT_NOT_FOUND` | Referenced transport request does not exist |
| `PUSH_FAILED` | Push operation failed (aggregate) |
