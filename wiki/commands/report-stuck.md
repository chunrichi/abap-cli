---
type: command
title: abap report-stuck
description: "Record a stuck-agent report locally (feedback loop)"
tags: [command, report-stuck]
created at: 2026-10-29 14:30:14
changed at: 2026-10-29 14:30:14
---

# `abap report-stuck`

Record a stuck-agent report locally (feedback loop)

## Usage

```bash
report-stuck --goal <text> --tried <text> --where <cmd>
```

## Options

| Option | Required | Default | Values | Description |
| --- | --- | --- | --- | --- |
| `--goal` `<text>` | yes |  |  | What the agent was trying to do |
| `--tried` `<text>` | yes |  |  | What the agent already tried |
| `--where` `<cmd>` | yes |  |  | Which command it was stuck on |

## Examples

- Record a stuck push attempt.

  ```bash
  abap report-stuck --goal "push zcl_demo" --tried "retried 3x" --where "abap push"
  ```

## Expected Output

`--json` returns the standard envelope; success on stdout, errors on stderr with a categorized exit code. See [agent-integration](../../docs/agent-integration.md).

# More

_Add real-system observations (prerequisites, gotchas, evidence) here; this page is generated once as a stub and then owned by maintainers._

# references

- [docs/commands.md](../../docs/commands.md) — generated parameter reference
- [agent-integration.md](../../docs/agent-integration.md) — `--json` contract
