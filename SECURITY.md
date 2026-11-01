# Security Policy

## Reporting a vulnerability

Please report security issues privately via
[GitHub Security Advisories](https://github.com/chunrichi/abap-cli/security/advisories/new).
Do not open a public issue for credential leaks, auth bypasses, or ICF service
exposure.

## Node.js runtime

`abap-cli` requires **Node.js 24 LTS** (`^24.22.1`). The CLI decompresses SAP
HTTP responses in-process. Node.js releases before **24.22.1** ship a vulnerable
Brotli decoder
([CVE-2026-111497](https://nvd.nist.gov/vuln/detail/CVE-2026-111497), "Node2Shell"):
a crafted `Content-Encoding: br` response — from a malicious SAP endpoint or a
network attacker on a plain-HTTP connection — can corrupt the CLI process.
Node 22 is in maintenance and no longer supported by `abap-cli`; other lines
(18.x, 20.x, 23.x, 25.x, 26.x and newer) are outside the support matrix.

The supported range is `^24.22.1`, declared in
`package.json` `engines.node` and checked by `abap doctor` (`env.node`). Upgrade
the runtime before running the CLI; there is no application-level workaround.
Distribution builds that link a system Brotli library instead of the bundled
one (for example Homebrew's `node@24`, or distro packages) must also upgrade
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
