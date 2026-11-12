# Vendored AFF schemas

These JSON schemas are vendored from the SAP `abap-file-formats` repository
(https://github.com/SAP/abap-file-formats), commit `5bd63fdecb8b4a03c73b1433a36b779c0c9b1121`.

Every file except `ttyp-v1.json`, `view-v1.json`, `shlp-v1.json`, `jobd-v1.json`,
`sm59-v1.json`, `srfc-v1.json`, `oa2p-v1.json`, `auth-v1.json`, `susc-v1.json`,
`sucu-v1.json` and `suso-v1.json` is a byte-for-byte copy of the upstream schema
with the same name. Those eleven are local extensions or local variants: the
pinned upstream commit has no TTYP, view, search-help, application job
definition, SM59-destination, UCON RFC service, OAuth 2.0 client profile or
authorization-family documents that fit the objects abap-cli manages, so the
files are handcrafted here and `scripts/sync-aff-schema.sh` never overwrites
them.

One exception to the pinned commit: `sush-v1.json` (authorization defaults,
SU22) was vendored from upstream `6c21748fa4b806d1002c88cc268f4ca2f6633474`,
because the authorization formats were added upstream after the pinned commit.
A future full sync re-vendors it together with the other upstream schemas.

The set is intentionally minimal — only the schemas abap-cli resolves through
`schemaPathFor()` in `src/abap_cli/aff/schema-paths.ts` (the map behind
`routeAffSchema()` in `src/abap_cli/aff/router.ts`):

| Local file | Type | Upstream path | Notes |
| --- | --- | --- | --- |
| `clas-v1.json` | CLAS | `file-formats/clas/clas-v1.json` | |
| `intf-v1.json` | INTF | `file-formats/intf/intf-v1.json` | |
| `prog-v1.json` | PROG | `file-formats/prog/prog-v1.json` | |
| `fugr-v1.json` | FUGR | `file-formats/fugr/fugr-v1.json` | |
| `reps-v1.json` | REPS | `file-formats/fugr/reps-v1.json` | FUGR include (`.reps.json`) |
| `func-v1.json` | FUNC | `file-formats/fugr/func-v1.json` | FUGR include (`.func.json`) |
| `tabl-v1.json` | TABL / STRU | `file-formats/tabl/tabl-v1.json` | STRU reuses the TABL schema |
| `tabt-v1.json` | TABT | `file-formats/tabl/tabt-v1.json` | `.tabl.settings.json` / `.stru.settings.json` |
| `doma-v1.json` | DOMA | `file-formats/doma/doma-v1.json` | |
| `dtel-v1.json` | DTEL | `file-formats/dtel/dtel-v1.json` | |
| `docu-v1.json` | — (companion) | `file-formats/docu-v1.json` | long-text companion `.doma.docu.json` / `.dtel.docu.json`; not an object type |
| `enqu-v1.json` | ENQU | `file-formats/enqu/enqu-v1.json` | |
| `nrob-v1.json` | NROB | `file-formats/nrob/nrob-v1.json` | |
| `devc-v1.json` | DEVC | `file-formats/devc/devc-v1.json` | |
| `http-v1.json` | HTTP | `file-formats/http/http-v1.json` | |
| `tran-v1.json` | TRAN | `file-formats/tran/tran-v1.json` | |
| `sm59-v1.json` | SM59 | — | **local extension**, handcrafted from the SM59 HTTP connection properties (RFCDES / RFCOPTIONS / RFCDOC); no upstream AFF format, no TADIR object, not transportable |
| `srfc-v1.json` | SRFC | — | **local extension**, handcrafted from the UCON RFC service attributes (UCONRFCSERVHEAD / UCONRFCSERVTEXT); no upstream AFF format |
| `oa2p-v1.json` | OA2P | — | **local extension**, handcrafted from the OAuth 2.0 client profile data model (OA2C_PROFILES / OA2P_SCOPES / OA2C_TYPES); no upstream AFF format |
| `ucon_http-v1.json` | UCON_HTTP | — | **local extension**, handcrafted from the UCON HTTP service data model (UCONHTTPSERVHEAD / UCONHTTPSERVTEXT / UCONHTTPSERVHANDL plus the optional ICF node link); no upstream AFF format |
| `ttyp-v1.json` | TTYP | — | **local variant**, handcrafted (`keyKind`, `rowTypeLength`, `rowTypeDecimals` are local extensions) |
| `view-v1.json` | VIEW | — | **local extension**, handcrafted from DD25V / DD26V / DD27P / DD28J / DD28V |
| `shlp-v1.json` | SHLP | — | **local extension**, handcrafted from DD30V / DD31V / DD32P / DD33V |
| `jobd-v1.json` | JOBD | — | **local extension**, handcrafted from `CL_JR_JOB_DEFINITION=>TY_JOB_DEFINITION` / STJR_JOBD_ROOT + STJR_JOBD_TREP (no upstream AFF format, no ADT resource) |
| `msag-v1.json` | MSAG | `file-formats/msag/msag-v1.json` | |
| `ddls-v1.json` | DDLS | `file-formats/ddls/ddls-v1.json` | |
| `srvb-v1.json` | SRVB | `file-formats/srvb/srvb-v1.json` | |
| `srvd-v1.json` | SRVD | `file-formats/srvd/srvd-v1.json` | |
| `bdef-v1.json` | BDEF | `file-formats/bdef/bdef-v1.json` | |
| `dcls-v1.json` | DCLS | `file-formats/dcls/dcls-v1.json` | |
| `ddlx-v1.json` | DDLX | `file-formats/ddlx/ddlx-v1.json` | |
| `ddla-v1.json` | DDLA | `file-formats/ddla/ddla-v1.json` | |
| `chkc-v1.json` | CHKC | `file-formats/chkc/chkc-v1.json` | |
| `chko-v1.json` | CHKO | `file-formats/chko/chko-v1.json` | |
| `chkv-v1.json` | CHKV | `file-formats/chkv/chkv-v1.json` | |
| `dtdc-v1.json` | DTDC | `file-formats/dtdc/dtdc-v1.json` | |
| `dteb-v1.json` | DTEB | `file-formats/dteb/dteb-v1.json` | |
| `dsfd-v1.json` | DSFD | `file-formats/dsfd/dsfd-v1.json` | |
| `dsfi-v1.json` | DSFI | `file-formats/dsfi/dsfi-v1.json` | |
| `drty-v1.json` | DRTY | `file-formats/drty/drty-v1.json` | |
| `type-v1.json` | TYPE | `file-formats/type/type-v1.json` | |
| `sajc-v1.json` | SAJC | `file-formats/sajc/sajc-v1.json` | application job catalog entry |
| `sajt-v1.json` | SAJT | `file-formats/sajt/sajt-v1.json` | application job template |
| `sush-v1.json` | SUSH | `file-formats/sush/sush-v1.json` | authorization defaults (SU22); vendored from the later commit above |
| `auth-v1.json` | AUTH | `file-formats/auth/auth-v1.json` | **local variant**, keeps the upstream property names and adds `generalInformation.searchHelpExit` / `activityField` (AUTHX fields AFF does not model) |
| `susc-v1.json` | SUSC | — | **local extension**, handcrafted from TOBC / TOBCT (no upstream SUSC format) |
| `sucu-v1.json` | SUCU | — | **local extension**, handcrafted from TBRG_AUTH / TBRG_AUTHT (no upstream SUCU format) |
| `suso-v1.json` | SUSO | — | **local extension**, handcrafted from TOBJ / TOBJT / TACTZ / TOBJVOR* / TOBJ_ATTR / DOKU (upstream `suso-v1.json` is a lossy logical model: no long text, no SAP_NEW values, no FBLOCK/CONVERSION) |
| `aplo-v1.json` | APLO | `file-formats/aplo/aplo-v1.json` | application log object |
| `chdo-v1.json` | CHDO | `file-formats/chdo/chdo-v1.json` @ `d371351` | **reference-release variant** — the reference release emits the pre-2022-10 CHDO document (`generatedObject` at the root, `databaseInsertions`/`databaseDeletions` flags on table entries); upstream main renamed those fields, so the sync script deliberately keeps this file pinned |
| `evtb-v1.json` | EVTB | `file-formats/evtb/evtb-v1.json` | event binding |
| `smbc-v1.json` | SMBC | `file-formats/smbc/smbc-v1.json` | business configuration maintenance object |
| `enho-v1.json` | ENHO | `file-formats/enho/enho-v1.json` @ `aa640dd` | **reference-release variant** — the reference release emits the pre-2026-06 ENHO document (`enhancementSpot`/`referencedObjects` at the root); upstream main changed the BAdI implementation layout, so the sync script deliberately keeps this file pinned |
| `enhs-v1.json` | ENHS | `file-formats/enhs/enhs-v1.json` | enhancement spot (BAdI definitions only) |
| `xslt-v1.json` | XSLT | `file-formats/xslt/xslt-v1.json` | |
| `aplo-v1.json` | APLO | `file-formats/aplo/aplo-v1.json` | application log object |
| `chdo-v1.json` | CHDO | `file-formats/chdo/chdo-v1.json` | change document object |
| `evtb-v1.json` | EVTB | `file-formats/evtb/evtb-v1.json` | event binding |
| `smbc-v1.json` | SMBC | `file-formats/smbc/smbc-v1.json` | business configuration maintenance object type |
| `enho-v1.json` | ENHO | `file-formats/enho/enho-v1.json` | enhancement implementation (BAdI implementations only) |
| `enhs-v1.json` | ENHS | `file-formats/enhs/enhs-v1.json` | enhancement spot (BAdI definitions only) |

`docu-v1.json` is a **companion** schema, not an object type: it validates the
0..1 long-text files `<name>.doma.docu.json` / `<name>.dtel.docu.json` that sit
next to a DOMA/DTEL main document. `abap create` / `abap types` never list it,
and DOMA/DTEL main files are still validated against their own schemas.

## Local deviations

`ttyp-v1.json` stays a local variant until upstream publishes a TTYP schema.
`view-v1.json` / `shlp-v1.json` are local extensions because upstream
abap-file-formats has no DDIC view or search-help format; its field names and value ranges are derived from the DDIC
maintenance structures (`DD25V` header, `DD26V` tables, `DD27P` fields, `DD28J`
join conditions, `DD28V` selection conditions) and mirrored by the ICF
`/ddic/view` wire document. `sm59-v1.json` is a local extension for the SM59
HTTP destination (RFCTYPE='G'), whose definition is encoded in the
`RFCDES`/`RFCOPTIONS` system-table fields; its ICF wire document is
`/sm59/<name>`. `srfc-v1.json` / `oa2p-v1.json` / `ucon_http-v1.json` are local
extensions for the UCON RFC service, OAuth 2.0 client profile and UCON HTTP
service types (`/srfc/<name>`, `/oa2p/<name>`, `/ucon_http/<name>`). All seven
are excluded from the sync script's `FILES` list; treat them like source code
(review edits, add tests).

The authorization-object family keeps the same rule: `auth-v1.json` is a local
variant of the upstream schema (two AUTHX fields are missing upstream),
`susc-v1.json` / `sucu-v1.json` / `suso-v1.json` are local extensions (no
upstream format, or a lossy upstream model), and `sush-v1.json` is the upstream
format reused as-is. The ICF handlers in `abap/src/zcl_abap_vibe_icf_{auth,
susc,sucu,sush,suso}.clas.abap` are the wire contract for these documents.
`chdo-v1.json` and `enho-v1.json` are pinned to older upstream commits
(`d371351`, `aa640dd`) because the reference release implements the older v1
document for those two types: `pull` must validate what the system actually
serializes, and the sync script would otherwise reintroduce the evolved upstream
schema and reject round-trip documents. Both are excluded from the `FILES`
list above; bump the pins only together with a reference release that serves the
newer format.

`nrob-v1.json` used to be a hand-edited copy that added
`header.originalLanguage` `maxLength`/`pattern` constraints and
`interval.percentWarning` `multipleOf: 0.1`, on top of older description text
that upstream later corrected. No test exercised those extra constraints and
nothing in the CLI depended on them, while the NROB read path validates
documents the SAP system itself serves (ADT `numberranges/objects` source, AFF
`nrob-v1.json`) — a stricter local schema could reject upstream-valid
documents. The file is now the upstream copy again.

## License

Upstream is MIT licensed (see `LICENSE`). The upstream copyright notice must
be retained per the MIT terms.

## Upgrade

Run `bash scripts/sync-aff-schema.sh <new-sha>` (or omit the SHA to pull the
latest `main`). The script clones upstream, copies the `FILES` list (one
upstream schema per consumed type; the local extensions listed above are
excluded), refreshes `LICENSE`, and rewrites the commit reference above. A full
sync also re-vendors `sush-v1.json` and makes the "later commit" note obsolete.
A local mirror avoids the network clone:
`UPSTREAM=/path/to/abap-file-formats bash scripts/sync-aff-schema.sh <sha>`.
