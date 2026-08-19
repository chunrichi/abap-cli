# abap-cli

CLI tool for ABAP vibe coding — agent-driven ABAP development in any agent.

Connect to SAP via the ADT REST API, develop ABAP objects from local files, and drive everything from an AI agent with `--json` output.

> **Documentation**: [docs/README.md](docs/README.md) — getting started, configuration, command reference, architecture, agent integration, and development.

## Architecture

Three-layer architecture:

| Layer | Directory | Language | Description |
|-------|-----------|----------|-------------|
| **CLI** | `src/abap_cli/` | TypeScript | Thin client for SAP communication, file I/O, and result display |
| **SAP** | `abap/` | ABAP | ICF service handlers for DDIC object CRUD (Domain, DataElement, Table, etc.) |
| **Agent** | `skills/` + `agents/` | Markdown | Skill prompts for individual commands and multi-step workflow orchestration |

## Quick Start

```bash
# Install globally
npm install -g abap-cli

# Initialize workspace (interactive or parameterized)
abap init --profile DEV --yes        # bind an existing profile (or run bare `abap init` for the wizard)
abap init --agent copilot            # scaffold agent context (AGENTS.md + skills/)

# Download an object from SAP (classes pull all include parts into a per-object dir)
abap pull ZCL_MY_CLASS

# Edit the local file, then push back (lock → write → activate → unlock)
abap push src/zcl_my_class/zcl_my_class.clas.abap --tr DEVK900001

# Syntax check only (no activation, no SAP-side changes)
abap check syntax src/zcl_my_class/zcl_my_class.clas.abap

# Create a new source object in SAP (writes a default skeleton and activates it)
abap create CLAS ZCL_MY_NEW_CLASS --package $PKG --description "My new class" --tr DEVK900001

# No open transport? Create one and use it explicitly
abap transport list --json
abap transport create "Feature X" --json
abap push src/zcl_my_class/zcl_my_class.clas.abap --tr <REQUEST_NUMBER>
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `abap init` | Initialize the workspace: bind a profile (write `.abap.json`), modify the binding (`--profile` / `--tr` / `--package` / `--source-dir`, merge), inspect (`--show-config`), clear fields (`--unset-package` / `--unset-tr` / `--unset-source-dir`), and/or scaffold AI agent context (`--agent`); bare run opens the interactive wizard |
| `abap profile` | Manage global connection profiles (`list` / `show` / `add` / `set` / `test` / `delete` / `export` / `import`) |
| `abap pull <object>` | Download a source / DDIC / HTTP object to `src/<object>/` (abap-file-format layout; `--type`, `--package`, `--textpool`, `--remote`, `--overwrite`) |
| `abap push <files...>` | Push local files: lock → write → activate → unlock (`--tr`, `--check-only`, `--all`, `--atomic`, `--no-activate`, `--dry-run`) |
| `abap check syntax\|content\|atc <files...>` | Validate local files: syntax (default, against SAP) / content (local) / atc (`--files` shortcut for syntax; `--out` persists raw ATC worklist) |
| `abap search <query>` | Search ABAP objects (`--type`, `--package`, `--exact`/`--fuzzy`, `--page-all`) |
| `abap create <type> <name>` | Create a new source / DDIC / HTTP object (CLAS/INTF/PROG/FUGR + DOMA/DTEL/TABL/STRU + HTTP) and activate it (`--package`, `--description`, `--tr`, `--no-activate`, `--template`, `--file` for DDIC/HTTP) |
| `abap create local <type> <name>` | Experimental: create a local draft skeleton file offline (no SAP connection; `--template`, `--dir`) |
| `abap transport list` / `create` / `show` / `resolve` / `assign` | Manage SAP transport requests (write operations need `--yes` in non-TTY) |
| `abap extension deploy` | Deploy the bundled ICF ABAP service to SAP (auto-creates missing objects, triggers SICF node setup; `--dry-run` / `--diff` / `--force`) |
| `abap extension status` | Probe the SAP-side ICF extension: installed? version match? |
| `abap doctor` | Diagnose the CLI environment (`--fix` applies safe fixes; `--system <name>` scopes the connection section) |
| `abap inspect <object>` | Read-only SAP object metadata probe (`--structure` / `--includes` / `--locks` / `--activation`) |
| `abap activate <object>` | Activate all inactive items (method/OSI level) of an object — repairs stale activation |
| `abap diff [file]` | Read-only local↔SAP comparison with per-part change summary |
| `abap status` | Show local vs SAP differences (changed parts; `--remote-only` / `--local-only` / `--since` / `--all`) |
| `abap run <class>` | Read-only execution of an ABAP class (classrun) or PUBLIC STATIC method via the bundled runner wrapper (push → run → verify loop) |
| `abap select --table <name>` | Read-only table data query (SE16N equivalent; `--fields` / `--where` / `--limit` / `--order-by` / `--count-only` / `--schema`) |
| `abap where-used <object>` (alias `references`) | Read-only query of the object's direct references (ADT `usageReferences`); pre-refactor impact assessment |
| `abap tcode <code>` | Read-only resolution of a transaction code to its configured ABAP entry program + screen (TSTC → TSTCT; ICF `/tcode/<code>`) |

All commands support `--json` (compact) and `--pretty-json` (indented) for structured output (Agent-first).

## Scope (v0.2)

- **Source objects** (Class, Interface, Program, Function Group) are fully supported for pull / push / check / create via the ADT REST API
- **DDIC objects** (Domain, DataElement, Table, Structure as `.doma.json` / `.dtel.json` / `.tabl.json` / `.stru.json`) — create / overwrite / pull via the self-built ICF service (`/sap/zabap_vibe/ddic/*`). `abap create <DOMA|DTEL|TABL|STRU> <name> --file <json>` creates; `abap pull <name> --type <T>` downloads; `abap push <name>.<type>.json --tr <tr>` updates. TABL/STRU write abap-file-format three-piece layouts (024); TTYP deferred.
- **HTTP service** (022) — `abap pull <name> --type HTTP` / `abap push <file>.http.json` / `abap create HTTP <name> --file <file>.http.json` via ICF `/http/<name>`. Compatible with abap-file-format `zif_aff_http_v1`.
- **Transport management** (`abap transport`) lists, creates, inspects and assigns transport requests, closing the "no request → create → `--tr`" loop without SAP GUI
- **Read-only execution & data access** — `abap run` (classrun / static method), `abap select` (SE16N equivalent), `abap where-used` (impact assessment), `abap tcode` (TSTC → TSTCT)
- **Diagnosis & workflows** (`abap doctor`, `abap inspect`, `abap diff`, `abap status`, `abap activate`) are agent-friendly read-only probes with `--dry-run` safety
- **ICF service** — `abap extension deploy` deploys the bundled `/sap/zabap_vibe` service (handler + SICF setup, health/version endpoint); `abap extension status` reports installation/version state; `abap inspect --activation` + `abap activate` detect and repair stale activation

## File Format

Source objects use abap-file-format conventions (`.clas.abap`, `.prog.abap`, etc.). DDIC objects use JSON (`.doma.json`, `.tabl.json`, etc.).

## License

MIT

