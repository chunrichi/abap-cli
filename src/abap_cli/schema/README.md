# Vendored AFF schemas

These JSON files are vendored from the SAP `abap-file-formats` repository
(https://github.com/SAP/abap-file-formats), commit `197f37a54113fff30bb1e6b12c49d63492c24be1`.

The set is intentionally minimal — only the schemas the abap-cli codebase
actually consumes via `routeAffSchema()` in `src/abap_cli/aff/router.ts`:

| File | Type | Used by |
| --- | --- | --- |
| `clas-v1.json` | CLAS | `validate:aff *.clas.json`, companion check |
| `intf-v1.json` | INTF | `validate:aff *.intf.json` |
| `prog-v1.json` | PROG | `validate:aff *.prog.json` |
| `fugr-v1.json` | FUGR | `validate:aff *.fugr.json`, companion check |
| `tabl-v1.json` | TABL | `validate:aff *.tabl.json`, STRU alias |
| `tabt-v1.json` | TABL | `validate:aff *.tabl.settings.json`, STRU settings alias |
| `doma-v1.json` | DOMA | `validate:aff *.doma.json` |
| `dtel-v1.json` | DTEL | `validate:aff *.dtel.json` |
| `http-v1.json` | HTTP | `validate:aff *.http.json` |
| `tran-v1.json` | TRAN | `validate:aff *.tran.json` |

## License

Upstream is MIT licensed (see `LICENSE`). The upstream copyright notice must
be retained per the MIT terms.

## Upgrade

Run `node scripts/sync-aff-schema.mjs <new-sha>` (or omit the SHA to pull
the latest `main`). The script reads the type list from `router.ts`,
copies only the schemas we consume, and rewrites the commit reference in
this README.
