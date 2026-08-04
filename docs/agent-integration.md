# Agent Integration

abap-cli is designed to be driven by AI agents. Every command supports `--json` output that is stable, machine-parseable, and never requires interactive input.

## The `--json` Contract

```jsonc
// Success — written to stdout
{ "status": "success", "data": { ... } }

// Failure — written to stderr, exit code non-zero
{ "status": "error", "error": { "code": "NO_TRANSPORT", "message": "...", ... } }
```

- Success goes to **stdout**; errors go to **stderr**. Capture them separately.
- Exit code `0` = success, `1` = any failure.
- `error.code` is stable and machine-readable (see [Commands → Error Codes](commands.md#error-codes)).

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
