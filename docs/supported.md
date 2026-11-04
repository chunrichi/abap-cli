# Supported Object Types

`abap-cli` supports **45 object type codes**. Each type maps to one set of local artifacts written flat under `src/` — official abap-file-format (AFF) documents for most types, repository-local schemas for `TTYP` / `VIEW` / `SHLP` / `JOBD` / `SM59` / `SRFC` / `OA2P` / `AUTH` / `SUSC` / `SUCU` / `SUSO` — and is served by one of two channels:

- **ADT** — the standard ADT REST API: source objects (classes, interfaces, programs, function groups, CDS and RAP sources), packages, table types, message classes and application jobs.
- **ICF** — the bundled service under `/sap/abap_cli`, installed once per system with `abap deploy`: DDIC objects, SICF service nodes, transaction codes, XSLT transformations, SM59 HTTP destinations, UCON RFC services, OAuth 2.0 client profiles, application job definitions, the authorization-object family (`AUTH` / `SUSC` / `SUCU` / `SUSH` / `SUSO`) and the types whose ADT endpoint is missing on older releases.

Local artifacts follow the AFF flat layout `<name>.<type>[.<sub_type>][.<content_type>].<ext>` — there are no type or object subdirectories. `<name>` is the AFF file token (lowercase; `/UI2/CL_JSON` → `(ui2)cl_json`), `{json,abap}` means one file per suffix, and `<group>` / `<fm>` / `<include>` stand for a function group, function module and function-group include (`sapl<group>`, `l<group>top`, …).

## Type × command matrix

45 types support `create`, all 45 support `pull`, 43 have a `push` path and 45 have a `delete` path. In the matrix:

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
| `JOBD` | Application job definition | ✅ `--file` | ✅ | ✅ | ✅ | ICF | `.jobd.json` |
| `MSAG` | Message class | ✅ `--file` | ✅ | ✅ | ✅ | auto (ADT / ICF) | `.msag.json` |
| `NROB` | Number range object | ✅ `--file` | ✅ | ✅ | ✅ `$TMP` | ICF (pull: ADT / ICF) | `.nrob.json` |
| `OA2P` | OAuth 2.0 client profile | ✅ `--file` | ✅ | ✅ | ✅ | ICF | `.oa2p.json` |
| `AUTH` | Authorization field (SU20) | ✅ `--file` | ✅ | ✅ | ✅ | ICF | `.auth.json` |
| `SUSC` | Authorization object class (SU21) | ✅ `--file` | ✅ | ✅ | ✅ | ICF | `.susc.json` |
| `SUCU` | Authorization group (SU21) | ✅ `--file` | ✅ | ✅ | ✅ `$TMP` | ICF | `<group>~<object>.sucu.json` |
| `SUSH` | Authorization default assignment (SU22) | ✅ `--file` (RF only) | ✅ | ✅ | ✅ | ICF | `<name>_<type>.sush.json` |
| `SUSO` | Authorization object (SU21) | ✅ `--file` | ✅ | ✅ | ✅ | ICF | `.suso.json` |
| `AUTH` | Authorization field (SU20) | ✅ `--file` | ✅ | ✅ | ✅ | ICF | `.auth.json` |
| `SUSC` | Authorization object class (SU21) | ✅ `--file` | ✅ | ✅ | ✅ | ICF | `.susc.json` |
| `SUCU` | Authorization group (SU21) | ✅ `--file` | ✅ | ✅ | ✅ `$TMP` | ICF | `<group>~<object>.sucu.json` |
| `SUSH` | Authorization default assignment (SU22) | ✅ `--file` (RF only) | ✅ | ✅ | ✅ | ICF | `<name>_<type>.sush.json` |
| `SUSO` | Authorization object (SU21) | ✅ `--file` | ✅ | ✅ | ✅ | ICF | `.suso.json` |
| `AUTH` | Authorization field (SU20) | ✅ `--file` | ✅ | ✅ | ✅ | ICF | `.auth.json` |
| `SUSC` | Authorization object class (SU21) | ✅ `--file` | ✅ | ✅ | ✅ | ICF | `.susc.json` |
| `SUCU` | Authorization group (SU21) | ✅ `--file` | ✅ | ✅ | ✅ `$TMP` | ICF | `<group>~<object>.sucu.json` |
| `SUSH` | Authorization default assignment (SU22) | ✅ `--file` (RF only) | ✅ | ✅ | ✅ | ICF | `<name>_<type>.sush.json` |
| `SUSO` | Authorization object (SU21) | ✅ `--file` | ✅ | ✅ | ✅ | ICF | `.suso.json` |
| `AUTH` | Authorization field (SU20) | ✅ `--file` | ✅ | ✅ | ✅ | ICF | `.auth.json` |
| `SUSC` | Authorization object class (SU21) | ✅ `--file` | ✅ | ✅ | ✅ | ICF | `.susc.json` |
| `SUCU` | Authorization group (SU21) | ✅ `--file` | ✅ | ✅ | ✅ `$TMP` | ICF | `<group>~<object>.sucu.json` |
| `SUSH` | Authorization default assignment (SU22) | ✅ `--file` (RF only) | ✅ | ✅ | ✅ | ICF | `<name>_<type>.sush.json` |
| `SUSO` | Authorization object (SU21) | ✅ `--file` | ✅ | ✅ | ✅ | ICF | `.suso.json` |
| `AUTH` | Authorization field (SU20) | ✅ `--file` | ✅ | ✅ | ✅ | ICF | `.auth.json` |
| `SUSC` | Authorization object class (SU21) | ✅ `--file` | ✅ | ✅ | ✅ | ICF | `.susc.json` |
| `SUCU` | Authorization group (SU21) | ✅ `--file` | ✅ | ✅ | ✅ `$TMP` | ICF | `<group>~<object>.sucu.json` |
| `SUSH` | Authorization default assignment (SU22) | ✅ `--file` (RF only) | ✅ | ✅ | ✅ | ICF | `<name>_<type>.sush.json` |
| `SUSO` | Authorization object (SU21) | ✅ `--file` | ✅ | ✅ | ✅ | ICF | `.suso.json` |
| `PROG` | Program | ✅ | ✅ | ✅ | ✅ | ADT | `.prog.json` + `.prog.abap` (`.prog.include.abap` for include programs) |
| `SHLP` | Search help | ✅ `--file` | ✅ | ✅ | ✅ `$TMP` | ICF | `.shlp.json` |
| `SM59` | HTTP destination (RFCTYPE `G`) | ✅ `--file` | ✅ | ✅ | ✅ | ICF | `.sm59.json` |
| `SRFC` | UCON RFC service | ✅ `--file` | ✅ | ✅ | ✅ | ICF | `.srfc.json` |
| `SRVD` | Service definition | ✅ `--file` | ✅ | ✅ | ✅ | ADT | `.srvd.json` + `.srvd.acds` |
| `SRVB` | Service binding | ✅ `--file` | ✅ | — | ✅ | ADT | `.srvb.json` |
| `STRU` | Structure | ✅ `--file` | ✅ | ✅ | ✅ | ICF | `.stru.json` + `.stru.ddic` |
| `TABL` | Transparent table | ✅ `--file` | ✅ | ✅ | ✅ | ICF | `.tabl.json` + `.tabl.ddic` + `.tabl.settings.json` |
| `TRAN` | Transaction code | ✅ `--file` | ✅ | ✅ | ✅ `$TMP` | ICF | `.tran.json` |
| `TTYP` | Table type | ✅ `--file` | ✅ | ✅ | ✅ | auto (ADT / ICF) | `.ttyp.json` |
| `TYPE` | Type pool (`TYPE-POOL` / `TYPES`) | ✅ `--file` | ✅ | ✅ | ✅ | ADT | `.type.json` + `.type.abap` |
| `SAJC` | Application job catalog entry | ✅ `--file` | ✅ | ✅ | ✅ | ADT | `.sajc.json` |
| `SAJT` | Application job template | ✅ `--file` | ✅ | ✅ | ✅ | ADT | `.sajt.json` |
| `VIEW` | Database view | ✅ `--file` | ✅ | ✅ | ✅ `$TMP` | ICF | `.view.json` |
| `XSLT` | Transformation | ✅ `--file` | ✅ | ✅ | ✅ | ICF | `.xslt.json` + `.xslt.xml` |

## Create rules

- Source objects and `DEVC` create from CLI arguments; `create local` drafts `CLAS` / `INTF` / `PROG` / `FUGR` offline, without a SAP connection.
- The remaining creatable types are data-driven: `create` requires `--file` with a JSON document in the type's format (`BDEF` also needs the sibling `.bdef.abdl` source; `SRVB` creates a metadata-only binding and can publish it with `--publish`; `TTYP` / `VIEW` / `SHLP` / `AUTH` / `SUSC` / `SUCU` / `SUSO` use the local schemas below; `SUSH` uses the upstream AFF `sush-v1` document). Table types are metadata-only (no ABAP companion); type pools pair `.type.json` with the classic `.type.abap` source. Companion files shown in the same row belong to the same artifact set.
- `SM59` has no package / transport envelope (destinations live in the client-independent system table `RFCDES`): `create` / `push` / `delete` reject an explicit `--package` or `--tr` instead of silently dropping it, and the local file name must be `<name>.sm59.json`.
- The authorization-object family writes save the object in one step (no separate activation), so `--no-activate` is rejected; the description lives in the document (`header.description`) and `--description` is rejected as well. `SUSO` additionally accepts `--regenerate-profiles` (default off) to rebuild the SAP_ALL / SAP_NEW authorization profiles after the write; on the reference system the in-handler regeneration takes roughly 11 s for `create` and 12 s for `delete`.
- The authorization-object family writes save the object in one step (no separate activation), so `--no-activate` is rejected; the description lives in the document (`header.description`) and `--description` is rejected as well. `SUSO` additionally accepts `--regenerate-profiles` (default off) to rebuild the SAP_ALL / SAP_NEW authorization profiles after the write; on the reference system the in-handler regeneration takes roughly 11 s for `create` and 12 s for `delete`.
- The authorization-object family writes save the object in one step (no separate activation), so `--no-activate` is rejected; the description lives in the document (`header.description`) and `--description` is rejected as well. `SUSO` additionally accepts `--regenerate-profiles` (default off) to rebuild the SAP_ALL / SAP_NEW authorization profiles after the write; on the reference system the in-handler regeneration takes roughly 11 s for `create` and 12 s for `delete`.
- The authorization-object family writes save the object in one step (no separate activation), so `--no-activate` is rejected; the description lives in the document (`header.description`) and `--description` is rejected as well. `SUSO` additionally accepts `--regenerate-profiles` (default off) to rebuild the SAP_ALL / SAP_NEW authorization profiles after the write; on the reference system the in-handler regeneration takes roughly 11 s for `create` and 12 s for `delete`.
- The authorization-object family writes save the object in one step (no separate activation), so `--no-activate` is rejected; the description lives in the document (`header.description`) and `--description` is rejected as well. `SUSO` additionally accepts `--regenerate-profiles` (default off) to rebuild the SAP_ALL / SAP_NEW authorization profiles after the write; on the reference system the in-handler regeneration takes roughly 11 s for `create` and 12 s for `delete`.
- `SRFC` / `OA2P` are TADIR objects: `create` requires `--package` and, outside `$`-prefixed local packages, `--tr`; the local file names must be `<name>.srfc.json` / `<name>.oa2p.json`. A pulled document carries no package, so `push` / `delete` read the target's package and apply the same transport rule.
- `abap create --schema <type>` prints the per-type contract, including an example document where one exists.

## Delete rules

- `delete` runs lock → delete → unlock. Packages delete without a lock, and `VIEW` / `SHLP` / `TRAN` / `XSLT` / `HTTP` / `SM59` / `SRFC` / `OA2P` delete through the ICF service. ATC configuration objects read their package from the ADT resource and require `--tr` outside `$`-prefixed packages, like the other transportable types. `OA2P` additionally refuses to delete a profile that is still assigned to OAuth 2.0 clients.
- `SM59` destinations have no package: a delete drops the `RFCDES` / `RFCDOC` rows directly and needs no transport argument.
- `AUTH` / `SUSC` / `SUSH` / `SUSO` delete in any package (`--tr` required outside `$`-prefixed local packages) after SAP's where-used / delivered-object checks; `SUCU` authorization groups can only be deleted in `$`-prefixed local packages (a transportable deletion cannot be recorded from the ICF session — delete them in SU21 / SM30). Any referenced or delivered object is refused with an actionable error and nothing is written.
- `AUTH` / `SUSC` / `SUSH` / `SUSO` delete in any package (`--tr` required outside `$`-prefixed local packages) after SAP's where-used / delivered-object checks; `SUCU` authorization groups can only be deleted in `$`-prefixed local packages (a transportable deletion cannot be recorded from the ICF session — delete them in SU21 / SM30). Any referenced or delivered object is refused with an actionable error and nothing is written.
- `AUTH` / `SUSC` / `SUSH` / `SUSO` delete in any package (`--tr` required outside `$`-prefixed local packages) after SAP's where-used / delivered-object checks; `SUCU` authorization groups can only be deleted in `$`-prefixed local packages (a transportable deletion cannot be recorded from the ICF session — delete them in SU21 / SM30). Any referenced or delivered object is refused with an actionable error and nothing is written.
- `AUTH` / `SUSC` / `SUSH` / `SUSO` delete in any package (`--tr` required outside `$`-prefixed local packages) after SAP's where-used / delivered-object checks; `SUCU` authorization groups can only be deleted in `$`-prefixed local packages (a transportable deletion cannot be recorded from the ICF session — delete them in SU21 / SM30). Any referenced or delivered object is refused with an actionable error and nothing is written.
- `AUTH` / `SUSC` / `SUSH` / `SUSO` delete in any package (`--tr` required outside `$`-prefixed local packages) after SAP's where-used / delivered-object checks; `SUCU` authorization groups can only be deleted in `$`-prefixed local packages (a transportable deletion cannot be recorded from the ICF session — delete them in SU21 / SM30). Any referenced or delivered object is refused with an actionable error and nothing is written.
- `ENQU` / `NROB` / `HTTP` delete through ICF for `$`-prefixed local packages only; transportable lock objects, number range objects and SICF nodes must be deleted in SE11 / SNRO / SICF so the removal is recorded in a transport.

## Text elements (`--textpool`)

`abap pull <name> --textpool --type <CLAS|INTF|PROG|FUGR|TABL|STRU>` adds the object's text elements as `<name>.<type>.{texts,selections,headings}.en.properties`; `abap push` of those `.properties` files writes them back. `--type` is required so the pull cannot silently miss CLAS/INTF/FUGR text elements.

- The route is decided per profile from a capability probe: `abap init` records whether the ADT text-element read/write endpoints are reachable. A profile without a recorded capability uses the conservative defaults — read through ADT, write through ICF.
- Both routes read text elements; the ICF read endpoint is part of the bundled service and therefore needs `abap deploy` once per system, the ADT route does not.
- Writing text elements needs the ADT write endpoint. The ICF textpool write endpoint is a stub that always answers `TEXTPOOL_WRITE_UNSUPPORTED`, so on a system whose ADT write probe failed, `abap push <file>.properties` fails with that code (not retryable — maintain the texts in SE38 / SE80 instead).
- The route is fixed per profile for the whole command; there is no runtime fallback between ADT and ICF.
- A category the object does not carry (for example a class without selection texts) is skipped with a `TEXTPOOL_CATEGORY_MISSING` warning instead of failing the pull; real SAP errors are reported per category as `failed` entries.

## Channel routing

- **ADT** — source objects (`CLAS` `INTF` `PROG` `FUGR`), `DEVC`, `TTYP`, `MSAG`, `DDLS`, `TYPE`, the CDS / RAP companions (`SRVD` `BDEF` `DCLS` `DDLX` `DDLA`), `SRVB`, the ATC configuration objects (`CHKC` `CHKO` `CHKV`), the CDS technical objects (`DTDC` `DTEB` `DSFD` `DSFI`) and application jobs (`SAJC` `SAJT`). `TTYP` and `MSAG` fall back to ICF automatically on ECC EHP5/6.
- **ICF** — `TABL` `STRU` `DOMA` `DTEL` `ENQU` `VIEW` `SHLP` `JOBD` `HTTP` `TRAN` `XSLT` `SM59` `SRFC` `OA2P` and the authorization-object family (`AUTH` `SUSC` `SUCU` `SUSH` `SUSO`), plus the write path of `NROB`; these need `abap deploy` once per system (`abap deploy status` checks the installed version).
- `NROB` pulls through ADT with an ICF fallback and writes through ICF. `DDLS` is rejected on ECC releases (`DDLS_NOT_SUPPORTED_ON_ECC`).

## Per-type notes

- `DEVC` — `create` takes `--package` (the super package) and `--description`; there is no `push`, because ADT rejects package updates.
- `TRAN` — dialog, report, parameter and variant transactions; OO transactions stay in SE93.
- `VIEW` / `SHLP` — local-extension schemas (`view-v1.json` / `shlp-v1.json`); upstream AFF defines neither.
- `ENQU` / `NROB` — `create` and `delete` only work in `$`-prefixed local packages (transportable creation/deletion needs a TADIR/transport record). `create` writes the local TADIR row, so the object is discoverable and `delete` does not have to backfill it; ENQU delete then runs `RS_DD_DELETE_OBJ`, NROB delete removes the intervals and calls `NUMBER_RANGE_OBJECT_DELETE`. Delete transported objects in SE11 / SNRO. `NROB` names are the `TNRO-NROBJ` key (CHAR 10): `create` and `delete` reject longer names locally instead of letting SAP truncate them.
- `TYPE` — type pool (`TYPE-POOL <name>.` / `TYPES …`): AFF header `type-v1.json` plus the classic `.type.abap` source. Type pools are limited to five characters; create writes the source through ADT `/ddic/typegroups` and activates it.
- `JOBD` — application job definition (SM36): no upstream AFF format and no ADT resource, so the CLI defines the local-extension `jobd-v1` document and serves the object through the bundled ICF route `/jobd/<name>`. The document mirrors `CL_JR_JOB_DEFINITION=>TY_JOB_DEFINITION` (STJR_JOBD_ROOT + STJR_JOBD_TREP as serialized by abapGit) minus the server-managed fields; `package` is read-side metadata and travels as a request parameter. Writes save and activate in one step, so `--no-activate` is rejected. `create` / `push` / `delete` record the TADIR entry through `RS_CORR_INSERT` (with the request for transportable packages); the class' own transport path opens a request dialog that a plugin call cannot serve, so the handler persists through `CREATE_JD` / `MODIFY_JD` and patches the stored package/owner afterwards. Names are limited to 32 characters. A transportable delete clears the object data and the TADIR entry but cannot record a CTS deletion entry from the plugin context (the request keeps the object's insert entry; remove it in SE01/SE03 before release) — local packages are unaffected. On releases without `CL_JR_JOB_DEFINITION` the handler answers `JOBD_UNSUPPORTED` (exit 7).

- `SAJC` / `SAJT` — application job family: one official AFF JSON document per object (`<name>.sajc.json` catalog entry, `<name>.sajt.json` template) carried over the ADT `/sap/bc/adt/applicationjob/{catalogs,templates}` blueSource resources. `create` / `push` write the JSON as the object source; the ADT resource saves and activates in one step (no inactive version exists), so `--no-activate` is rejected and `create --check-only` only validates locally. Names are limited to 40 characters (the generic SAP limit is 30). The object's master language follows the session/logon language, so a pull may report the profile language in `header.originalLanguage`. A catalog entry references the class with the execute method (`generalInformation.className`) or a report (`generalInformation.programName`); a template references an existing active catalog entry (`generalInformation.catalogName`). SAP validates those references at save time, and the CLI turns its generic save rejection into a pointer to the referenced object. The local file is the current AFF v1 document; older releases (the reference S/4HANA system serves the flat `className`/`reportName` model) get a translated document, and AFF fields that release cannot store (catalog `sections` / `groups` / `parameters`, template `singleValueParameters`, notification exit class) are rejected with the field names instead of being dropped.
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
- `SRFC` — UCON RFC services: an existing RFC-enabled function module (FMODE `R` / `X` / `K`), the UCON scope (`E` callable from other systems / `O` obsolete / `P` not callable from outside client or system / `S` callable from own system only; empty is omitted), an optional default UCON profile (must exist in `UCONPROFHEAD`) and the short text. The local-extension model is not a full UCON object: communication assemblies and RFC profiles are managed in UCONCOCKPIT. The short text is read and written in the session language only (other language rows are untouched), and an empty description on `create` gets the same default text UCONCOCKPIT generates. A successful write also refreshes the UCON RFC runtime cache so the service is effective without a restart.
- `OA2P` — OAuth 2.0 client profiles: the service provider `type` (must be configured in `OA2C_TYPES`), the scope list and the no-authority-check flag. The profile carries no description field, and the provider-specific object is stateless, so neither is part of the local document. Profiles assigned to OAuth 2.0 clients cannot be deleted (the SAP-side rule); remove the assignments in `OA2C_CONFIG` first. The assignment itself and the `S_OA2C_ADM` authority checks stay in `OA2C_CONFIG`.
- `AUTH` — SU20 authorization field (one `AUTHX` row): `generalInformation.dataElement` (the data element), optional `alternativeSearchHelp.checkTable`, plus the two SU20 fields the upstream AFF `auth-v1` cannot carry (`generalInformation.searchHelpExit`, `generalInformation.activityField`). Names are up to 30 characters and namespaced names use the AFF `(ns)name` token. Deleting a field that roles or authorization objects reference is refused.
- `SUSC` — SU21 authorization object class (one `TOBC` row + one `TOBCT` text row in the original language): `header.description` (≤60) and `header.originalLanguage`. Class names are 1-4 characters (`APO`, `IS-B`, `6VPM`, `/AGG`); the document carries the original-language text only, other languages stay untouched like the abapGit exporter.
- `SUCU` — authorization group (`TBRG_AUTH` + `TBRG_AUTHT`), the composite TADIR key `<authorization group>` + `<authorization object>`. The canonical CLI name is the 40-character padded TADIR name; the command line also accepts the compact `<group>~<object>` form, and the pull filename is `<group>~<object>.sucu.json`. The document carries `header.description` / `header.originalLanguage` plus `generalInformation.authorizationGroup` / `.authorizationObject` and optional `texts[]` for the other languages. The authorization object must exist (SU21 check-table rule); deletes are `$`-local only.
- `SUSH` — SU22 authorization default assignment over `CL_SU22_ADT_OBJECT`: the document is the upstream AFF `sush-v1` model (`applicationName` / `applicationType` / authorization objects and field values). `pull` covers all four key types (`RF` / `TR` / `HT` / `HS`); `create` is limited to `RF` applications because SAP computes the other keys from their leading object; the leading application name cannot be changed by `push`.
- `SUSO` — SU21 authorization object: the local extension `suso-v1` document maps `TOBJ` (authorization fields, object class, field block, conversion), `TOBJT` (short text), `TACTZ` (permitted activities), `TOBJVORFLG` (criticality / copy-to-default-data / CDS classification / SAP_NEW flags), the per-release SAP_NEW values and the DOKU `UO` long text. Names are up to 10 characters, namespaced names keep the `/NS/NAME` shape. Delete is refused for referenced / delivered objects; `--regenerate-profiles` opts into the SAP_ALL / SAP_NEW regeneration (default off; roughly 11-12 s on the reference system).
- `AUTH` — SU20 authorization field (one `AUTHX` row): `generalInformation.dataElement` (the data element), optional `alternativeSearchHelp.checkTable`, plus the two SU20 fields the upstream AFF `auth-v1` cannot carry (`generalInformation.searchHelpExit`, `generalInformation.activityField`). Names are up to 30 characters and namespaced names use the AFF `(ns)name` token. Deleting a field that roles or authorization objects reference is refused.
- `SUSC` — SU21 authorization object class (one `TOBC` row + one `TOBCT` text row in the original language): `header.description` (≤60) and `header.originalLanguage`. Class names are 1-4 characters (`APO`, `IS-B`, `6VPM`, `/AGG`); the document carries the original-language text only, other languages stay untouched like the abapGit exporter.
- `SUCU` — authorization group (`TBRG_AUTH` + `TBRG_AUTHT`), the composite TADIR key `<authorization group>` + `<authorization object>`. The canonical CLI name is the 40-character padded TADIR name; the command line also accepts the compact `<group>~<object>` form, and the pull filename is `<group>~<object>.sucu.json`. The document carries `header.description` / `header.originalLanguage` plus `generalInformation.authorizationGroup` / `.authorizationObject` and optional `texts[]` for the other languages. The authorization object must exist (SU21 check-table rule); deletes are `$`-local only.
- `SUSH` — SU22 authorization default assignment over `CL_SU22_ADT_OBJECT`: the document is the upstream AFF `sush-v1` model (`applicationName` / `applicationType` / authorization objects and field values). `pull` covers all four key types (`RF` / `TR` / `HT` / `HS`); `create` is limited to `RF` applications because SAP computes the other keys from their leading object; the leading application name cannot be changed by `push`.
- `SUSO` — SU21 authorization object: the local extension `suso-v1` document maps `TOBJ` (authorization fields, object class, field block, conversion), `TOBJT` (short text), `TACTZ` (permitted activities), `TOBJVORFLG` (criticality / copy-to-default-data / CDS classification / SAP_NEW flags), the per-release SAP_NEW values and the DOKU `UO` long text. Names are up to 10 characters, namespaced names keep the `/NS/NAME` shape. Delete is refused for referenced / delivered objects; `--regenerate-profiles` opts into the SAP_ALL / SAP_NEW regeneration (default off; roughly 11-12 s on the reference system).
- `AUTH` — SU20 authorization field (one `AUTHX` row): `generalInformation.dataElement` (the data element), optional `alternativeSearchHelp.checkTable`, plus the two SU20 fields the upstream AFF `auth-v1` cannot carry (`generalInformation.searchHelpExit`, `generalInformation.activityField`). Names are up to 30 characters and namespaced names use the AFF `(ns)name` token. Deleting a field that roles or authorization objects reference is refused.
- `SUSC` — SU21 authorization object class (one `TOBC` row + one `TOBCT` text row in the original language): `header.description` (≤60) and `header.originalLanguage`. Class names are 1-4 characters (`APO`, `IS-B`, `6VPM`, `/AGG`); the document carries the original-language text only, other languages stay untouched like the abapGit exporter.
- `SUCU` — authorization group (`TBRG_AUTH` + `TBRG_AUTHT`), the composite TADIR key `<authorization group>` + `<authorization object>`. The canonical CLI name is the 40-character padded TADIR name; the command line also accepts the compact `<group>~<object>` form, and the pull filename is `<group>~<object>.sucu.json`. The document carries `header.description` / `header.originalLanguage` plus `generalInformation.authorizationGroup` / `.authorizationObject` and optional `texts[]` for the other languages. The authorization object must exist (SU21 check-table rule); deletes are `$`-local only.
- `SUSH` — SU22 authorization default assignment over `CL_SU22_ADT_OBJECT`: the document is the upstream AFF `sush-v1` model (`applicationName` / `applicationType` / authorization objects and field values). `pull` covers all four key types (`RF` / `TR` / `HT` / `HS`); `create` is limited to `RF` applications because SAP computes the other keys from their leading object; the leading application name cannot be changed by `push`.
- `SUSO` — SU21 authorization object: the local extension `suso-v1` document maps `TOBJ` (authorization fields, object class, field block, conversion), `TOBJT` (short text), `TACTZ` (permitted activities), `TOBJVORFLG` (criticality / copy-to-default-data / CDS classification / SAP_NEW flags), the per-release SAP_NEW values and the DOKU `UO` long text. Names are up to 10 characters, namespaced names keep the `/NS/NAME` shape. Delete is refused for referenced / delivered objects; `--regenerate-profiles` opts into the SAP_ALL / SAP_NEW regeneration (default off; roughly 11-12 s on the reference system).
- `AUTH` — SU20 authorization field (one `AUTHX` row): `generalInformation.dataElement` (the data element), optional `alternativeSearchHelp.checkTable`, plus the two SU20 fields the upstream AFF `auth-v1` cannot carry (`generalInformation.searchHelpExit`, `generalInformation.activityField`). Names are up to 30 characters and namespaced names use the AFF `(ns)name` token. Deleting a field that roles or authorization objects reference is refused.
- `SUSC` — SU21 authorization object class (one `TOBC` row + one `TOBCT` text row in the original language): `header.description` (≤60) and `header.originalLanguage`. Class names are 1-4 characters (`APO`, `IS-B`, `6VPM`, `/AGG`); the document carries the original-language text only, other languages stay untouched like the abapGit exporter.
- `SUCU` — authorization group (`TBRG_AUTH` + `TBRG_AUTHT`), the composite TADIR key `<authorization group>` + `<authorization object>`. The canonical CLI name is the 40-character padded TADIR name; the command line also accepts the compact `<group>~<object>` form, and the pull filename is `<group>~<object>.sucu.json`. The document carries `header.description` / `header.originalLanguage` plus `generalInformation.authorizationGroup` / `.authorizationObject` and optional `texts[]` for the other languages. The authorization object must exist (SU21 check-table rule); deletes are `$`-local only.
- `SUSH` — SU22 authorization default assignment over `CL_SU22_ADT_OBJECT`: the document is the upstream AFF `sush-v1` model (`applicationName` / `applicationType` / authorization objects and field values). `pull` covers all four key types (`RF` / `TR` / `HT` / `HS`); `create` is limited to `RF` applications because SAP computes the other keys from their leading object; the leading application name cannot be changed by `push`.
- `SUSO` — SU21 authorization object: the local extension `suso-v1` document maps `TOBJ` (authorization fields, object class, field block, conversion), `TOBJT` (short text), `TACTZ` (permitted activities), `TOBJVORFLG` (criticality / copy-to-default-data / CDS classification / SAP_NEW flags), the per-release SAP_NEW values and the DOKU `UO` long text. Names are up to 10 characters, namespaced names keep the `/NS/NAME` shape. Delete is refused for referenced / delivered objects; `--regenerate-profiles` opts into the SAP_ALL / SAP_NEW regeneration (default off; roughly 11-12 s on the reference system).
- `AUTH` — SU20 authorization field (one `AUTHX` row): `generalInformation.dataElement` (the data element), optional `alternativeSearchHelp.checkTable`, plus the two SU20 fields the upstream AFF `auth-v1` cannot carry (`generalInformation.searchHelpExit`, `generalInformation.activityField`). Names are up to 30 characters and namespaced names use the AFF `(ns)name` token. Deleting a field that roles or authorization objects reference is refused.
- `SUSC` — SU21 authorization object class (one `TOBC` row + one `TOBCT` text row in the original language): `header.description` (≤60) and `header.originalLanguage`. Class names are 1-4 characters (`APO`, `IS-B`, `6VPM`, `/AGG`); the document carries the original-language text only, other languages stay untouched like the abapGit exporter.
- `SUCU` — authorization group (`TBRG_AUTH` + `TBRG_AUTHT`), the composite TADIR key `<authorization group>` + `<authorization object>`. The canonical CLI name is the 40-character padded TADIR name; the command line also accepts the compact `<group>~<object>` form, and the pull filename is `<group>~<object>.sucu.json`. The document carries `header.description` / `header.originalLanguage` plus `generalInformation.authorizationGroup` / `.authorizationObject` and optional `texts[]` for the other languages. The authorization object must exist (SU21 check-table rule); deletes are `$`-local only.
- `SUSH` — SU22 authorization default assignment over `CL_SU22_ADT_OBJECT`: the document is the upstream AFF `sush-v1` model (`applicationName` / `applicationType` / authorization objects and field values). `pull` covers all four key types (`RF` / `TR` / `HT` / `HS`); `create` is limited to `RF` applications because SAP computes the other keys from their leading object; the leading application name cannot be changed by `push`.
- `SUSO` — SU21 authorization object: the local extension `suso-v1` document maps `TOBJ` (authorization fields, object class, field block, conversion), `TOBJT` (short text), `TACTZ` (permitted activities), `TOBJVORFLG` (criticality / copy-to-default-data / CDS classification / SAP_NEW flags), the per-release SAP_NEW values and the DOKU `UO` long text. Names are up to 10 characters, namespaced names keep the `/NS/NAME` shape. Delete is refused for referenced / delivered objects; `--regenerate-profiles` opts into the SAP_ALL / SAP_NEW regeneration (default off; roughly 11-12 s on the reference system).
- `SM59` — SM59 HTTP destinations (`RFCTYPE='G'`): target host, port, protocol and path prefix plus the description (≤ 72 chars, `RFCDOC`). `create` needs `--file`, and the file name must be `<name>.sm59.json` (the object name lives in the file name). Create uses the SM59 maintenance-API defaults for options the v1 model does not carry; push loads and keeps the API-known attribute values, but the maintenance API rebuilds `RFCOPTIONS` on save, so legacy option codes on SAP-shipped destinations are dropped. Destinations are client-independent `RFCDES` entries with no package and no CTS path: `--package` / `--tr` are rejected, and the destination must be created per system. Other SM59 destination types (RFC connection `3`, `I`, `T`, `L`, …) are rejected with `SM59_TYPE_NOT_SUPPORTED`.
- `XSLT` — the `.xslt.json` + `.xslt.xml` pair must exist together; an update replaces the transformation in place and keeps its version history.

## Local schema extensions

Upstream [abap-file-formats](https://github.com/SAP/abap-file-formats) defines none of these schemas; the files are maintained in `src/abap_cli/schema/` and validated by the same AFF validator (`abap validate:aff`):

| Type | Schema | Kind | Derived from | Official AFF |
|---|---|---|---|---|
| `TTYP` | `ttyp-v1.json` | local variant — `keyKind` / `rowTypeLength` / `rowTypeDecimals` are local extensions | ADT table-type model (upstream `type-v1.json` is the type pool; table types have no upstream AFF) | No |
| `TYPE` | `type-v1.json` | official upstream AFF type pool schema | ADT `/ddic/typegroups` (`TYPE/DG`) | No |
| `VIEW` | `view-v1.json` | local extension | DD25V / DD26V / DD27P / DD28J / DD28V | No |
| `SHLP` | `shlp-v1.json` | local extension | DD30V / DD31V / DD32P / DD33V | No |
| `JOBD` | `jobd-v1.json` | local extension | `CL_JR_JOB_DEFINITION=>TY_JOB_DEFINITION` (STJR_JOBD_ROOT + STJR_JOBD_TREP) | No |
| `SM59` | `sm59-v1.json` | local extension — the SM59 HTTP destination main screen (`targetHost` / `port` / `protocol` / `pathPrefix` / `description`) | RFCDES (`RFCOPTIONS` / `RFCOPTIONT`) + RFCDOC | No |
| `SRFC` | `srfc-v1.json` | local extension — the UCON RFC service main screen (`functionName` / `scope` / `defaultProfile` / `description`) | UCONRFCSERVHEAD + UCONRFCSERVTEXT | No |
| `OA2P` | `oa2p-v1.json` | local extension — the OAuth 2.0 client profile screen (`type` / `noAuthCheck` / `scopes`) | OA2C_PROFILES + OA2P_SCOPES (+ OA2C_TYPES for the provider type) | No |
| `AUTH` | `auth-v1.json` | local extension of the upstream AFF auth format — adds `searchHelpExit` / `activityField` (SU20 fields AFF cannot carry) | upstream AFF `auth-v1.json` + AUTHX | Partial |
| `SUSC` | `susc-v1.json` | local extension | TOBC / TOBCT (SU21 authorization object class) | No |
| `SUCU` | `sucu-v1.json` | local extension | TBRG_AUTH / TBRG_AUTHT | No |
| `SUSO` | `suso-v1.json` | local extension | TOBJ / TOBJT / TACTZ / TOBJVORFLG / TOBJVORDAT / DOKU `UO` | No |
| `AUTH` | `auth-v1.json` | local extension of the upstream AFF auth format — adds `searchHelpExit` / `activityField` (SU20 fields AFF cannot carry) | upstream AFF `auth-v1.json` + AUTHX | Partial |
| `SUSC` | `susc-v1.json` | local extension | TOBC / TOBCT (SU21 authorization object class) | No |
| `SUCU` | `sucu-v1.json` | local extension | TBRG_AUTH / TBRG_AUTHT | No |
| `SUSO` | `suso-v1.json` | local extension | TOBJ / TOBJT / TACTZ / TOBJVORFLG / TOBJVORDAT / DOKU `UO` | No |
| `AUTH` | `auth-v1.json` | local extension of the upstream AFF auth format — adds `searchHelpExit` / `activityField` (SU20 fields AFF cannot carry) | upstream AFF `auth-v1.json` + AUTHX | Partial |
| `SUSC` | `susc-v1.json` | local extension | TOBC / TOBCT (SU21 authorization object class) | No |
| `SUCU` | `sucu-v1.json` | local extension | TBRG_AUTH / TBRG_AUTHT | No |
| `SUSO` | `suso-v1.json` | local extension | TOBJ / TOBJT / TACTZ / TOBJVORFLG / TOBJVORDAT / DOKU `UO` | No |
| `AUTH` | `auth-v1.json` | local extension of the upstream AFF auth format — adds `searchHelpExit` / `activityField` (SU20 fields AFF cannot carry) | upstream AFF `auth-v1.json` + AUTHX | Partial |
| `SUSC` | `susc-v1.json` | local extension | TOBC / TOBCT (SU21 authorization object class) | No |
| `SUCU` | `sucu-v1.json` | local extension | TBRG_AUTH / TBRG_AUTHT | No |
| `SUSO` | `suso-v1.json` | local extension | TOBJ / TOBJT / TACTZ / TOBJVORFLG / TOBJVORDAT / DOKU `UO` | No |
| `AUTH` | `auth-v1.json` | local extension of the upstream AFF auth format — adds `searchHelpExit` / `activityField` (SU20 fields AFF cannot carry) | upstream AFF `auth-v1.json` + AUTHX | Partial |
| `SUSC` | `susc-v1.json` | local extension | TOBC / TOBCT (SU21 authorization object class) | No |
| `SUCU` | `sucu-v1.json` | local extension | TBRG_AUTH / TBRG_AUTHT | No |
| `SUSO` | `suso-v1.json` | local extension | TOBJ / TOBJT / TACTZ / TOBJVORFLG / TOBJVORDAT / DOKU `UO` | No |

`SAJC` / `SAJT` vendor the official upstream AFF schemas, but the reference release serves the older flat JSON model; the CLI keeps the AFF document local and translates at the ADT boundary (see the per-type notes above).

All three keep the AFF conventions (`formatVersion` + `header`, flat `<name>.<type>.json` names) and round-trip through the CLI; treat schema changes like source-code changes. Sources and upgrade notes: [src/abap_cli/schema/README.md](../src/abap_cli/schema/README.md).

## Not supported

| Object type | Status |
|---|---|
| `PINF` package interfaces, `SCP1` BC sets, Fiori launchpad (`UIAD` / `UIST` / `UIPG`), non-HTTP SM59 destinations, the UCON HTTP service | Not supported on the reference release — abapGit serializes them, but this CLI has no AFF or ADT channel for them yet; tracked for a future release. `SM59` itself covers HTTP destinations (`RFCTYPE='G'`) only, and UCON RFC services / OAuth 2.0 profiles are covered by `SRFC` / `OA2P`. |
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
