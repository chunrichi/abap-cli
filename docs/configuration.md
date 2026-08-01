# Configuration

abap-cli keeps configuration in two places: a **user-level** system profile store and a **workspace-level** `.abap.json`. Passwords live in the OS keychain — never in version-controlled files.

## Configuration Layers

| Layer | File | Content | Secrets |
|-------|------|---------|---------|
| User-level | `~/.abap-cli/systems.json` | Named system profiles (URL, client, user, language) | No |
| OS keychain | (keytar) | Password per system profile name | Yes |
| Workspace | `<project>/.abap.json` | References a system profile + default transport/package | No |
| Environment | `SAP_PASSWORD` etc. | Overrides for automation | Yes (but ephemeral) |

Precedence for credentials: **OS keychain** for the referenced system name, falling back to `SAP_PASSWORD` environment variable.

## System Profiles (`~/.abap-cli/systems.json`)

Created/updated by `abap init` and managed by `abap system`:

```bash
abap system list                  # List saved profiles
abap system show dev              # Show profile details (no secrets)
abap system set dev --url https://sap:44300   # Modify a field
abap system set dev --password '***'          # Update the stored password
abap system delete dev            # Delete profile + stored password
```

The file is written with mode `0600` (`0700` for the directory) and is not committed.

## Workspace Config (`.abap.json`)

```json
{
  "system": "dev",
  "transport": "",
  "package": ""
}
```

| Field | Purpose |
|-------|---------|
| `system` | Name of the system profile to connect to (required) |
| `transport` | Default transport number used when `--tr` is not given |
| `package` | Default package used by commands that create objects |

A template lives at [`.abap.json.example`](../.abap.json.example). This file is gitignored (see `.gitignore`); commit an example, never the real one.

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `SAP_PASSWORD` | Password override when not in the keychain |
| `SAP_URL` / `SAP_USER` / `SAP_CLIENT` / `SAP_LANGUAGE` | Used by `abap init` in non-interactive mode |
| `NODE_TLS_REJECT_UNAUTHORIZED` | Set to `0` for self-signed certs (development only) |

A template lives at [`.env.example`](../.env.example). `.env` files are gitignored.

## Transport Resolution Order

When a command accepts `--tr`:

1. `--tr <number>` (explicit CLI option)
2. `.abap.json` `transport` (default)
3. The user's first open (modifiable) request, from `userTransports`
4. Otherwise error: `NO_TRANSPORT` — create one with `abap transport create`

> Note: A local request created under `$TMP` does **not** appear in the workbench modifiable list, so automatic resolution will not find it — pass it explicitly with `--tr`.

## Credentials & Security

- Passwords are stored via the OS keychain (`keytar`), keyed by system profile name
- Credentials never appear in command output or error messages
- `.env`, `.abap.json`, and `~/.abap-cli/` are excluded from version control
- Give agents the minimum SAP authorizations they need (Constitution Principle VI)
