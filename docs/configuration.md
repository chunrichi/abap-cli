# Configuration

abap-cli keeps configuration in two places: a **user-level** system profile store and a **workspace-level** `.abap.json`. Passwords live in the OS keychain — never in version-controlled files.

## Configuration Layers

| Layer | File | Content | Secrets |
|-------|------|---------|---------|
| User-level | `~/.abap-cli/systems.json` | Named system profiles (URL, client, user, language) | No |
| OS keychain | native backend (`/usr/bin/security` / `cmdkey.exe` / `secret-tool`); `keytar` only as fallback | Password per system profile name | Yes |
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
| `sourceDir` | Scan root for whole-workspace scans (`push --all` / `check --all|--changed` / `status` / `diff`); falls back to cwd |

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
| `ABAP_CLI_KEYCHAIN_BACKEND` | Force the credential store: `native` (default), `keytar` (legacy fallback), `none` (CI/tests), `fixture` (tests only) |

Passwords are **not** read from environment variables — they come from the OS keychain, `--password`, or a TTY prompt. `SAP_PASSWORD` / `BTP_PASSWORD` overrides were removed.

Credentials are resolved **lazily**: local/meta commands (`--help`, `init`, `profile`, `types`, …) never touch the OS keychain, so they cannot trigger a macOS keychain prompt. Set `ABAP_CLI_KEYCHAIN_BACKEND=none` to disable keychain access entirely (CI/tests); credential-writing commands then fail with `CONFIG_ERROR` instead of prompting.

On macOS the default backend is the native `security` CLI. Entries it creates are owned by `/usr/bin/security` (Apple-signed), so reading them never triggers the keychain authorization dialog. That dialog appears for entries created by another application whose code identity no longer matches — the legacy `keytar` backend binds entries to the node binary, so every node upgrade invalidates them. Re-store the password once in a normal terminal to migrate:

```bash
abap profile set <name> --password '<pwd>'                              # recreates the item, trusted by security
security delete-generic-password -a abap-cli/session-key -s abap-cli    # next abap command recreates it
```

Sandboxed/agent shells cannot write the login keychain (`Operation not permitted`); run credential-writing commands from a normal terminal. Reads work from sandboxed shells.

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

- Passwords are stored via the OS keychain — native `security` / `cmdkey.exe` / `secret-tool` backend by default; `keytar` is only used when no native helper is available. Entries are keyed by system profile name.
- On macOS, keychain items created by an older `keytar`-backed version keep their old access list; re-run `abap profile set <name> --password` once to recreate them under `/usr/bin/security` and stop the authorization dialog.
- Credentials never appear in command output or error messages
- `.env`, `.abap.json`, and `~/.abap-cli/` are excluded from version control
- Give agents the minimum SAP authorizations they need (least-privilege users; see `AGENTS.md`)
