# Supported Object Types

`abap-cli` supports **33 object type codes**. Each type maps to one set of local artifacts written flat under `src/` — official abap-file-format (AFF) documents for most types, repository-local schemas for `TTYP` / `VIEW` / `SHLP` — and is served by one of two channels:

- **ADT** — the standard ADT REST API: source objects (classes, interfaces, programs, function groups, CDS and RAP sources), packages, table types and message classes.
- **ICF** — the bundled service under `/sap/abap_cli`, installed once per system with `abap deploy`: DDIC objects, SICF service nodes, transaction codes, XSLT transformations, and the types whose ADT endpoint is missing on older releases.

Local artifacts follow the AFF flat layout `<name>.<type>[.<sub_type>][.<content_type>].<ext>` — there are no type or object subdirectories. `<name>` is the AFF file token (lowercase; `/UI2/CL_JSON` → `(ui2)cl_json`), `{json,abap}` means one file per suffix, and `<group>` / `<fm>` / `<include>` stand for a function group, function module and function-group include (`sapl<group>`, `l<group>top`, …).

## Type × command matrix

33 types support `create`, all 33 support `pull`, 31 have a `push` path and 33 have a `delete` path. In the matrix:

- `--file` marks a `create` that reads a JSON document — write it yourself or `pull` a comparable object first.
- `$TMP` marks a `delete` that only removes local objects; delete transportable objects in SAP GUI so the deletion is recorded in a transport.

| Type | Object | Create | Pull | Push | Delete | Channel | Local artifacts in `src/` |
|---|---|---|---|---|---|---|---|
| `BDEF` | Behavior definition | ✅ `--file` | ✅ | ✅ | ✅ | ADT | `.bdef.json` + `.bdef.abdl` |
| `CHKC` | ATC check category | ✅ `--file` | ✅ | ✅ | ✅ | ADT | `.chkc.json` |
| `CHKO` | ATC check | ✅ `--file` | ✅ | ✅ | ✅ | ADT | `.chko.json` |
| `CHKV` | ATC check variant | ✅ `--file` | ✅ | ✅ | ✅ | ADT | `.chkv.json` |
| `DTDC` | Dynamic cache | ✅ `--file` | ✅ | ✅ | ✅ | ADT | `.dtdc.json` + `.dtdc.acds` |
| `DTEB` | CDS entity buffer | ✅ `--file` | ✅ | ✅ | ✅ | ADT | `.dteb.json` + `.dteb.acds` |
| `DSFD` | CDS scalar function definition | ✅ `--file` | ✅ | ✅ | ✅ | ADT | `.dsfd.json` + `.dsfd.acds` |
| `DSFI` | CDS scalar function implementation | ✅ `--file` | ✅ | ✅ | ✅ | ADT | `.dsfi.json` |
| `DRTY` | CDS type (simple type) | ✅ `--file` | ✅ | ✅ | ✅ | ADT | `.drty.json` + `.drty.acds` |
| `CLAS` | Class | ✅ | ✅ | ✅ | ✅ | ADT | `.clas.json` + `.clas.abap` + `.clas.{definitions,implementations,macros,testclasses}.abap` |
| `DCLS` | CDS access control | ✅ `--file` | ✅ | ✅ | ✅ | ADT | `.dcls.json` + `.dcls.acds` |
| `DDLA` | CDS annotation definition | ✅ `--file` | ✅ | ✅ | ✅ | ADT | `.ddla.json` + `.ddla.acds` |
| `DDLS` | CDS view | ✅ `--file` | ✅ | ✅ | ✅ | ADT | `.ddls.json` + `.ddls.acds` |
| `DDLX` | CDS metadata extension | ✅ `--file` | ✅ | ✅ | ✅ | ADT | `.ddlx.json` + `.ddlx.acds` |
| `DEVC` | Package | ✅ | ✅ | — | ✅ | ADT | `.devc.json` |
| `DOMA` | Domain | ✅ `--file` | ✅ | ✅ | ✅ | ICF | `.doma.json` (+ `.doma.docu.json`) |
| `DTEL` | Data element | ✅ `--file` | ✅ | ✅ | ✅ | ICF | `.dtel.json` (+ `.dtel.docu.json`) |
| `ENQU` | Lock object | ✅ `--file` | ✅ | ✅ | ✅ `$TMP` | ICF | `.enqu.json` |
| `FUGR` | Function group | ✅ | ✅ | ✅ | ✅ | ADT | `.fugr.json` + `.fugr.<include>.reps.{json,abap}` + `.fugr.<fm>.func.{json,abap}` |
| `HTTP` | SICF service node | ✅ `--file` | ✅ | ✅ | ✅ `$TMP` | ICF | `.http.json` |
| `INTF` | Interface | ✅ | ✅ | ✅ | ✅ | ADT | `.intf.json` + `.intf.abap` |
| `MSAG` | Message class | ✅ `--file` | ✅ | ✅ | ✅ | auto (ADT / ICF) | `.msag.json` |
| `NROB` | Number range object | ✅ `--file` | ✅ | ✅ | ✅ `$TMP` | ICF (pull: ADT / ICF) | `.nrob.json` |
| `PROG` | Program | ✅ | ✅ | ✅ | ✅ | ADT | `.prog.json` + `.prog.abap` (`.prog.include.abap` for include programs) |
| `SHLP` | Search help | ✅ `--file` | ✅ | ✅ | ✅ `$TMP` | ICF | `.shlp.json` |
| `SRVD` | Service definition | ✅ `--file` | ✅ | ✅ | ✅ | ADT | `.srvd.json` + `.srvd.acds` |
| `SRVB` | Service binding | ✅ `--file` | ✅ | — | ✅ | ADT | `.srvb.json` |
| `STRU` | Structure | ✅ `--file` | ✅ | ✅ | ✅ | ICF | `.stru.json` + `.stru.ddic` |
| `TABL` | Transparent table | ✅ `--file` | ✅ | ✅ | ✅ | ICF | `.tabl.json` + `.tabl.ddic` + `.tabl.settings.json` |
| `TRAN` | Transaction code | ✅ `--file` | ✅ | ✅ | ✅ `$TMP` | ICF | `.tran.json` |
| `TTYP` | Table type | ✅ `--file` | ✅ | ✅ | ✅ | auto (ADT / ICF) | `.ttyp.json` (+ `.type.abap`) |
| `VIEW` | Database view | ✅ `--file` | ✅ | ✅ | ✅ `$TMP` | ICF | `.view.json` |
| `XSLT` | Transformation | ✅ `--file` | ✅ | ✅ | ✅ | ICF | `.xslt.json` + `.xslt.xml` |

## Create rules

- Source objects and `DEVC` create from CLI arguments; `create local` drafts `CLAS` / `INTF` / `PROG` / `FUGR` offline, without a SAP connection.
- The remaining creatable types are data-driven: `create` requires `--file` with a JSON document in the type's format (`BDEF` also needs the sibling `.bdef.abdl` source; `SRVB` creates a metadata-only binding and can publish it with `--publish`; `TTYP` / `VIEW` / `SHLP` use the local schemas below). Companion files shown in the same row belong to the same artifact set.
- `abap create --schema <type>` prints the per-type contract, including an example document where one exists.

## Delete rules

- `delete` runs lock → delete → unlock. Packages delete without a lock, and `VIEW` / `SHLP` / `TRAN` / `XSLT` / `HTTP` delete through the ICF service. ATC configuration objects read their package from the ADT resource and require `--tr` outside `$`-prefixed packages, like the other transportable types.
- `ENQU` / `NROB` / `HTTP` delete through ICF for `$`-prefixed local packages only; transportable lock objects, number range objects and SICF nodes must be deleted in SE11 / SNRO / SICF so the removal is recorded in a transport.

## Text elements (`--textpool`)

`abap pull <name> --textpool --type <CLAS|INTF|PROG|FUGR|TABL|STRU>` adds the object's text elements as `<name>.<type>.{texts,selections,headings}.en.properties`; `abap push` of those `.properties` files writes them back. `--type` is required so the pull cannot silently miss CLAS/INTF/FUGR text elements.

- The route is decided per profile from a capability probe: `abap init` records whether the ADT text-element read/write endpoints are reachable. A profile without a recorded capability uses the conservative defaults — read through ADT, write through ICF.
- Both routes read text elements; the ICF read endpoint is part of the bundled service and therefore needs `abap deploy` once per system, the ADT route does not.
- Writing text elements needs the ADT write endpoint. The ICF textpool write endpoint is a stub that always answers `TEXTPOOL_WRITE_UNSUPPORTED`, so on a system whose ADT write probe failed, `abap push <file>.properties` fails with that code (not retryable — maintain the texts in SE38 / SE80 instead).
- The route is fixed per profile for the whole command; there is no runtime fallback between ADT and ICF.
- A category the object does not carry (for example a class without selection texts) is skipped with a `TEXTPOOL_CATEGORY_MISSING` warning instead of failing the pull; real SAP errors are reported per category as `failed` entries.

## Channel routing

- **ADT** — source objects (`CLAS` `INTF` `PROG` `FUGR`), `DEVC`, `TTYP`, `MSAG`, `DDLS`, the CDS / RAP companions (`SRVD` `BDEF` `DCLS` `DDLX` `DDLA`), `SRVB`, the ATC configuration objects (`CHKC` `CHKO` `CHKV`) and the CDS technical objects (`DTDC` `DTEB` `DSFD` `DSFI`). `TTYP` and `MSAG` fall back to ICF automatically on ECC EHP5/6.
- **ICF** — `TABL` `STRU` `DOMA` `DTEL` `ENQU` `VIEW` `SHLP` `HTTP` `TRAN` `XSLT`, plus the write path of `NROB`; these need `abap deploy` once per system (`abap deploy status` checks the installed version).
- `NROB` pulls through ADT with an ICF fallback and writes through ICF. `DDLS` is rejected on ECC releases (`DDLS_NOT_SUPPORTED_ON_ECC`).

## Per-type notes

- `DEVC` — `create` takes `--package` (the super package) and `--description`; there is no `push`, because ADT rejects package updates.
- `TRAN` — dialog, report, parameter and variant transactions; OO transactions stay in SE93.
- `VIEW` / `SHLP` — local-extension schemas (`view-v1.json` / `shlp-v1.json`); upstream AFF defines neither.
- `ENQU` / `NROB` — `create` and `delete` only work in `$`-prefixed local packages (transportable creation/deletion needs a TADIR/transport record). `create` writes the local TADIR row, so the object is discoverable and `delete` does not have to backfill it; ENQU delete then runs `RS_DD_DELETE_OBJ`, NROB delete removes the intervals and calls `NUMBER_RANGE_OBJECT_DELETE`. Delete transported objects in SE11 / SNRO. `NROB` names are the `TNRO-NROBJ` key (CHAR 10): `create` and `delete` reject longer names locally instead of letting SAP truncate them.
- `TTYP` — `lineType.rowType` names either a repository type (data element / structure / table / table type) or a DDIC predefined data type (`CHAR`, `NUMC`, `DEC`, `DATS`, `INT4`, `STRING`, …); a predefined row type keeps its length/decimals in `lineType.rowTypeLength` / `lineType.rowTypeDecimals`. ABAP type codes (`C`, `I`, `P`, …) are not DDIC data type names and are not accepted.
- `TABL` / `STRU` — foreign keys (`@AbapCatalog.foreignKeys` block or a `with foreign key ... check <table>` clause in the DDL sidecar) are not persisted by the bundled ICF service: `create` / `push` reject a payload that carries them (exit 7) instead of dropping the constraints. Maintain foreign keys in SE11 / ADT after the object exists.
- `DOMA` / `DTEL` — long text is an optional companion file (`<name>.<type>.docu.json`, `docu-v1.json`); `lines: []` deletes the remote long text.
- `BDEF` — `create` reads the AFF JSON plus the sibling `.bdef.abdl` source, creates the behavior definition through ADT and activates it; the behavior must target an existing root entity (or a valid unmanaged implementation class). `pull` / `push` / `delete` are also available.
- `DRTY` — CDS type (simple type): the same metadata + `.acds` layout as `DSFD`. Writes are behind SAP's `CDS_SIMPLE_TYPES` user parameter (SU3 → Parameter); without it SAP answers `CDS types are not yet supported`, which the CLI maps to `DRTY_FEATURE_NOT_ENABLED`.
- `DTDC` / `DTEB` / `DSFD` — CDS technical source objects: a header-only AFF metadata document plus an `.acds` sidecar. `create` / `push` write the source and activate (and sync the AFF description through the metadata resource). DTEB activation requires the target view entity to allow buffering (`@AbapCatalog.entityBuffer.definitionAllowed: true`); DSFD writes need SAP's `DD_CDS_DSFD` user parameter enabled (SU3 → Parameter) — without it SAP rejects create/update/delete with a misleading authorization message that the CLI maps to `DSFD_FEATURE_NOT_ENABLED`.
- `DSFI` — CDS scalar function implementation reference: a single AFF JSON document (its ADT `source/main` *is* the JSON). The object name must end with the engine suffix (`_ANA` on this release); the referenced scalar function definition is the name without the suffix and must exist and be active. `sqlEngine` variants are rejected by the ADT layer on this release even though the AFF schema lists them.
- `CHKC` / `CHKO` / `CHKV` — ATC configuration objects: check categories, checks and check variants. `create` / `push` write the versioned ADT XML resource and activate it (`--no-activate` stops after the write); `pull` projects the resource back onto the official AFF document. SAP validates the semantics: a `CHKO`'s implementing class must be registered as an active ATC check, and a `CHKV`'s parameters must match that class. `push` / `delete` outside `$`-prefixed packages need `--tr`.
- `SRVB` — metadata only: `create` reads the AFF binding document, posts the ADT binding, activates it, and `--publish` runs the publish job. There is no `push`/update path (the AFF document omits implementation/published/version details); delete uses the generic ADT path and has been verified on a real system. Publishing may depend on the client's transport settings allowing local publish.
- `HTTP` — SICF nodes can be pulled anywhere but written (`create` / `push` / `delete`) only in `$`-prefixed local packages; `create` / `push` refuse transportable packages and `delete` refuses the root node, nodes with child nodes and transportable services — maintain those in SICF so the change is recorded in a transport. A pulled `.http.json` is strictly AFF-shaped (the object name lives in the file name), so it is reusable as a `push`/`create` template as-is.
- `XSLT` — the `.xslt.json` + `.xslt.xml` pair must exist together; an update replaces the transformation in place and keeps its version history.

## Local schema extensions

Upstream [abap-file-formats](https://github.com/SAP/abap-file-formats) defines none of these schemas; the files are maintained in `src/abap_cli/schema/` and validated by the same AFF validator (`abap validate:aff`):

| Type | Schema | Kind | Derived from | Official AFF |
|---|---|---|---|---|
| `TTYP` | `ttyp-v1.json` | local variant — `keyKind` / `rowTypeLength` / `rowTypeDecimals` are local extensions | ADT table-type model (upstream `type-v1.json` is a type pool, not a table type) | No |
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
| CDS aspect (`DRAS`), dictionary tuning index (`DTIX`), dictionary tuning static cache (`DTSC`) | Not supported on the reference release — official AFF schemas exist, but the S/4HANA release tested exposes no ADT read/write resources for them (no `typestructure` create capability and no discovery collections). Deferred until a release with ADT support. |
| Simple Transformations (`STRANS`) | Not supported — XSLT programs only |
| Package update (`push DEVC`) | Not possible — ADT rejects package updates; change the package in SAP GUI or delete and recreate it |
| OO transactions (`TRAN`) | Not possible — maintain them in SE93 |

Table contents are read-only (`abap select`); customizing is not moved. If a type you need is missing, open an issue on [GitHub](https://github.com/chunrichi/abap-cli/issues).

## See also

- [wiki/object-types.md](../wiki/object-types.md) — per-type deep notes and real-system evidence
- [wiki/coverage-matrix.md](../wiki/coverage-matrix.md) — SAP development task coverage snapshot
- [commands.md](commands.md) — generated command and flag reference
- [architecture.md](architecture.md) — three-layer design and the bundled ICF service
