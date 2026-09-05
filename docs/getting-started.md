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

`abap init` configures your workspace. The parameter form `abap init --profile <name> --yes` binds an existing profile; a bare `abap init` (TTY) opens the interactive wizard.

### Non-interactive (recommended)

```bash
# Create a global profile once, then bind the workspace to it:
abap profile add dev --url https://sap:44300 --client 100 --username DEV --password '***'
abap init --profile dev --yes

# Optionally set default transport and package, and scaffold agent context:
abap init --profile dev --tr DEVK900001 --package ZDEV --yes
abap init --agent copilot
```

Global **system profiles** are stored under `~/.abap-cli/systems.json`; `abap init` writes a `.abap.json` in the current directory referencing the chosen profile. The password is stored in the OS keychain, never in plain text.

### Interactive

```bash
abap init   # runs the wizard
```

Prompts guide you through selecting an existing system profile or entering a new one.

## What `abap init` Produces

`~/.abap-cli/systems.json` — user-level system profiles (mode `0600`):

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
  "package": "",
  "sourceDir": ""
}
```

The same `abap init` command is also the entry point for **modifying** an existing `.abap.json`:

```bash
# Switch default transport or package (merge, not replace — other fields stay)
abap init --tr DEVK900002 --package Z_NEW --yes

# Rebind to a different profile (preserves transport / package unless overridden)
abap init --profile qa --yes

# Inspect the current binding (read-only, no SAP call)
abap init --show-config

# Clear a single field
abap init --unset-package --yes
```

See [Configuration](configuration.md) for details.

## Your First Workflow

```bash
# 1. Download an object (per-object dir under src/, e.g. src/zcl_my_class/)
abap pull ZCL_MY_CLASS

# 2. Edit the local file (abap-file-format naming, e.g. src/zcl_my_class/zcl_my_class.clas.abap)

# 3. Check the file (syntax mode is the default, checked against SAP; nothing is changed)
abap check syntax src/zcl_my_class/zcl_my_class.clas.abap

# 4. Push back (lock → write → activate → unlock)
abap push src/zcl_my_class/zcl_my_class.clas.abap --tr DEVK900001
```

### When You Have No Transport Request

`abap push` resolves the transport **per object**: an object already assigned to a request reuses it, and objects in `$TMP` push with no transport at all — so a freshly `abap create`d or `abap deploy`ed `$TMP` object can be pushed without `--tr`. Only an unbound object in a real package needs an explicit request:

```bash
# See what's available
abap transport list --json

# Create a request (default $TMP creates a local request)
abap transport create "Feature X" --json

# Use the returned number via --tr
abap push src/zcl_my_class/zcl_my_class.clas.abap --tr <REQUEST_NUMBER>
```

### Create → Pull → Edit → Push Loop

```bash
# Create a new class in SAP (writes a default skeleton, pulls it locally, and activates it)
abap create CLAS ZCL_MY_NEW_CLASS --package ZDEV --description "My class" --tr DEVK900001

# Pull the skeleton, edit, push back
abap pull ZCL_MY_NEW_CLASS
# ... edit src/zcl_my_new_class/zcl_my_new_class.clas.abap ...
abap push src/zcl_my_new_class/zcl_my_new_class.clas.abap --tr DEVK900001
```

## What's Supported (v0.2)

- **Source objects** — Class (CLAS), Interface (INTF), Program (PROG), Function Group (FUGR) for pull / push / check / create via the ADT REST API
- **DDIC objects** (Domain, DataElement, Table, Structure as `.doma.json` / `.dtel.json` / `.tabl.json` / `.stru.json`) — create / overwrite / pull via the self-built ICF service (`/sap/zabap_vibe/ddic/*`). TABL/STRU pull writes abap-file-format three-piece layouts. `abap create <DOMA|DTEL|TABL|STRU> <name> --file <json>` creates; `abap pull <name> --type <T>` downloads; `abap push <name>.<type>.json --tr <tr>` updates. TTYP is deferred.
- **HTTP service** — `abap pull <name> --type HTTP` / `abap push <file>.http.json` / `abap create HTTP <name> --file <file>.http.json` via ICF `/http/<name>`. Compatible with abap-file-format `zif_aff_http_v1`.
- **Read-only execution & data access** — `abap run` (classrun / static method, push → run → verify), `abap select` (SE16N equivalent), `abap where-used` (impact assessment before refactor / delete), `abap tcode` (TSTC → TSTCT)
- **Transport management** — `abap transport list` / `create` / `show` / `resolve` / `assign`
- **Diagnosis & workflows** — `abap doctor`, `abap inspect`, `abap diff`, `abap status`, `abap activate`
- **ICF service lifecycle** — `abap deploy` deploys the bundled ICF service (`/sap/zabap_vibe`) and triggers its SICF node setup; `abap deploy status` reports installation/version state; `abap init` checks deployment/version state; `abap activate` fixes stale activation (see [Commands](commands.md))
- **Textpool (text elements)** — read/write program text symbols, selection texts and list headings via `abap pull <name> --textpool` and `abap push <name>.<type>.texts|selections|headings.<lang>.properties`. Mixed mode: the ADT text-elements API is used when the system supports it; ECC/older systems route through the ICF `/textpool/*` endpoint. Capability is probed once when the connection profile is created (`abap profile add/set`, `abap init`) and cached in the profile — no runtime fallback (see [Commands](commands.md) for details).

## Deploy the Bundled ICF Service

The bundled service (handler + setup classes in `abap/src/clas/`) provides the `/sap/zabap_vibe/` health/version endpoint and is the base for future DDIC CRUD.

```bash
# Deploy sources and trigger SICF node creation/activation (idempotent)
abap deploy --yes --json
# → data.icfNode: { status: "success", action: "created|already_active", url: "/sap/zabap_vibe", active: true, handler: "ZCL_ABAP_VIBE_ICF" }

# Verify the endpoint
abap profile test <name> --json       # icf layer should be ok
abap deploy status --json          # installed / version match
abap init --profile <name> --yes --json   # data.icf.status: current / not_deployed / outdated
```

If a class reports `activated` but is actually stale, use the diagnostic + repair pair:

```bash
abap inspect <object> --activation --json # check active vs latest per part
abap activate <object> --yes --json       # activate all inactive items (method/OSI level)
```

## Next Steps

- See all commands in [Commands](commands.md)
- Learn how configuration and credentials work in [Configuration](configuration.md)
- Understand the architecture in [Architecture](architecture.md)
