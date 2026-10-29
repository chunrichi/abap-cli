---
type: command
title: abap fields
description: "List the DDIC fields of a table or view (read-only). Two modes: `abap fields <table>` enumerates the fields of one object; `abap fields --find <f1>,<f2>...` returns every table that contains those fields (S-2 reverse lookup)."
tags: [abap-cli, command, fields]
created at: 2026-10-29 14:30:14
changed at: 2026-10-29 14:30:14
---

# `abap fields`

List the DDIC fields of a table or view (read-only). Two modes: `abap fields <table>` enumerates the fields of one object; `abap fields --find <f1>,<f2>...` returns every table that contains those fields (S-2 reverse lookup).

## Usage

```bash
abap fields <table> [--json] | abap fields --find <f1>,<f2>,...
```

## Arguments

| Argument | Required | Values | Description |
| --- | --- | --- | --- |
| `table` | no |  | Table or view name (e.g. VRSD). Uppercased. Required unless --find is given. |

## Options

| Option | Required | Default | Values | Description |
| --- | --- | --- | --- | --- |
| `--find` `<field1,field2,...>` | no |  |  | Reverse lookup: list every table that contains the given fields. Comma-separated. Mutually exclusive with the positional table name. |
| `--any` | no |  |  | With --find, return tables containing ANY of the requested fields (default: ALL). |
| `--with-text` | no |  |  | With --find, include DDIC short text (DD03T/DD04T) for each matched field. |
| `--as4local` `<A|I>` | no |  |  | With --find, the DDIC active/inactive version to scan. Default 'A' (active). Pass 'I' to include inactive / changed versions. |
| `--tabclass` `<class>` | no |  |  | With --find, restrict to a DDIC table class (TRANSP, VIEW, INTTAB, ...). |
| `--limit` `<n>` | no |  |  | Max matches to return (default 200, hard cap 5000). |
| `--json` | no |  |  | Emit a single JSON envelope (global flag). |

## Examples

- Field inventory as JSON

  ```bash
  abap fields VRSD --json
  ```
- Human-readable listing

  ```bash
  abap fields VRSD
  ```
- Reverse lookup: tables that record a change user + date

  ```bash
  abap fields --find CHANGED_BY,CHANGED_ON --tabclass TRANSP
  ```
- Reverse lookup: tables with a UNAM field

  ```bash
  abap fields --find UNAM
  ```

## Expected Output

`--json` returns the standard envelope; success on stdout, errors on stderr with a categorized exit code. See [agent-integration](../../docs/agent-integration.md).

# More

_Add real-system observations (prerequisites, gotchas, evidence) here; this page is generated once as a stub and then owned by maintainers._

# references

- [docs/commands.md](../../docs/commands.md) — generated parameter reference
- [agent-integration.md](../../docs/agent-integration.md) — `--json` contract
