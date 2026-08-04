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

```jsonc
// Success (stdout)
{ "status": "success", "data": { ... } }

// Failure (stderr)
{ "status": "error", "error": { "code": "...", "message": "...", "nextSteps": [...], ... } }
```

Exit codes: `0` success, `1` any failure (runtime, SAP, or usage error), `2`–`9` categorized (usage / config / TLS / auth / SAP / validation / not-found / locked). See the common-errors help block on every command for the full table.

## `abap init`

Initialize workspace configuration for SAP connection.

```bash
abap init [options]
```

| Option | Description |
|--------|-------------|
| `--system <name>` | Name of an existing system profile |
| `--url <url>` | SAP system URL (creates/updates a profile) |
| `-c, --client <client>` | SAP client number |
| `-u, --username <user>` | SAP username |
| `-p, --password <password>` | SAP password (stored in keychain) |
| `-l, --language <language>` | SAP language |
| `-t, --transport <transport>` | Default transport number |
| `--package <package>` | Default SAP package |

Non-interactive usage requires either `--system <name>` (reference existing) or a full connection set (`--url` + `--username` + `--password`).

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

## `abap push`

Push local ABAP files to SAP: lock → set source → syntax check → activate → unlock.

```bash
abap push [options] [files...]
```

| Option | Description |
|--------|-------------|
| `--all` | Push all `.abap` files under the current directory |
| `--tr <transport>` | Transport number (see resolution order in [Configuration](configuration.md)) |
| `--check-only` | Only perform a syntax check, do not activate |

## `abap check`

Perform a content-based syntax check on local files — no activation, no SAP-side changes.

```bash
abap check [options] [files...]
```

| Option | Description |
|--------|-------------|
| `--all` | Check all `.abap` files under the current directory |

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
| `--exact` | Exact name match (mutually exclusive with `--fuzzy`) |
| `--fuzzy` | Substring match (default) |
| `--package <pkg>` | Filter results by package |
| `--max <n>` | Deprecated alias for `--limit` |

The query supports `*` wildcards. Truncated results set `truncated: true` with a `hint` suggesting narrowing flags or the next page.

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
| `--description <desc>` | Object description (required) |
| `--tr <transport>` | Transport number |
| `--no-activate` | Create and write the skeleton but do not activate |

DDIC types (DOMA/DTEL/TABL/STRU/TTYP) are rejected with `DDIC_NOT_SUPPORTED`; unknown types with `TYPE_NOT_SUPPORTED`.

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

## `abap system`

Manage global system profiles.

```bash
abap system <command>
```

| Command | Description |
|---------|-------------|
| `list` | List all saved system profiles |
| `show <name>` | Show details of a profile (no secrets) |
| `set <name>` | Modify a profile (fields or password) |
| `delete <name>` | Delete a profile and its stored password |

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

## `abap auth test`

Probe a system profile layer by layer: `tls` → `auth` → `adt` → `icf`.

```bash
abap auth test [options]
```

| Option | Description |
|--------|-------------|
| `--system <name>` | System profile to probe (required) |
| `--verbose` | Include per-layer detail |

JSON output: one object per layer `{ tls, auth, adt, icf }`, each `{ ok, skipped?, error?, nextSteps? }`. A failing layer drives a non-zero exit code (TLS→4, AUTH→5, ADT/ICF→6) while all layers are still reported.

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

JSON output: `{ metadata: { object, type, uri, ... }, structure?, includes?, locks? }`. Read-only — never acquires a lock.

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

| Code | Meaning |
|------|---------|
| `CONFIG_ERROR` | Configuration missing/invalid (run `abap init` / `abap system set`) |
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
| `UNLOCK_WARNING` | Object updated but the edit lock could not be released |
