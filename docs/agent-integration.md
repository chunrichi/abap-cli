# Agent Integration

abap-cli is designed to be driven by AI agents. Every command supports `--json` output that is stable, machine-parseable, and never requires an interactive TTY (write commands take `--yes`).

## The `--json` Contract

```jsonc
// Success — written to stdout
{ "status": "success", "meta": { "command": "abap pull", "version": "1.2.0", "timestamp": "...", "durationMs": 42, "warnings": [] }, "data": { ... } }

// Failure — written to stderr (stdout empty), exit code non-zero
{ "status": "error", "meta": { ... }, "error": { "code": "NO_TRANSPORT", "category": "VALIDATION_ERROR", "message": "...", ... } }
```

- Success goes to **stdout**; errors go to **stderr**. Capture them separately.
- In `--json` mode a failure writes **exactly one** JSON envelope to stderr and nothing to stdout — do not expect a help block appended to the error, and `JSON.parse(stderr)` always succeeds.
- Human-readable help is only printed by `--help` (and `abap help <command>`). A bare invocation (for example `abap pull` with no object/`--package`/`--tr`) or a missing required argument is a `USAGE` failure (`exit 2`); its envelope points at the full option list through `error.details.help`.
- Exit code `0` = success, `1` = unknown/unmapped failure, `2`–`9` = categorized (usage / config / TLS / auth / SAP / validation / not-found / locked), plus reserved-range codes `64` DDLS not supported on this release and `65` channel detection. The mapping is stable and 1:1 with `error.category`.
- `error.code` is stable and machine-readable; `error.category` is explicit (see [Commands → Error Codes](commands.md#error-codes)). Non-fatal warnings live in `meta.warnings` and never change the exit code.
- Recovery metadata is structured, not prose: `error.nextSteps` (ordered actions), `error.example` (one canonical invocation), `error.references` (repo-relative skill doc) and, where a value is missing, `error.details.missing`. A first run in an unconfigured workspace therefore reports `CONFIG_ERROR` with `details.missing: ["system"]` instead of a message-only error.

## Non-Interactive Operation

Commands require no TTY:

- Fully parameterized `abap init` (no prompts)
- `--json` on every command
- Write commands (`create`, `push`, `delete`, `mime create/push/delete`, `transport create`) require `--yes` outside a TTY, or `--dry-run` where supported to preview; read-only commands never prompt

## The Core Loop for Agents

### 1. Create → Pull → Edit → Push (source objects)

```bash
# Create a class with a default skeleton (activated by default)
abap create CLAS ZCL_DEMO --package ZDEV --description "Demo" --tr DEVK900001 --yes --json

# Pull it back to edit locally
abap pull ZCL_DEMO --json

# ... edit src/zcl_demo.clas.abap ...

# Push the change (lock → write → activate → unlock)
abap push src/zcl_demo.clas.abap --tr DEVK900001 --yes --json
```

### 2. Recovering from `NO_TRANSPORT`

When a test/dev account has no open transport request, `push`/`create` fail with `NO_TRANSPORT`. The agent can manage transports entirely from the CLI:

```bash
# Confirm no request is available
abap transport list --open --json
# → { "status": "success", "data": { "workbench": [], "customizing": [] } }

# Create a request (default $TMP → local request)
abap transport create "Feature work" --yes --json
# → { "status": "success", "data": { "transport": "DEVK900123", ... } }

# Retry with the explicit request
abap push src/zcl_demo.clas.abap --tr DEVK900123 --yes --json
```

This closes the "no request → create → use with `--tr`" loop without touching SAP GUI.

### 3. Detecting & fixing stale activation

A `push` that reports `activated` can still leave the object stale on real SAP when method/OSI-level inactive items were not included in the activation. Verify with the read-only check, then repair:

```bash
# Check whether active source really matches latest (per part)
abap inspect <object> --activation --json
# → { status: "success", data: { ..., activation: { ok: false, parts: [{ includeType, sourceUri, active }] } } }

# Activate all inactive items of the object (method/OSI level)
abap activate <object> --yes --json
# → { status: "success", data: { object, activated: <n> } }

# Re-verify
abap inspect <object> --activation --json   # activation.ok should now be true
```

This keeps the normal `push` flow lightweight: diagnose on demand with `inspect --activation`, repair with `activate`.

## Parsing Examples

### Node.js

```js
import { execFileSync } from 'node:child_process';

const stdout = execFileSync('abap', ['transport', 'list', '--json'], { encoding: 'utf8' });
const result = JSON.parse(stdout);
if (result.status === 'success') {
  const numbers = result.data.workbench.map((r) => r.number);
  console.log(numbers);
}
```

### Shell (jq)

```bash
transport=$(abap transport create "task" --yes --json | jq -r '.data.transport')
abap push src/zcl_demo.clas.abap --tr "$transport" --yes --json
```

## Guidance for Agents

- **Always use `--json`** in automation; reserve human-readable output for interactive terminals.
- **Check `status` and `error.code`**, not free-text messages.
- **Never echo credentials** — passwords come from the OS keychain (or `--password` / a TTY prompt); never pass them on command lines that are logged.
- **Prefer explicit `--tr`** when a specific transport is required; automatic resolution only finds requests in the user's modifiable list.
- **Loop safely** — each step is idempotent at the boundary (create reports `OBJECT_EXISTS` rather than overwriting; push reports per-file results).
