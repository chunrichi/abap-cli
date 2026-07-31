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

# Initialize workspace
abap init --url https://sap:44300 --client 100 --username DEV

# Download an object from SAP
abap pull ZCL_MY_CLASS

# Edit the local file, then push back
abap push src/zcl_my_class.clas.abap --tr DEVK900001

# Syntax check only
abap check src/zcl_my_class.clas.abap
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `abap init` | Initialize workspace configuration |
| `abap pull <object>` | Download ABAP object from SAP |
| `abap push <files...>` | Push local files to SAP (lock → edit → check → activate) |
| `abap check <files...>` | Syntax check only |
| `abap search <query>` | Search ABAP objects |
| `abap create <type> <name>` | Create a new ABAP object |
| `abap atc [files...]` | Run ATC checks |
| `abap status` | Show local vs SAP differences |
| `abap transport list` | List transport requests |
| `abap deploy` | Deploy bundled ICF service to SAP |

All commands support `--json` for structured output.

## File Format

Source objects use abap-file-format conventions (`.clas.abap`, `.prog.abap`, etc.). DDIC objects use JSON (`.doma.json`, `.tabl.json`, etc.).

## License

MIT
