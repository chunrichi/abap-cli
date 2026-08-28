# abap-cli

> **Vibe coding for ABAP.** Edit ABAP like any local file, sync it to SAP from the CLI, and let an AI agent orchestrate the whole loop.

`abap-cli` wraps SAP's ADT REST API into a thin command chain. `pull` an object down to your filesystem, `push` your changes back, `check` syntax, `run` a class, `select` from a table. Every command emits `--json` output designed for AI agents.

📖 **Other languages**: [简体中文](README.zh-CN.md)

---

## What problem does it solve

Modifying ABAP in SAP usually means: log into the GUI, open SE80, hunt for a transport, lock the object, edit the code, activate, unlock. One loop takes five minutes minimum, and any failed step forces you to start over.

`abap-cli` compresses that loop to a couple of commands:

```bash
abap pull ZCL_MY_CLASS          # download the class (with all includes) to your filesystem
# edit zcl_my_class.clas.abap in your favorite editor
abap push src/zcl_my_class/ --tr DEVK900001   # lock → write → activate → unlock
```

Need a new object? `create` scaffolds it in one shot. Just want a syntax check? `check syntax` validates without activating or holding any lock. Need table data? `select` is the SE16N equivalent. Wondering which objects your change will impact? `where-used` lists direct references.

Going further: **every command supports `--json`**, so an AI agent can run the loop itself — `pull` → edit file → `check syntax` → `push` → `run` → verify — without the GUI and without a human in the loop.

---

## Why choose it

| You want to … | Other tools | abap-cli |
|---|---|---|
| Edit ABAP in your local editor | No official tooling; abapGit is repo-level sync | Single-file `pull` / `push`, with lock + activate |
| Query SAP without opening the GUI | SE16N / SE16H only | `abap select` is the SE16N equivalent, with `--where` / `--limit` / `--json` |
| Have an AI agent edit ABAP | adt-cli targets scripts, not agents | Every command emits compact `--json` + structured error envelope + exit codes |
| Create or find transport requests | SAP GUI required | `abap transport list / create / assign` closes the loop in the CLI |
| Validate syntax without activating | No direct path | `abap check syntax` is read-only — zero side effects |
| Run an ABAP class and see the result | SE80 / SE24 + debugger | `abap run <class>` returns the outcome in one command |
| Handle function groups, includes, DDIC objects | Manual in GUI | `pull` / `push` / `create` cover CLAS / INTF / PROG / FUGR / DOMA / DTEL / TABL |

**vs abapGit**: `abap-cli` is a **development-loop** tool (frequent, single-file, agent-friendly). abapGit is a **release** tool (one-shot, whole-package, git workflow). They complement each other.

**vs `abap-adt-api`** (the Node SDK): `abap-cli` is its **productized wrapper** — you get every ADT capability without writing Node code, plus agent-friendly layers: `--json` contracts, error-code mapping, automatic transport resolution, DDIC over a self-hosted ICF service.

---

## 30-second quick start

```bash
npm install -g abap-cli

# 1. Configure the SAP connection (first time)
abap init                 # interactive wizard: host / user / password / package / transport
# or:
abap profile add DEV --host vhcala4hci:50000 --user developer --client 001
abap init --profile DEV --yes

# 2. Pull an object to your filesystem
abap pull ZCL_MY_CLASS

# 3. Edit src/zcl_my_class/zcl_my_class.clas.abap

# 4. Push it back to SAP
abap push src/zcl_my_class/ --tr DEVK900001

# 5. No transport yet? Create one on the fly
abap transport create "Feature X" --json
```

For agent use, append `--json` or `--pretty-json` for structured output:

```bash
abap search "*user*" --type CLAS --json
abap where-used ZCL_MY_CLASS --json
abap run ZCL_MY_HELPER --json
abap select --table SFLIGHT --fields CARRID CONNID --limit 5 --json
```

---

## Command reference

| Command | What it does |
|---|---|
| `abap init` | Bind the workspace to a SAP profile (writes `.abap.json`), adjust package / transport / source-dir; bare invocation opens the interactive wizard |
| `abap profile` | Manage global connection profiles: `list` / `show` / `add` / `set` / `test` / `delete` / `export` / `import` |
| `abap pull <object>` | Download source / DDIC / HTTP objects to local files (`--type`, `--package`, `--tr <transport>`, `--textpool`, `--remote`, `--overwrite`) |
| `abap push <files...>` | Push local edits back to SAP (`--tr`, `--check-only`, `--all`, `--atomic`, `--no-activate`, `--dry-run`, `--yes`) |
| `abap check syntax\|content\|atc <files...>` | Validate local files: `syntax` (against SAP) / `content` (local) / `atc` (`--variant`) |
| `abap search <query>` | Search ABAP objects (`--type`, `--package`, `--exact` / `--fuzzy`, `--page-all`) |
| `abap create <type> <name>` | Create a source / DDIC / HTTP object in SAP and activate (`--package`, `--description`, `--tr`, `--template`, `--file`) |
| `abap create local <type> <name>` | Generate a draft skeleton offline (no SAP connection) |
| `abap transport list\|create\|show\|resolve\|assign` | Manage transports (write actions require `--yes`) |
| `abap extension deploy\|status` | Deploy / probe the SAP-side ICF service (backend for DDIC / HTTP / tcode resolution) |
| `abap extensions list\|lock` | Manage installed third-party extensions (023) + 027 trust hardening (npm sha512 pinned in `extensions.lock.json`) |
| `abap doctor` | Diagnose the CLI environment (`--fix` applies safe fixes) |
| `abap inspect <object>` | Read-only object metadata (`--structure` / `--includes` / `--locks` / `--activation`) |
| `abap activate <object>` | Activate the object (repairs stale activation) |
| `abap diff [file]` | Read-only local ↔ SAP comparison |
| `abap status` | Show which objects have changes (`--remote-only` / `--local-only` / `--since` / `--all`) |
| `abap run <class>` | Run an ABAP class (classrun) or a PUBLIC STATIC method (`push → run → verify` loop) |
| `abap select --table <name>` | Read-only table query, SE16N equivalent (`--fields` / `--where` / `--limit` / `--order-by` / `--count-only`) |
| `abap where-used <object>` | Direct reference query for an object (refactor impact assessment) |
| `abap tcode <code>` | Resolve a transaction code → entry program + screen (TSTC → TSTCT) |

All commands support `--json` (compact) and `--pretty-json` (indented).

---

## Supported object types

- **CLAS / INTF / PROG / FUGR** — source objects; full pull / push / check / create / activate
- **DOMA / DTEL / TABL / STRU** — DDIC objects (JSON descriptors); requires `abap extension deploy` once
- **HTTP service** (`/sap/zabap_vibe/http/<name>`) — HTTP handler objects
- **Read-only queries**: `select` (TABL / VIEW) / `run` / `tcode` / `where-used` / `search` do **not** require the ICF extension

---

## Documentation

- [docs/getting-started.md](docs/getting-started.md) — Install + first-time setup
- [docs/configuration.md](docs/configuration.md) — `.abap.json`, profiles, environment variables
- [docs/commands.md](docs/commands.md) — Full command + flag reference
- [docs/agent-integration.md](docs/agent-integration.md) — For AI agents: `--json` contracts, error codes, skill orchestration
- [docs/architecture.md](docs/architecture.md) — Three-layer architecture, extension points (developer-facing)
- [docs/development.md](docs/development.md) — Local development, testing, release (contributor-facing)

## License

MIT