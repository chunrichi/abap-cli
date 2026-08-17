# Agent Integration

abap-cli is designed to be driven by AI agents. Every command supports `--json` output that is stable, machine-parseable, and never requires interactive input.

## The `--json` Contract

```jsonc
// Success — written to stdout
{ "status": "success", "meta": { "command": "abap pull", "version": "0.1.0", "timestamp": "...", "durationMs": 42, "warnings": [] }, "data": { ... } }

// Failure — written to stderr (stdout empty), exit code non-zero
{ "status": "error", "meta": { ... }, "error": { "code": "NO_TRANSPORT", "category": "VALIDATION_ERROR", "message": "...", ... } }
```

- Success goes to **stdout**; errors go to **stderr**. Capture them separately.
- Exit code `0` = success, `1` = unknown/unmapped failure, `2`–`9` = categorized (usage / config / TLS / auth / SAP / validation / not-found / locked). The mapping is stable and 1:1 with `error.category`.
- `error.code` is stable and machine-readable; `error.category` is explicit (see [Commands → Error Codes](commands.md#error-codes)). Non-fatal warnings live in `meta.warnings` and never change the exit code.

## Non-Interactive Operation

Commands require no TTY:

- Fully parameterized `abap init` (no prompts)
- `--json` on every command
- No interactive confirmations in the pull/push/check/create/transport flows

## The Core Loop for Agents

### 1. Create → Pull → Edit → Push (source objects)

```bash
# Create a class with a default skeleton (activated by default)
abap create CLAS ZCL_DEMO --package ZDEV --description "Demo" --tr DEVK900001 --json

# Pull it back to edit locally
abap pull ZCL_DEMO --json

# ... edit src/zcl_demo/zcl_demo.clas.abap ...

# Push the change (lock → write → activate → unlock)
abap push src/zcl_demo/zcl_demo.clas.abap --tr DEVK900001 --json
```

### 2. Recovering from `NO_TRANSPORT`

When a test/dev account has no open transport request, `push`/`create` fail with `NO_TRANSPORT`. The agent can manage transports entirely from the CLI:

```bash
# Confirm no request is available
abap transport list --open --json
# → { "status": "success", "data": { "workbench": [], "customizing": [] } }

# Create a request (default $TMP → local request)
abap transport create "Feature work" --json
# → { "status": "success", "data": { "transport": "DEVK900123", ... } }

# Retry with the explicit request
abap push src/zcl_demo/zcl_demo.clas.abap --tr DEVK900123 --json
```

This closes the "no request → create → use with `--tr`" loop without touching SAP GUI (Constitution Principle VII, Dogfooding).

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
transport=$(abap transport create "task" --json | jq -r '.data.transport')
abap push src/zcl_demo/zcl_demo.clas.abap --tr "$transport" --json
```

## Guidance for Agents

- **Always use `--json`** in automation; reserve human-readable output for interactive terminals.
- **Check `status` and `error.code`**, not free-text messages.
- **Never echo credentials** — passwords come from the OS keychain or `SAP_PASSWORD`; never pass them on command lines that are logged.
- **Prefer explicit `--tr`** when a specific transport is required; automatic resolution only finds requests in the user's modifiable list.
- **Loop safely** — each step is idempotent at the boundary (create reports `OBJECT_EXISTS` rather than overwriting; push reports per-file results).
