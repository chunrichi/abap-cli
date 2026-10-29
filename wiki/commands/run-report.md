---
type: command
title: abap run-report
description: "Execute an activated REPORT and return its list output (read-only, via the bundled ICF /run/report endpoint). The report runs with DEFAULT selection values; only classic list output is captured. S-4 adds --format (raw|tsv|csv) and --param NAME=VALUE pass-through."
tags: [abap-cli, command, run-report]
created at: 2026-10-29 14:30:14
changed at: 2026-10-29 14:30:14
---

# `abap run-report`

Execute an activated REPORT and return its list output (read-only, via the bundled ICF /run/report endpoint). The report runs with DEFAULT selection values; only classic list output is captured. S-4 adds --format (raw\|tsv\|csv) and --param NAME=VALUE pass-through.

## Usage

```bash
abap run-report <report> [--variant <name>] [--format raw|tsv|csv] [--param NAME=VALUE]...
```

## Arguments

| Argument | Required | Values | Description |
| --- | --- | --- | --- |
| `report` | yes |  | Executable program name (TRDIR subc = 1), e.g. ZR_MY_REPORT. |

## Options

| Option | Required | Default | Values | Description |
| --- | --- | --- | --- | --- |
| `--variant` `<name>` | no |  |  | Selection variant to apply instead of the plain default values. |
| `--format` `<raw|tsv|csv>` | no |  |  | Output format. 'raw' (default) keeps SAP's list layout (with `\|` and `-----` separator bars). 'tsv' / 'csv' extract the columns to a tabular form. The transformation is client-side; the 'output' field always carries the raw SAP list so callers can switch formats without re-running the report. |
| `--param` `<NAME=VALUE>` | no |  |  | Ad-hoc selection-screen parameter, repeated. Forwarded to the SAP-side handler which echoes the list of params back in `data.params`. Apply them by changing report defaults or creating a variant. |

## Examples

- Run a report and print its list

  ```bash
  abap run-report ZR_MY_REPORT
  ```
- Run with a selection variant, as JSON

  ```bash
  abap run-report ZR_MY_REPORT --variant VAR1 --json
  ```
- Run with --format tsv for machine-readable rows

  ```bash
  abap run-report ZR_MY_REPORT --format tsv
  ```
- Pass selection-screen params (forwarded to SAP, echoed in response)

  ```bash
  abap run-report ZR_MY_REPORT --param P_USERNAME=DEVELOPER --param P_MAX=10
  ```

## Expected Output

`--json` returns the standard envelope; success on stdout, errors on stderr with a categorized exit code. See [agent-integration](../../docs/agent-integration.md).

# More

_Add real-system observations (prerequisites, gotchas, evidence) here; this page is generated once as a stub and then owned by maintainers._

# references

- [docs/commands.md](../../docs/commands.md) — generated parameter reference
- [agent-integration.md](../../docs/agent-integration.md) — `--json` contract
