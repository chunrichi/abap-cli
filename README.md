# abap-vibe

CLI tool for ABAP vibe coding — agent-driven ABAP development in any agent.

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
abap init --url https://sap:44300 --client 100 --username DEV

# Download an object from SAP (classes pull all include parts)
abap pull ZCL_MY_CLASS

# Edit the local file, then push back (lock → write → activate → unlock)
abap push src/zcl_my_class.clas.abap --tr DEVK900001

# Syntax check only (no activation, no SAP-side changes)
abap check src/zcl_my_class.clas.abap

# Create a new source object in SAP (writes a default skeleton and activates it)
abap create CLAS ZCL_MY_NEW_CLASS --package $PKG --description "My new class" --tr DEVK900001
# Use --no-activate to create without activating
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `abap init` | Initialize workspace configuration (system profile + `.abap.json`) |
| `abap pull <object>` | Download a source object to `src/` (all class includes; `--type`, `--dir`; `--package` not yet implemented) |
| `abap push <files...>` | Push local files: lock → write → activate → unlock (`--tr`, `--check-only`, `--all`) |
| `abap check <files...>` | Content-based syntax check only, no SAP-side changes (`--all`) |
| `abap search <query>` | Search ABAP objects |
| `abap create <type> <name>` | Create a new ABAP source object (CLAS/INTF/PROG/FUGR): writes a default skeleton, then activates (`--package`, `--description`, `--tr`, `--no-activate`) |
| `abap system` | Manage system profiles (`list` / `show` / `set` / `delete`) |
| `abap atc [files...]` | Run ATC checks (stub) |
| `abap status` | Show local vs SAP differences (stub) |
| `abap transport list` | List transport requests (`--open` for open/released filter) |
| `abap transport create <description>` | Create a new transport request (`--package`; default `$TMP` local request, usable via `--tr`) |
| `abap deploy` | Deploy bundled ICF service to SAP |

All commands support `--json` for structured output (Agent-first).

## Scope (v0.3)

- **Source objects** (Class, Interface, Program, Function Group) are fully supported for pull / push / check via the ADT REST API
- **Create** (`abap create`) supports CLAS/INTF/PROG/FUGR: creates the object with a default skeleton and activates it, so it can be immediately pulled, edited and pushed back (create → pull → edit → push loop)
- **DDIC objects** (`.doma.json`, `.tabl.json`, …) are rejected with a clear `DDIC_NOT_SUPPORTED` message — planned for a later phase (self-built ICF service)

## File Format

Source objects use abap-file-format conventions (`.clas.abap`, `.prog.abap`, etc.). DDIC objects use JSON (`.doma.json`, `.tabl.json`, etc.).

## License

MIT
