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

## `abap config`

Configure the workspace. The `abap config` group has two entry points:

- `abap config [options]` — the **parameter form**: with `--system <name>` it references an existing profile; with a full connection set (`--url` + `--username` + `--password`) it creates a new profile and writes `.abap.json`. In non-interactive mode, profile creation is rejected (use `abap connection add` instead). Running it with no flags prints the help.
- `abap config init` — the **interactive wizard** (no flags accepted): prompts to select an existing system profile or create a new one, then writes `.abap.json`. TTY only; in non-TTY environments it errors out (refuse to fall back, since the wizard cannot proceed without a terminal).

```bash
abap config --system dev --tr DEVK900001 --package ZDEV
abap config --url https://sap:44300 --client 100 --username DEV --password '***'
abap config init      # interactive wizard
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
| `--package <package>` | Default SAP package |
| `--insecure` | Skip SSL certificate verification (self-signed certs, development only) |
| `--ca <path>` | Path to a CA certificate (PEM) for SSL verification |
| `--test-connection` | Probe TLS + auth and report results (implies `--test-tls --test-auth`) |
| `--test-tls` | Probe the TLS handshake |
| `--test-auth` | Probe authentication (after TLS) |
| `--yes` / `--non-interactive` | Non-interactive confirmation (aliases) |

Non-interactive `abap config` requires either `--system <name>` (reference existing) or a full connection set (`--url` + `--username` + `--password`).

After writing the workspace config, `abap config` performs an informational ICF deployment check (FR-012..FR-015): it probes `/sap/zabap_vibe/` and compares the deployed version with the bundled expected version. The JSON result carries an `icf` field with one of four states: `not_deployed` (hint to run `abap deploy`), `current`, `outdated` (hint to run `abap deploy` to upgrade / `--force` to overwrite), or `unreachable` (degraded to a `meta.warnings` entry — init still succeeds). The check never modifies SAP and never blocks init.

## `abap pull`

Download ABAP objects from SAP to local files. Classes download all include parts.

```bash
abap pull [options] [object-name]
```

Bare `abap pull` (no object name, no `--package`) prints the command help, like `abap pull --help`.

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
| `--remote <remoteid>` | 015: pull the object's active version source as transported to a remote system (Version Management) |

**Remote pull (015)**: `abap pull <name> --remote <system-id>` downloads the active (00000) source of the object from another system through the ICF `/version-source` endpoint (TMS RFC destination `TMSADM@<id>.DOMAIN_<id>`). CLI types map to Version Management types: `PROG → REPS`, `INTF → INTF`, `CLAS → CLSD` (class definition). The source is written under the object's standard filename (`src/<name>/<name>.<type>.abap`); the JSON result carries `remote` and `version` fields. If the object was never transported to the remote system the backend reports success with an empty `source`.

**DDIC pull (014)**: `abap pull <name> --type DOMA|DTEL|TABL|STRU` downloads the object definition from the self-built ICF service (`/sap/zabap_vibe/ddic/<type>/<name>`) as a flat `src/<name>.<type>.json` (abap-file-format layout). Unknown DDIC types (e.g. TTYP) are rejected with `DDIC_NOT_SUPPORTED`. Textpool pull uses the mixed-mode route (ADT when the cached capability allows reads, otherwise the ICF `/textpool/*` endpoint); the JSON result carries a `route` field (`adt` / `icf`).

## `abap push`

Push local ABAP files to SAP: lock → set source → syntax check → activate → unlock.

```bash
abap push [options] [files...]
```

| Option | Description |
|--------|-------------|
| `--all` | Push all `.abap` files under the current directory (honours `.abapignore`) |
| `--tr <transport>` | Transport number (see resolution order below and [Configuration](configuration.md)) |
| `--check-only` | Only perform a syntax check, do not activate (mutex with `--no-activate`) |
| `--no-activate` | Lock + write + skip check + skip activate + unlock |
| `--dry-run` | Plan only — make no mutating ADT calls |
| `--fail-fast` | Stop at the first failing file (default: keep going) |
| `--atomic` | Validate all files first; write nothing if any file fails validation |

The transport is resolved **per object**, not once per run:

1. If the object is already assigned to a request (`transportInfo`), that request is reused — `--tr` is **not** required and cannot change it. Passing a different `--tr` is rejected with `VALIDATION_ERROR`; re-assign with `abap transport assign` first.
2. Otherwise `--tr` > project transport > the user's first modifiable request > `NO_TRANSPORT`.
3. Objects in `$TMP` are transport-free — no `--tr` needed (matches `deploy`'s `$TMP` rule).

**DDIC push (014)**: `abap push <name>.<type>.json --tr <tr>` updates a DDIC object (DOMA/DTEL/TABL/STRU) via the self-built ICF service (`POST /sap/zabap_vibe/ddic/<type>`, same create/overwrite endpoint as `abap create --file`). Client-side validation enforces the namespace and required fields; `--check-only` is rejected (`VALIDATION_ERROR`). The result status is `written` with stage `ddic-icf`. A non-`$TMP` package requires a transport (same resolution as above, falling back to the file's recorded `transportRequest`).

**Textpool push (014)**: `abap push <name>.<type>.texts|selections|headings.<lang>.properties` writes the text elements via the mixed-mode route — ADT text-elements API (lock → write → unlock) when the cached capability allows, otherwise the ICF `/textpool/*` endpoint. The JSON result carries a `route` field.

## `abap run`

Execute an ABAP class on SAP and capture its stdout (015). Two routes:

1. **classrun** (no `--method`): runs `if_oo_adt_classrun~main` via ADT classrun; stdout is returned verbatim.
2. **wrapper** (`--method <name>`): runs the bundled `ZCL_ABAP_VIBE_RUNNER` class, which reflects the named PUBLIC STATIC method on the target class, invokes it with the JSON `--args`, and serialises the RETURNING value.

`abap run` is strictly **read-only**: no transport, no activation, no lock, no file write. The wrapper class is installed by `abap deploy`.

```bash
abap run [options] <class-name>

# Direct classrun (must implement if_oo_adt_classrun~main)
abap run ZCL_MY_THING

# Static-method invocation via the runner wrapper
abap run ZCL_MY_HELPER --method compute --args '{"x":3,"y":5}'

# Dry-run (zero SAP calls)
abap run ZCL_LONG_RUN --timeout 60000 --dry-run

# Agent integration: machine-readable envelope
abap run ZCL_FOO --method bar --args '{}' --json
```

| Option | Description |
|--------|-------------|
| `--method <name>` | PUBLIC STATIC method to invoke (regex `^[A-Za-z_][A-Za-z0-9_]*$`). Omit for a direct classrun. |
| `--args <json>` | JSON object mapped to the method's IMPORTING parameters (case-insensitive). Default `{}`. |
| `--timeout <ms>` | Execution timeout in ms (100–600000, default 30000). Wrapper path is enforced server-side by `ZCL_ABAP_VIBE_RUNNER` via `cl_abap_runtime`; the classrun path relies on the ADT endpoint's server timeout, with a CLI-side fallback of `--timeout + 5000ms`. |
| `--dry-run` | Print the request envelope (`wouldRun: true`) without invoking ADT classrun. |
| `--schema` | Print the machine-readable command schema (arguments/options/examples/error mapping) as JSON and exit 0 — no SAP call. |
| `--json` | Global — emit the unified 012 JSON envelope. |

**Output contract**: the `--json` envelope is `{ status: 'success', meta, data }` with `data.route` (`classrun` | `wrapper`), `data.output` (raw classrun stdout), `data.parsed` (JSON-parsed output or `null`), `data.exitCode` (business exit code embedded in the classrun JSON, default 0), and `data.durationMs`. On failure `{ status: 'error', meta, error }` — stdout stays empty (P1.7).

**015 error codes** (beyond the common table):

| Code | Category / exit | Trigger |
|------|-----------------|---------|
| `METHOD_FAILED` | VALIDATION_ERROR / 7 | target method raised `cx_root` |
| `METHOD_NOT_SUPPORTED` | VALIDATION_ERROR / 7 | method signature not runner-compatible (CHANGING/TABLES/instance/private/deep) |
| `CLASS_NOT_RUNNABLE` | VALIDATION_ERROR / 7 | class lacks `if_oo_adt_classrun~main` |
| `OBJECT_NOT_ACTIVE` | SAP_ERROR / 6 | class is inactive → `abap activate <class>` |
| `LOCAL_CLASS_NOT_RUNNABLE` | SAP_ERROR / 6 | class name contains `~` (local class) |
| `TIMEOUT` | SAP_ERROR / 6 | classrun exceeded `--timeout` |
| `WRAPPER_NOT_DEPLOYED` | NOT_FOUND / 8 | `ZCL_ABAP_VIBE_RUNNER` missing → `abap deploy` |
| `WRAPPER_INPUT_UNAVAILABLE` | SAP_ERROR / 6 | SAP classrun endpoint does not inject `--method` args (system limitation) → use direct classrun |

**v1 scope**: only `CLAS` is supported. PROG/INTF/FUGR/TABL execution is deferred to a P2 sub-feature (no `--type` option in v1). **Known limitation (verified on vhcala4hci)**: the ADT classrun endpoint ignores request-body parameters, so `--method` on such systems reports `WRAPPER_INPUT_UNAVAILABLE`; the classrun route is fully verified end-to-end.

## `abap select`

Read-only table data query (016) — an `SE16N`-equivalent for agents. Hits the bundled ICF `/data/query` endpoint; no transport, no activation, no lock, no data write.

```bash
abap select --table <name> [--fields <csv>] [--where <clause>] [--limit <n>] [--offset <n>] [--order-by <csv>] [--count-only] [--dry-run] [--json]

# Basic query (matches STATUS='X', returns up to 50 rows)
abap select --table ZTAB_FIXTURE --where "STATUS = 'X'" --limit 50

# Projection + sort + pagination (deterministic with --order-by)
abap select --table ZTAB_FIXTURE --fields "ID,AMOUNT" --order-by "ID:ASC" --limit 20 --offset 40

# Count matching rows (no rows transferred)
abap select --table ZTAB_FIXTURE --where "AMOUNT > 100" --count-only

# Agent integration
abap select --table ZTAB_FIXTURE --where "STATUS = 'X'" --limit 50 --json

# Dry-run: zero SAP calls
abap select --table ZTAB_FIXTURE --where "STATUS = 'X'" --dry-run

# Parameter introspection for agent self-discovery
abap select --schema
```

| Option | Description |
|--------|-------------|
| `--table <name>` (required) | Target ABAP table or view name. Uppercased on the wire. |
| `--fields <csv>` | Comma-separated field names to project. Omit for all fields (large-object fields `STRG/RSTR/LCHR/LRAW` auto-excluded, listed in `data.excludedFields`; explicit projection of large-object fields is rejected with `INVALID_FIELD`). |
| `--where <clause>` | Filter clause: `FIELD OP VALUE [AND ...]`. Operators: `= <> > >= < <= LIKE`. Strings in single quotes (`''` to escape a quote), numbers bare, dates `YYYYMMDD`. **MANDT filter rejected** (implicit session client). v1 grammar: AND-only — no OR / parentheses / functions / subqueries. |
| `--limit <n>` | Max rows returned (CLI range `[1, 10000]`, default `100`). The SAP handler fetches `limit+1` to detect truncation via `data.truncated`. |
| `--offset <n>` | Pagination offset (CLI range `[0, 100000]`, default `0`). Deterministic pagination requires `--order-by`. |
| `--order-by <csv>` | Comma-separated `FIELD:ASC|DESC` pairs, e.g. `"ID:ASC,AMOUNT:DESC"`. Field names must exist in the target table. |
| `--count-only` | Return only the matching row count (`data.count`); `rows` / `fields` omitted. Ignores `--limit` / `--offset` / `--order-by`. |
| `--dry-run` | Print the planned query envelope (`wouldRun: true`) without invoking the ICF endpoint. |
| `--schema` | Print the machine-readable command schema (options / examples / error mapping) as JSON and exit 0 — no SAP call. |
| `--json` | Global — emit the unified 012 JSON envelope. |

**Output contract** (`--json` success):

```jsonc
{
  "status": "success",
  "meta": { "command": "abap select", "version": "0.7.0", "timestamp": "...", "durationMs": 42, "warnings": [] },
  "data": {
    "table": "ZTAB_FIXTURE", "objectType": "TABL",
    "fields": ["MANDT", "ID", "STATUS", "AMOUNT", "NAME", "CREATED"],
    "rows": [ { "MANDT": "001", "ID": "0000000001", "STATUS": "X", "AMOUNT": "1.00", "NAME": "Item 0000000001", "CREATED": "20260201" } ],
    "rowCount": 50, "truncated": true,
    "excludedFields": ["NOTE"],
    "offset": 0, "limit": 50, "countOnly": false, "dryRun": false
  }
}
```

**Human mode** (default): ASCII table with column widths and a trailing summary line (`N row(s) (truncated — ...)` or `excluded: NOTE (large-object fields; not projected)`).

**Read-only & injection-safety contract**:

- The command never writes to SAP — no transport, activation, lock, or data modification. Verifiable by running identical queries before/after a `select` (table data, transport requests, and activation state are unchanged).
- where values are bound as host variables (`@lv_where_v1`, `@lv_where_v2`, …) in the dynamic Open SQL statement — they never enter the SQL text as a literal. Injection payloads like `' OR 1=1 --`, `'; DROP TABLE ZTAB_FIXTURE --`, or `O'Brien; …` are matched as literal string values and return zero rows or `INVALID_WHERE`, not all rows or errors.
- Field names (`--fields`, `--order-by`, where fields) are validated against the DDIC metadata (`DD03L`) before reaching the SELECT — only real, defined field names can ever appear in the SQL structure.
- `MANDT` is filtered implicitly by the session client (Open SQL auto-restriction for client-dependent tables). Explicit `MANDT = '...'` in `--where` is rejected.
- Large-object fields (`STRING`/`RAWSTRING`/`LONG CHAR`/`LONG RAW`) are auto-excluded from the default projection and rejected on explicit projection — keeps row payloads bounded and prevents accidental output of huge objects.

**016 error codes** (beyond the common table):

| Code | Category / exit | Trigger |
|------|-----------------|---------|
| `TABLE_NOT_FOUND` | NOT_FOUND / 8 | Table or view does not exist in DB → `abap search <name>` to verify |
| `TABLE_TYPE_NOT_SUPPORTED` | VALIDATION_ERROR / 7 | Object exists but is pool / cluster / structure / table-type (only TABL and VIEW are queryable); `error.details.objectType` reports the actual TABCLASS |
| `INVALID_FIELD` | VALIDATION_ERROR / 7 | `--fields` / `--order-by` contains a field that is not in the table (`error.details.validFields` lists valid fields), or an explicit projection of a large-object field |
| `INVALID_WHERE` | VALIDATION_ERROR / 7 | Where syntax / operator / field / type / MANDT violation (`error.details.offset` reports the character position of the failing token) |
| `LIMIT_EXCEEDED` | VALIDATION_ERROR / 7 | SAP-side limit re-validation: `limit > 10000` or non-integer (CLI rejects first via `INVALID_ARGUMENT`) |
| `OFFSET_EXCEEDED` | VALIDATION_ERROR / 7 | SAP-side offset re-validation: `offset > 100000` or non-integer |
| `QUERY_FAILED` | SAP_ERROR / 6 | Runtime dynamic SQL failure (e.g. `cx_sy_dynamic_osql_semantics`); `error.message` carries the exception summary |

**v1 scope** (limitations documented in the spec):

- Only `TABL` (transparent) and `VIEW` (DDIC views) are queryable. Pool / cluster tables, structures, table types, and CDS views are rejected (`TABLE_TYPE_NOT_SUPPORTED`).
- Where grammar is `AND` chains only — `OR`, parentheses, function calls, and subqueries are not accepted.
- No `--client` override: client-dependent tables return rows for the ICF session client only.
- Large-object fields are excluded, not truncated. Choose `--fields` carefully if you need to read STRING columns (v1 does not support projection of large objects).
- Authorization follows the connecting user (no explicit `AUTHORITY-CHECK` in v1). Limit access to trusted environments.
- Requires the ICF service version 0.3.0 or later (`abap deploy`; `abap doctor` reports the installed version).

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
| `--out [file]` | Persist the raw ATC worklist to a file (only with `--atc`); defaults to `.abap/atc/<variant>-<timestamp>.json` |

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
| `--page-all` | Fetch all results in one request (mutually exclusive with `--page`). The request size is `--page-all-max × --limit` (default `1000` items); when the server returns a full request window, the result is marked `truncated: true` and a `PAGINATION_LIMITED` warning surfaces in `meta.warnings`. Real ADT quickSearch has no offset, so this is a single request rather than a page loop. |
| `--page-all-max <n>` | Page-count cap that sizes the `--page-all` single request (default `50`; `50 × 20 = 1000` items by default) |
| `--exact` | Exact name match (mutually exclusive with `--fuzzy`). `*` in the query is stripped before the exact comparison; a bare name is widened to `*NAME*` (real ADT returns zero hits for bare names) |
| `--fuzzy` | Substring match (default) |
| `--package <pkg>` | Filter results by package |
| `--max <n>` | Deprecated alias for `--limit` |
| `--schema` | Print the command parameter schema as JSON and exit (no SAP call) |

The query supports `*` wildcards. Truncated results set `truncated: true` with a `hint` suggesting narrowing flags or the next page. Under `--page-all`, the JSON envelope replaces `page` with `pageAll: true`, `requested` (the single request size), and `total`.

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

**Textpool capability probe (014)**: `abap connection add` / `abap connection set` and `abap config` (when it creates a profile) perform a one-shot informational probe of the ADT text-elements capability (read + write availability) and record it on the profile (`adtTextpool: { read, write, checkedAt }`, plus `systemVersion`). Textpool operations then read this cached result to pick the route (ADT vs ICF) — no runtime probe or fallback. The probe is non-blocking: on failure (e.g. SAP unreachable) the profile simply has no `adtTextpool` record and conservative defaults apply (read→ADT, write→ICF).

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
| `--tr <transport>` | Transport number (required when `--package` is not `$TMP`) |
| `--package <package>` | Target SAP package (default `$TMP` — local, no transport needed) |
| `--dry-run` | Plan only — zero mutating SAP calls |
| `--diff` | Per-file change summary |
| `--force` | Bypass safety guards (`forced: true` in the result) |
| `--yes` | Confirm in non-interactive environments |

When `--package` is anything other than `$TMP`, `--tr` is required and `abap deploy` resolves the transport via the standard `--tr > project config > user modifiable requests` chain. With `--package $TMP` (the default), no transport is required and `--tr` may be omitted.

`abap deploy` auto-creates any bundled source object that does not yet exist on the target system (e.g. first-time deploy on a fresh SAP), using the description from the matching `<name>.<type>.json` metadata. The result adds an `objects` array with one entry per object (`status: created | updated | unchanged | failed`) alongside the existing per-file `files` array.

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
| `--type <type>` | Object type (CLAS, PROG, INTF, etc.) — disambiguates same-name objects |
| `--yes` | Confirm in non-interactive environments |

A root-URI-only activation can silently no-op while method/OSI items stay inactive (013 dogfooding). `abap activate` collects every inactive item of the object (matched on the object part of the item URI, so a same-prefix name like `ZCL_FOO_BAR` is never mistaken for `ZCL_FOO`) and activates them as a batch. Typical flow: `abap inspect <object> --activation` to check, then `abap activate <object> --yes` to fix.

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
| `CONFIG_ERROR` | Configuration missing/invalid (run `abap config` / `abap connection add` / `abap connection set`) |
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
| `TABLE_NOT_FOUND` | Table or view does not exist (016 `abap select`) |
| `TABLE_TYPE_NOT_SUPPORTED` | Object exists but is not TABL or VIEW (016) |
| `INVALID_FIELD` | Field not in table / large-object projection rejected (016) |
| `INVALID_WHERE` | Where grammar / field / type / MANDT violation (016) |
| `LIMIT_EXCEEDED` | `limit > 10000` or non-integer, server-side re-validation (016) |
| `OFFSET_EXCEEDED` | `offset > 100000` or non-integer, server-side re-validation (016) |
| `QUERY_FAILED` | Runtime dynamic SQL failure (`cx_root` summary) (016) |
