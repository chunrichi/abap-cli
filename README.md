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
abap init --url https://sap:44300 --client 100 --username DEV --password '***'

# Download an object from SAP (classes pull all include parts into a per-object dir)
abap pull ZCL_MY_CLASS

# Edit the local file, then push back (lock → write → activate → unlock)
abap push src/zcl_my_class/zcl_my_class.clas.abap --tr DEVK900001

# Syntax check only (no activation, no SAP-side changes)
abap check src/zcl_my_class/zcl_my_class.clas.abap

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
| `abap init` | Initialize workspace configuration (system profile + `.abap.json`) |
| `abap pull <object>` | Download a source object to `src/<object>/` (abap-file-format: per-object dir with `<name>.<type>.json` + `.abap` parts; `--type`, `--dir`) |
| `abap push <files...>` | Push local files: lock → write → activate → unlock (`--tr`, `--check-only`, `--all`) |
| `abap check <files...>` | Validate local files: `--syntax` (default, against SAP) / `--content` (local) / `--atc` |
| `abap search <query>` | Search ABAP objects |
| `abap create <type> <name>` | Create a new ABAP source object (CLAS/INTF/PROG/FUGR): writes a default skeleton, pulls it locally, then activates (`--package`, `--description`, `--tr`, `--no-activate`) |
| `abap transport list` | List transport requests (`--open` for open/released filter) |
| `abap transport create <description>` | Create a new transport request (`--package`; default `$TMP` local request, usable via `--tr`) |
| `abap transport show \| resolve \| assign` | Inspect a request / find an object's request / attach an object to a request |
| `abap connection` | Manage global connection profiles (`list` / `show` / `add` / `set` / `use` / `test` / `delete` / `export` / `import`) |
| `abap deploy` | Deploy the bundled ICF ABAP service to SAP |
| `abap doctor` | Diagnose the CLI environment (`--fix` applies safe fixes) |
| `abap inspect <object>` | Read-only SAP object metadata probe |
| `abap diff [file]` | Read-only local↔SAP comparison with per-part change summary |
| `abap sync` | Chain status / pull / push into one workflow |
| `abap report-stuck` | Record a stuck-agent report locally (feedback loop) |
| `abap status` | Show local vs SAP differences (changed parts) |
| `abap atc` | Deprecated — moved to `abap check --atc` |

All commands support `--json` for structured output (Agent-first).

## Scope (v0.6)

- **Source objects** (Class, Interface, Program, Function Group) are fully supported for pull / push / check / create via the ADT REST API
- **Create** (`abap create`) supports CLAS/INTF/PROG/FUGR: creates the object with a default skeleton, pulls it locally and activates it, so it can be immediately edited and pushed back (create → pull → edit → push loop)
- **Transport management** (`abap transport`) lists, creates, inspects and assigns transport requests, closing the "no request → create → `--tr`" loop without SAP GUI
- **Diagnosis & workflows** (`abap doctor`, `abap inspect`, `abap diff`, `abap sync`, `abap report-stuck`) are agent-friendly read-only probes and chained workflows with `--dry-run` safety
- **DDIC objects** (`.doma.json`, `.tabl.json`, …) are rejected with a clear `DDIC_NOT_SUPPORTED` message — planned for a later phase (self-built ICF service)

## File Format

Source objects use abap-file-format conventions (`.clas.abap`, `.prog.abap`, etc.). DDIC objects use JSON (`.doma.json`, `.tabl.json`, etc.).

## License

MIT

