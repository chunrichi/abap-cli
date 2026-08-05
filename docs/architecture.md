# Architecture

abap-cli follows a three-layer design with clear separation of responsibilities.

## The Three Layers

| Layer | Directory | Language | Responsibility |
|-------|-----------|----------|----------------|
| **CLI** | `src/abap_cli/` | TypeScript | Thin client: HTTP calls to SAP, file I/O, result display |
| **SAP** | `abap/` | ABAP | ICF service handlers (health/version endpoint now; DDIC CRUD next) |
| **Agent** | `skills/` + `agents/` | Markdown | Skill prompts and multi-step workflow orchestration |

```mermaid
graph LR
    A[Agent / User] -->|CLI commands, --json| C[abap-cli CLI layer]
    C -->|ADT REST API| S1[SAP ADT]
    C -->|RESTful JSON| S2[SAP ICF service /sap/zabap_vibe<br/>health/version + setup]
    C <-->|local files| F[src/ abap-file-format]
```

## CLI Layer (`src/abap_cli/`)

```
src/abap_cli/
├── index.ts              # commander entry point, registers all commands
├── clients/
│   ├── adt-client.ts     # AdtClientWrapper — thin wrapper over abap-adt-api
│   ├── icf-client.ts     # ICF service client (DDIC, later phase)
│   └── probe.ts          # layer-by-layer connection probe (tls → auth → adt → icf)
├── commands/             # one file per CLI command (init, pull, push, ...)
├── config/               # .abap.json + user system profiles
├── crypto/secrets.ts     # OS keychain (keytar) for passwords
├── formats/              # abap-file-format / DDIC JSON file resolution + pull strategies
├── output/               # unified JSON output, error/exit codes, help text
└── sync/                 # orchestration: resolve, transport, push flow, status/diff/sync, deploy, stuck reports
```

### Key decisions

- **ADT via `abap-adt-api`** — source objects (Class/Interface/Program/Function Group) use the standard ADT REST API: search, object structure, source GET/PUT, lock/unlock, content-based syntax check, activation, object creation, transport management.
- **Thin client** — the CLI only orchestrates HTTP calls and file/result handling; business logic stays on the SAP side.
- **Unified output** — every command uses `output/json.ts` (`printResult`/`printError`) so `--json` output is consistent across commands and parseable by agents.
- **Sync orchestration** — `sync/resolve.ts` (object URL + parts resolution), `sync/transport.ts` (`resolveTransport`: `--tr` > config > user's open request > error), `sync/push-flow.ts` (lock → write → check/activate → unlock with `finally`-guaranteed release).

## SAP Layer (`abap/`)

The bundled ICF service lives under `abap/src/clas/` (abapGit layout):
- **`ZCL_ABAP_VIBE_ICF`** — HTTP handler (`IF_HTTP_EXTENSION`) for `/sap/zabap_vibe/`: root path returns a unified JSON envelope with service id + version; unknown paths / methods return unified error JSON.
- **`ZCL_ABAP_VIBE_ICF_SETUP`** — `IF_OO_ADT_CLASSRUN` runner that idempotently creates/binds/activates the SICF node via the standard `CL_ICF_TREE` API (ADR gap: SICF config is not covered by ADT REST).

`abap deploy` pushes the bundled sources then triggers the setup class; `abap init` checks deployment state/version. DDIC object CRUD (Domain, DataElement, Table, Structure, Table Type) is the next phase, built on the same ICF service. Development of this layer follows the **Dogfooding** principle — it is itself developed via the CLI's create → pull → edit → push loop.

## Agent Layer (`skills/` + `agents/`)

Markdown prompts that orchestrate the CLI for AI agents:

- `skills/` — per-command skill prompts (e.g. `abap-pull`, `abap-push`)
- `agents/` — multi-step workflow prompts

Agents drive everything through CLI commands with `--json`, never through interactive prompts (Constitution Principle I).

## Constitution

The project is governed by a constitution (see `.specify/memory/constitution.md`), key principles:

1. **Agent-First** — everything callable via CLI, `--json` output, no interactive dependency
2. **Three-layer separation** — responsibilities kept clean
3. **abap-file-format** — local files follow SAP conventions
4. **Minimal viable scope first** — start with core object types
5. **SAP-side consistency** — ICF services follow SAP standards, unified JSON responses
6. **Security & credential isolation** — credentials never in version control
7. **Dogfooding** — SAP-side ICF code is developed using the CLI itself
