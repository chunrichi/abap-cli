# Security Policy

## Reporting a vulnerability

Please report security issues privately via
[GitHub Security Advisories](https://github.com/chunrichi/abap-cli/security/advisories/new).
Do not open a public issue for credential leaks, auth bypasses, or ICF service
exposure.

## Node.js runtime

`abap-cli` decompresses SAP HTTP responses in-process. Node.js releases before
**22.23.4**, **24.22.1** and **26.12.1** ship a vulnerable Brotli decoder
([CVE-2026-111497](https://nvd.nist.gov/vuln/detail/CVE-2026-111497), "Node2Shell"):
a crafted `Content-Encoding: br` response — from a malicious SAP endpoint or a
network attacker on a plain-HTTP connection — can corrupt the CLI process.
End-of-life lines (18.x, 20.x, 23.x, 25.x) will not receive a fix.

The supported range is `^22.23.4 || ^24.22.1 || >=26.12.1`, declared in
`package.json` `engines.node` and checked by `abap doctor` (`env.node`). Upgrade
the runtime before running the CLI; there is no application-level workaround.
Distribution builds that link a system Brotli library instead of the bundled
one (for example Homebrew's `node@22`, or distro packages) must also upgrade
that library to a fixed release — `process.version` alone does not prove the
decoder is patched.

## Secrets and credentials

- SAP passwords, OAuth client secrets and certificate passphrases live in the
  OS keychain (or an explicitly configured native backend). They must never be
  written to `.abap.json`, `.env`, logs, commits or issues.
- `.env` and `.abap.json` are gitignored; never force-add them.
- `abap profile export` includes passwords only when explicitly requested;
  treat its output as a secret.

## ICF service

`abap deploy` installs an ICF service (`/sap/abap_cli`) into your SAP system.
Deploy only to systems where you are allowed to create SICF nodes and the
service handlers; the service executes read queries and ABAP report/class
execution under the calling user's authorizations.
