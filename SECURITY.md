# Security Policy

## Reporting a vulnerability

Please report security issues privately via
[GitHub Security Advisories](https://github.com/chunrichi/abap-cli/security/advisories/new).
Do not open a public issue for credential leaks, auth bypasses, or ICF service
exposure.

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
