# Commands Reference

All commands support the global `--json` option for structured output (Agent-First design). Success output is written to stdout, errors to stderr; both follow the same shape when `--json` is used.

## Global Options

```
-V, --version    output the version number
--json           Output in JSON format
-h, --help       display help for command
```

## JSON Output Contract

```jsonc
// Success (stdout)
{ "status": "success", "data": { ... } }

// Failure (stderr)
{ "status": "error", "error": { "code": "...", "message": "...", ... } }
```

Exit codes: `0` success, `1` any failure (runtime, SAP, or usage error).

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
| `--package <package>` | Download all objects in a package (not implemented in this phase) |

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
| `--max <n>` | Maximum results (default `100`) |

The query supports `*` wildcards.

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

Run ATC (ABAP Test Cockpit) checks. Currently a stub.

```bash
abap atc [options] [files...]
```

## `abap status`

Show differences between local files and the SAP system. Currently a stub.

```bash
abap status
```

## `abap deploy`

Deploy the bundled ICF ABAP service to the SAP system.

```bash
abap deploy [options]
```

| Option | Description |
|--------|-------------|
| `--tr <transport>` | Transport number |
| `--package <package>` | Target SAP package (default `ZABAP_VIBE`) |

## Error Codes

| Code | Meaning |
|------|---------|
| `CONFIG_ERROR` | Configuration missing/invalid (run `abap init`) |
| `SAP_ERROR` | ADT request failed (includes HTTP status) |
| `NO_TRANSPORT` | No transport available; create one with `abap transport create` |
| `OBJECT_EXISTS` | Object already exists (create) |
| `OBJECT_NOT_FOUND` | Object not found |
| `AMBIGUOUS_OBJECT` | Search matched multiple objects |
| `TYPE_NOT_SUPPORTED` | Unknown object type (create) |
| `DDIC_NOT_SUPPORTED` | DDIC object type, later phase (create) |
| `INVALID_ARGUMENT` | Invalid argument (e.g. blank transport description) |
| `TRANSPORT_CREATE_FAILED` | Failed to create a transport request |
| `CREATE_FAILED` | Object creation failed |
| `LOCK_FAILED` | Could not lock the object (locked by another user) |
| `ACTIVATION_FAILED` | Activation failed |
| `SYNTAX_ERROR` | Content-based syntax check failed |
| `UNLOCK_WARNING` | Object updated but the edit lock could not be released |
