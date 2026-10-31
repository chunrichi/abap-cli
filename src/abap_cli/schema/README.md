# Vendored AFF schemas

These JSON schemas are vendored from the SAP `abap-file-formats` repository
(https://github.com/SAP/abap-file-formats), commit `5bd63fdecb8b4a03c73b1433a36b779c0c9b1121`.

Every file except `ttyp-v1.json`, `view-v1.json` and `shlp-v1.json` is a byte-for-byte copy of
the upstream schema with the same name. Those three are local extensions:
upstream has no TTYP, view, or search-help schema at this commit, so the files are
handcrafted here and `scripts/sync-aff-schema.sh` never overwrites them.

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
| `ttyp-v1.json` | TTYP | — | **local variant**, handcrafted |
| `view-v1.json` | VIEW | — | **local extension**, handcrafted from DD25V / DD26V / DD27P / DD28J / DD28V |
| `shlp-v1.json` | SHLP | — | **local extension**, handcrafted from DD30V / DD31V / DD32P / DD33V |
| `msag-v1.json` | MSAG | `file-formats/msag/msag-v1.json` | |
| `ddls-v1.json` | DDLS | `file-formats/ddls/ddls-v1.json` | |
| `srvb-v1.json` | SRVB | `file-formats/srvb/srvb-v1.json` | |
| `srvd-v1.json` | SRVD | `file-formats/srvd/srvd-v1.json` | |
| `bdef-v1.json` | BDEF | `file-formats/bdef/bdef-v1.json` | |
| `dcls-v1.json` | DCLS | `file-formats/dcls/dcls-v1.json` | |
| `ddlx-v1.json` | DDLX | `file-formats/ddlx/ddlx-v1.json` | |
| `ddla-v1.json` | DDLA | `file-formats/ddla/ddla-v1.json` | |
| `xslt-v1.json` | XSLT | `file-formats/xslt/xslt-v1.json` | |

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
`/ddic/view` wire document. All three are excluded from the sync script's `FILES`
list; treat them like source code (review edits, add tests).

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
upstream schema per consumed type, `ttyp-v1.json` excluded), refreshes
`LICENSE`, and rewrites the commit reference above. A local mirror avoids the
network clone: `UPSTREAM=/path/to/abap-file-formats bash scripts/sync-aff-schema.sh <sha>`.
