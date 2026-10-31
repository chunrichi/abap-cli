# Commands

Per-command knowledge pages (prerequisites, gotchas, real-system evidence) live next to this index. The generated parameter reference is `docs/commands.md`; every command below must have a page.

| Command | Page | Summary |
| --- | --- | --- |
| `abap init` | [init.md](init.md) | Initialize the workspace (bind a profile, write .abap.json) and/or scaffold AI agent context |
| `abap pull` | [pull.md](pull.md) | Download ABAP objects from SAP to local files |
| `abap run` | [run.md](run.md) | Execute ABAP class (classrun) or PUBLIC STATIC method; returns stdout + exit code |
| `abap select` | [select.md](select.md) | Query table data read-only (SE16N equivalent) via the bundled ICF /data endpoint |
| `abap fields` | [fields.md](fields.md) | List the fields of a table or view (read-only, DD03L-backed) |
| `abap run-report` | [run-report.md](run-report.md) | Execute an activated REPORT and return its list output (read-only) |
| `abap list` | [list.md](list.md) | List ABAP objects in a package (read-only) |
| `abap delete` | [delete.md](delete.md) | Delete an ABAP object from SAP (lock → delete → unlock) |
| `abap push` | [push.md](push.md) | Push local ABAP files to SAP |
| `abap check` | [check.md](check.md) | Validate ABAP source code (syntax / content / atc) |
| `abap test` | [test.md](test.md) | Run ABAP Unit tests for an object (read-only) |
| `abap search` | [search.md](search.md) | Search for ABAP objects in SAP system |
| `abap create` | [create.md](create.md) | Create a new ABAP object (CLAS, INTF, PROG, FUGR, DEVC, DDIC, HTTP, TRAN, VIEW, SHLP, XSLT, CDS) |
| `abap status` | [status.md](status.md) | Show local vs SAP sync status |
| `abap transport` | [transport.md](transport.md) | Manage transport requests |
| `abap deploy` | [deploy.md](deploy.md) | Deploy bundled ICF ABAP service to SAP |
| `abap profile` | [profile.md](profile.md) | Manage global connection profiles |
| `abap doctor` | [doctor.md](doctor.md) | Diagnose CLI environment and configuration (read-only) |
| `abap inspect` | [inspect.md](inspect.md) | View ABAP object metadata |
| `abap where-used` | [where-used.md](where-used.md) | Find SAP object references (read-only) |
| `abap tcode` | [tcode.md](tcode.md) | Resolve transaction code to its ABAP entry program (read-only) |
| `abap activate` | [activate.md](activate.md) | Activate inactive ABAP objects |
| `abap diff` | [diff.md](diff.md) | Compare local files against SAP |
| `abap dumps` | [dumps.md](dumps.md) | List recent ST22 ABAP runtime dumps (read-only) |
| `abap types` | [types.md](types.md) | Print the CLI type ↔ TADIR / DDIC mapping (no SAP call) |
| `abap report-stuck` | [report-stuck.md](report-stuck.md) | Write a stuck-operation report for offline triage |
| `abap mime` | [mime.md](mime.md) | Create, delete, or upload MIME Repository resources (create \| delete \| push) |
| `abap validate:aff` | [validate-aff.md](validate-aff.md) | Validate JSON files against official abap-file-format (AFF) canonical schemas (Draft 2020-12) |
| `abap session` | [session.md](session.md) | Inspect / manage session cookie reuse state |

Non-command contracts in this directory: [path-output.md](path-output.md).
