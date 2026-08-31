# Configuration

abap-cli keeps configuration in two places: a **user-level** system profile store and a **workspace-level** `.abap.json`. Passwords live in the OS keychain — never in version-controlled files.

## Configuration Layers

| Layer | File | Content | Secrets |
|-------|------|---------|---------|
| User-level | `~/.abap-cli/systems.json` | Named system profiles (URL, client, user, language) | No |
| OS keychain | (keytar) | Password per system profile name | Yes |
| Workspace | `<project>/.abap.json` | References a system profile + default transport/package | No |

Precedence for credentials: **OS keychain** for the referenced system name; passwords are also accepted via `--password` on the command line and (interactively) from a TTY prompt.

## System Profiles (`~/.abap-cli/systems.json`)

Created by `abap profile add` and referenced by `abap init --profile <name>`:

```bash
abap profile list                  # List saved profiles
abap profile show dev              # Show profile details (no secrets)
abap profile add dev --url https://sap:44300 --username DEV --password '***'  # Create a profile
abap profile set dev --url https://sap:44300   # Modify a field
abap profile set dev --password '***'          # Update the stored password
abap profile delete dev            # Delete profile + stored password
```

The file is written with mode `0600` (`0700` for the directory) and is not committed.

## Workspace Config (`.abap.json`)

```json
{
  "system": "dev",
  "transport": "",
  "package": "",
  "sourceDir": ""
}
```

| Field | Purpose |
|-------|---------|
| `system` | Name of the system profile to connect to (required) |
| `transport` | Default transport number used when `--tr` is not given |
| `package` | Default package used by commands that create objects |
| `sourceDir` | Base directory for `push --all` / `check --all` (falls back to cwd) |

The same `abap init` command is also the entry point for **inspecting and clearing** these fields:

```bash
abap init --show-config               # print the current .abap.json (read-only)
abap init --unset-package --yes       # remove the `package` key
abap init --unset-tr --unset-source-dir --yes   # remove multiple keys
```

Setting fields (`--profile`, `--tr`, `--package`, `--source-dir`) is also done through `abap init`; the command merges with the existing `.abap.json` rather than replacing it.

A template lives at [`.abap.json.example`](../.abap.json.example). This file is gitignored (see `.gitignore`); commit an example, never the real one.

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `SAP_URL` / `SAP_USER` / `SAP_CLIENT` / `SAP_LANGUAGE` | Used by `abap init` in non-interactive mode |
| `NODE_TLS_REJECT_UNAUTHORIZED` | Set to `0` for self-signed certs (development only) |

Passwords are **not** read from environment variables — they come from the OS keychain, `--password`, or a TTY prompt. `SAP_PASSWORD` / `BTP_PASSWORD` overrides were removed.

A template lives at [`.env.example`](../.env.example). `.env` files are gitignored.

## Transport Resolution Order

When a command accepts `--tr`:

1. `--tr <number>` (explicit CLI option)
2. `.abap.json` `transport` (default)
3. The user's first open (modifiable) request, from `userTransports`
4. Otherwise error: `NO_TRANSPORT` — create one with `abap transport create`

> Note: A local request created under `$TMP` does **not** appear in the workbench modifiable list, so automatic resolution will not find it — pass it explicitly with `--tr`.

**`abap push` resolves per object, not once per run** — an object already assigned to a request reuses that request (a different `--tr` is rejected with `VALIDATION_ERROR`; see [Commands](commands.md)), and objects in `$TMP` push with no transport at all. The order above applies only to unbound non-`$TMP` objects.

## Credentials & Security

- Passwords are stored via the OS keychain (`keytar`), keyed by system profile name
- Credentials never appear in command output or error messages
- `.env`, `.abap.json`, and `~/.abap-cli/` are excluded from version control
- Give agents the minimum SAP authorizations they need (Constitution Principle VI)
