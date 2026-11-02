# Supported Object Types

`abap-cli` supports **25 object type codes**. Each type maps to one set of local artifacts written flat under `src/` — official abap-file-format (AFF) documents for most types, repository-local schemas for `TTYP` / `VIEW` / `SHLP` — and is served by one of two channels:

- **ADT** — the standard ADT REST API: source objects (classes, interfaces, programs, function groups, CDS and RAP sources), packages, table types and message classes.
- **ICF** — the bundled service under `/sap/abap_cli`, installed once per system with `abap deploy`: DDIC objects, SICF service nodes, transaction codes, XSLT transformations, and the types whose ADT endpoint is missing on older releases.

Local artifacts follow the AFF flat layout `<name>.<type>[.<sub_type>][.<content_type>].<ext>` — there are no type or object subdirectories. `<name>` is the AFF file token (lowercase; `/UI2/CL_JSON` → `(ui2)cl_json`), `{json,abap}` means one file per suffix, and `<group>` / `<fm>` / `<include>` stand for a function group, function module and function-group include (`sapl<group>`, `l<group>top`, …).

## Type × command matrix

24 types support `create`, all 25 support `pull`, 23 have a `push` path and 22 have a `delete` path. In the matrix:

- `--file` marks a `create` that reads a JSON document — write it yourself or `pull` a comparable object first.
- `$TMP` marks a `delete` that only removes local objects; delete transportable objects in SAP GUI so the deletion is recorded in a transport.
- `*` marks a `delete` path that exists in the CLI but has not been verified against a real system yet (`SRVB`).

| Type | Object | Create | Pull | Push | Delete | Channel | Local artifacts in `src/` |
|---|---|---|---|---|---|---|---|
| `BDEF` | Behavior definition | ✅ `--file` | ✅ | ✅ | ✅ | ADT | `.bdef.json` + `.bdef.abdl` |
| `CLAS` | Class | ✅ | ✅ | ✅ | ✅ | ADT | `.clas.json` + `.clas.abap` + `.clas.{definitions,implementations,macros,testclasses}.abap` |
| `DCLS` | CDS access control | ✅ `--file` | ✅ | ✅ | ✅ | ADT | `.dcls.json` + `.dcls.acds` |
| `DDLA` | CDS annotation definition | ✅ `--file` | ✅ | ✅ | ✅ | ADT | `.ddla.json` + `.ddla.acds` |
| `DDLS` | CDS view | ✅ `--file` | ✅ | ✅ | ✅ | ADT | `.ddls.json` + `.ddls.acds` |
| `DDLX` | CDS metadata extension | ✅ `--file` | ✅ | ✅ | ✅ | ADT | `.ddlx.json` + `.ddlx.acds` |
| `DEVC` | Package | ✅ | ✅ | — | ✅ | ADT | `.devc.json` |
| `DOMA` | Domain | ✅ `--file` | ✅ | ✅ | ✅ | ICF | `.doma.json` (+ `.doma.docu.json`) |
| `DTEL` | Data element | ✅ `--file` | ✅ | ✅ | ✅ | ICF | `.dtel.json` (+ `.dtel.docu.json`) |
| `ENQU` | Lock object | ✅ `--file` | ✅ | ✅ | — | ICF | `.enqu.json` |
| `FUGR` | Function group | ✅ | ✅ | ✅ | ✅ | ADT | `.fugr.json` + `.fugr.<include>.reps.{json,abap}` + `.fugr.<fm>.func.{json,abap}` |
| `HTTP` | SICF service node | ✅ `--file` | ✅ | ✅ | — | ICF | `.http.json` |
| `INTF` | Interface | ✅ | ✅ | ✅ | ✅ | ADT | `.intf.json` + `.intf.abap` |
| `MSAG` | Message class | ✅ `--file` | ✅ | ✅ | ✅ | auto (ADT / ICF) | `.msag.json` |
| `NROB` | Number range object | ✅ `--file` | ✅ | ✅ | — | ICF (pull: ADT / ICF) | `.nrob.json` |
| `PROG` | Program | ✅ | ✅ | ✅ | ✅ | ADT | `.prog.json` + `.prog.abap` (`.prog.include.abap` for include programs) |
| `SHLP` | Search help | ✅ `--file` | ✅ | ✅ | ✅ `$TMP` | ICF | `.shlp.json` |
| `SRVD` | Service definition | ✅ `--file` | ✅ | ✅ | ✅ | ADT | `.srvd.json` + `.srvd.acds` |
| `SRVB` | Service binding | — | ✅ | — | ✅ `*` | ADT | `.srvb.json` |
| `STRU` | Structure | ✅ `--file` | ✅ | ✅ | ✅ | ICF | `.stru.json` + `.stru.ddic` |
| `TABL` | Transparent table | ✅ `--file` | ✅ | ✅ | ✅ | ICF | `.tabl.json` + `.tabl.ddic` + `.tabl.settings.json` |
| `TRAN` | Transaction code | ✅ `--file` | ✅ | ✅ | ✅ `$TMP` | ICF | `.tran.json` |
| `TTYP` | Table type | ✅ `--file` | ✅ | ✅ | ✅ | auto (ADT / ICF) | `.ttyp.json` (+ `.type.abap`) |
| `VIEW` | Database view | ✅ `--file` | ✅ | ✅ | ✅ `$TMP` | ICF | `.view.json` |
| `XSLT` | Transformation | ✅ `--file` | ✅ | ✅ | ✅ | ICF | `.xslt.json` + `.xslt.xml` |

## Create rules

- Source objects and `DEVC` create from CLI arguments; `create local` drafts `CLAS` / `INTF` / `PROG` / `FUGR` offline, without a SAP connection.
- The remaining creatable types are data-driven: `create` requires `--file` with a JSON document in the type's format (`BDEF` also needs the sibling `.bdef.abdl` source; `SRVB` has no CLI create path yet, although ADT exposes a binding endpoint; `TTYP` / `VIEW` / `SHLP` use the local schemas below). Companion files shown in the same row belong to the same artifact set.
- `abap create --schema <type>` prints the per-type contract, including an example document where one exists.

## Delete rules

- `delete` runs lock → delete → unlock. Packages delete without a lock, and `VIEW` / `SHLP` / `TRAN` / `XSLT` delete through the ICF service.
- `HTTP` nodes are removed in SICF, `NROB` objects in SNRO and lock objects (`ENQU`) in SE11 — none of them has a CLI delete path.
- `pull --textpool` adds text-element artifacts: `<name>.<type>.{texts,selections,headings}.en.properties`.

## Channel routing

- **ADT** — source objects (`CLAS` `INTF` `PROG` `FUGR`), `DEVC`, `TTYP`, `MSAG`, `DDLS`, the CDS / RAP companions (`SRVD` `BDEF` `DCLS` `DDLX` `DDLA`) and `SRVB`. `TTYP` and `MSAG` fall back to ICF automatically on ECC EHP5/6.
- **ICF** — `TABL` `STRU` `DOMA` `DTEL` `ENQU` `VIEW` `SHLP` `HTTP` `TRAN` `XSLT`, plus the write path of `NROB`; these need `abap deploy` once per system (`abap deploy status` checks the installed version).
- `NROB` pulls through ADT with an ICF fallback and writes through ICF. `DDLS` is rejected on ECC releases (`DDLS_NOT_SUPPORTED_ON_ECC`).

## Per-type notes

- `DEVC` — `create` takes `--package` (the super package) and `--description`; there is no `push`, because ADT rejects package updates.
- `TRAN` — dialog, report, parameter and variant transactions; OO transactions stay in SE93.
- `VIEW` / `SHLP` — local-extension schemas (`view-v1.json` / `shlp-v1.json`); upstream AFF defines neither.
- `ENQU` / `NROB` — `create` only works into `$`-prefixed local packages (transportable creation needs a TADIR record), and neither has a delete path — remove lock objects in SE11 and number ranges in SNRO.
- `DOMA` / `DTEL` — long text is an optional companion file (`<name>.<type>.docu.json`, `docu-v1.json`); `lines: []` deletes the remote long text.
- `BDEF` — `create` reads the AFF JSON plus the sibling `.bdef.abdl` source, creates the behavior definition through ADT and activates it; the behavior must target an existing root entity (or a valid unmanaged implementation class). `pull` / `push` / `delete` are also available.
- `SRVB` — metadata only; create and publish are not implemented yet, so bindings are created, published and maintained in SAP GUI. Delete uses the generic ADT path and is not yet verified on a real system.
- `HTTP` — SICF nodes can be created, pulled and pushed; there is no delete path yet — remove the node in SICF.
- `XSLT` — the `.xslt.json` + `.xslt.xml` pair must exist together; an update replaces the transformation in place and keeps its version history.

## Local schema extensions

Upstream [abap-file-formats](https://github.com/SAP/abap-file-formats) defines none of these schemas; the files are maintained in `src/abap_cli/schema/` and validated by the same AFF validator (`abap validate:aff`):

| Type | Schema | Kind | Derived from | Official AFF |
|---|---|---|---|---|
| `TTYP` | `ttyp-v1.json` | local variant — `keyKind` is a local extension | ADT table-type model (upstream `type-v1.json` is a type pool, not a table type) | No |
| `VIEW` | `view-v1.json` | local extension | DD25V / DD26V / DD27P / DD28J / DD28V | No |
| `SHLP` | `shlp-v1.json` | local extension | DD30V / DD31V / DD32P / DD33V | No |

All three keep the AFF conventions (`formatVersion` + `header`, flat `<name>.<type>.json` names) and round-trip through the CLI; treat schema changes like source-code changes. Sources and upgrade notes: [src/abap_cli/schema/README.md](../src/abap_cli/schema/README.md).

## Not supported

| Object type | Status |
|---|---|
| `AUTH` / `SUSO` authorization objects | Not supported — candidate for a future release |
| Enhancements (`ENHO` / `ENHS`), BAdIs | Not supported — use `where-used` to find references |
| AMDP classes, CDS table functions | Not supported |
| SAPscript, Smart Forms, Adobe forms | Not supported |
| Web Dynpro, ITS, BSP | Not supported |
| IDoc / ALE configuration, workflow | Not supported |
| Pool / cluster tables | Not supported — only `TABL` / `STRU` |
| Simple Transformations (`STRANS`) | Not supported — XSLT programs only |
| Package update (`push DEVC`) | Not possible — ADT rejects package updates; change the package in SAP GUI or delete and recreate it |
| OO transactions (`TRAN`) | Not possible — maintain them in SE93 |

Table contents are read-only (`abap select`); customizing is not moved. If a type you need is missing, open an issue on [GitHub](https://github.com/chunrichi/abap-cli/issues).

## See also

- [wiki/object-types.md](../wiki/object-types.md) — per-type deep notes and real-system evidence
- [wiki/coverage-matrix.md](../wiki/coverage-matrix.md) — SAP development task coverage snapshot
- [commands.md](commands.md) — generated command and flag reference
- [architecture.md](architecture.md) — three-layer design and the bundled ICF service
