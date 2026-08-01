# Getting Started

This guide walks through installing `abap-cli`, configuring a connection to an SAP system, and running your first pull → edit → push workflow.

## Requirements

- **Node.js >= 18** (ESM project, `"type": "module"`)
- An SAP system with the **ADT (ABAP Development Tools)** service enabled (ADT is part of the standard ABAP application server)
- A user with developer authorizations (create/change/activate repository objects)

## Installation

```bash
npm install -g abap-cli
```

Or run from a local checkout:

```bash
git clone <repo-url>
cd abap-cli
npm install
npm run build
node dist/src/abap_cli/index.js --help
```

## First-Time Setup

`abap init` configures your workspace. It can run interactively (TTY) or fully parameterized (non-interactive, ideal for agents/CI).

### Non-interactive (recommended)

```bash
# Reference an existing system profile, or create one from parameters:
abap init --system dev --url https://sap:44300 --client 100 --username DEV --password '***'

# Optionally set default transport and package:
abap init --system dev --transport DEVK900001 --package ZDEV
```

When given a full set of connection parameters, `abap init` creates a named **system profile** (stored under `~/.abap-vibe/systems.json`) and writes a `.abap.json` in the current directory referencing it. The password is stored in the OS keychain, never in plain text.

### Interactive

```bash
abap init
```

Prompts guide you through selecting an existing system profile or entering a new one.

## What `abap init` Produces

`~/.abap-vibe/systems.json` — user-level system profiles (mode `0600`):

```json
{
  "systems": {
    "dev": {
      "url": "https://sap:44300",
      "client": "100",
      "username": "DEV",
      "language": "EN"
    }
  }
}
```

`.abap.json` — workspace reference (commit-friendly, no secrets):

```json
{
  "system": "dev",
  "transport": "",
  "package": ""
}
```

See [Configuration](configuration.md) for details.

## Your First Workflow

```bash
# 1. Download an object (classes pull all include parts to src/)
abap pull ZCL_MY_CLASS

# 2. Edit the local file (abap-file-format naming, e.g. src/zcl_my_class.clas.abap)

# 3. Check syntax locally (no SAP-side changes)
abap check src/zcl_my_class.clas.abap

# 4. Push back (lock → write → activate → unlock)
abap push src/zcl_my_class.clas.abap --tr DEVK900001
```

### When You Have No Transport Request

If `push`/`create` reports `NO_TRANSPORT`, create a request from the CLI and use it explicitly:

```bash
# See what's available
abap transport list --json

# Create a request (default $TMP creates a local request)
abap transport create "Feature X" --json

# Use the returned number via --tr
abap push src/zcl_my_class.clas.abap --tr <REQUEST_NUMBER>
```

### Create → Pull → Edit → Push Loop

```bash
# Create a new class in SAP (writes a default skeleton and activates it)
abap create CLAS ZCL_MY_NEW_CLASS --package ZDEV --description "My class" --tr DEVK900001

# Pull the skeleton, edit, push back
abap pull ZCL_MY_NEW_CLASS
# ... edit src/zcl_my_new_class.clas.abap ...
abap push src/zcl_my_new_class.clas.abap --tr DEVK900001
```

## What's Supported (v0.3+)

- **Source objects** — Class (CLAS), Interface (INTF), Program (PROG), Function Group (FUGR) for pull / push / check / create via the ADT REST API
- **Transport management** — `abap transport list` / `abap transport create`
- **DDIC objects** (Domain, DataElement, Table, etc. as `.json`) — not yet supported; rejected with a clear `DDIC_NOT_SUPPORTED` message (planned via the self-built ICF service)

## Next Steps

- See all commands in [Commands](commands.md)
- Learn how configuration and credentials work in [Configuration](configuration.md)
- Understand the architecture in [Architecture](architecture.md)
