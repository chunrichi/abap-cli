---
type: command
title: abap feedback
description: "Submit one sanitized issue from a completed agent session."
tags: [command, feedback]
created at: 2026-10-29 14:30:14
changed at: 2026-10-29 14:30:14
---

# `abap feedback`

Submit one sanitized issue from a completed agent session.

## Usage

```bash
feedback [options]
```

## Options

| Option | Required | Default | Values | Description |
| --- | --- | --- | --- | --- |
| `--username` `<name>` | no |  |  | Optional business username override; when omitted it is resolved from $USERNAME, $USER, the OS user info, or `git config user.name`. |
| `--email` `<address>` | no |  |  | Optional contact email. |
| `--feature-key` `<key>` | yes |  |  | Stable feature or function identifier. |
| `--title` `<text>` | yes |  |  | Short issue summary. |
| `--description` `<text>` | yes |  |  | Concise plain-text observation, maximum 255 characters. |
| `--priority` `<level>` | no | `"NORMAL"` | LOW, NORMAL, HIGH, URGENT | Issue priority. |
| `--source-system` `<name>` | no | `"abap-cli"` |  | Calling client or system name. |
| `--agent-id` `<id>` | no |  |  | Optional agent or product identifier. |
| `--session-id` `<id>` | no |  |  | Optional completed agent session identifier. |
| `--idempotency-key` `<key>` | no |  |  | Stable retry key; generated when omitted. |
| `--correlation-id` `<id>` | no |  |  | Optional trace identifier sent as X-Correlation-ID. |
| `--dry-run` | no |  |  | Validate and print the normalized request without submitting it. |
| `--json` | no |  |  | Emit the unified JSON envelope on stdout. |
| `--pretty-json` | no |  |  | Emit formatted JSON instead of compact JSON. |

## Examples

- Submit a concise issue from a completed session

  ```bash
  abap feedback --feature-key abap.push --title "Push reports an unclear error" --description "A valid class push fails after syntax check with no actionable detail." --priority NORMAL --session-id session-123 --json
  ```
- Validate the request without sending it

  ```bash
  abap feedback --username agent-user --feature-key abap.cli --title "Example" --description "Example feedback." --dry-run --json
  ```

## Expected Output

`--json` returns the standard envelope; success on stdout, errors on stderr with a categorized exit code. See [agent-integration](../../docs/agent-integration.md).

# More

_Add real-system observations (prerequisites, gotchas, evidence) here; this page is generated once as a stub and then owned by maintainers._

# references

- [docs/commands.md](../../docs/commands.md) — generated parameter reference
- [agent-integration.md](../../docs/agent-integration.md) — `--json` contract
