import { categoryFor } from './exit-codes.js';
import type { ErrorCategory } from './error-codes.js';

/**
 * Return the markdown block attached via `addHelpText('after', ...)` on every
 * command. The exit-code table mirrors `EXIT_CODES` — if you add or rename a
 * category, update both places.
 */
export function commonErrorsAfter(): string {
  return [
    '',
    'Common errors and how to fix them:',
    '',
    '  TLS_ERROR          self-signed / untrusted cert →  abap profile set <name> --ca <pem>',
    '                                                  or   abap profile set <name> --insecure',
    '  AUTH_ERROR         401/403 (password expired)  →  abap profile set <name> --password <new>',
    '  NOT_FOUND          OBJECT_NOT_FOUND            →  abap search <query>',
    '  LOCKED             LOCK_FAILED                 →  abap push <file> (auto-retries)   or   release in SE03',
    '  NO_TRANSPORT       no modifiable transport     →  abap push <file> --tr NDK123456',
    '  OVERWRITE_REQUIRED pull refuses to overwrite   →  abap pull <obj> --overwrite',
    '                                                  015-abap-run:',
    '  METHOD_NOT_SUPPORTED method uses CHANGING/TABLES →  use `abap run <class>` (classrun) instead of --method',
    '  METHOD_FAILED        target method raised cx_root →  abap inspect <class> for signature',
    '  CLASS_NOT_RUNNABLE    class lacks if_oo_adt_classrun→  abap pull <class> to verify',
    '  OBJECT_NOT_ACTIVE     class is inactive           →  abap activate <class>',
    '  WRAPPER_NOT_DEPLOYED  ZCL_ABAP_VIBE_RUNNER missing→  abap extension deploy',
    '  LOCAL_CLASS_NOT_RUNNABLE local class (<a>~<b>)   →  abap run must target a global class',
    '  TIMEOUT               classrun exceeded --timeout →  increase --timeout or check SM51',
    '',
    'Exit codes:',
    '  2 usage            commander parse error, or a USAGE error thrown by the command',
    '  3 config_error     missing/invalid .abap.json or system profile',
    '  4 tls_error        TLS handshake / certificate failure',
    '  5 auth_error       401/403, password expired or missing',
    '  6 sap_error        generic ADT/RFC failure',
    '  7 validation_error invalid input combination (e.g. params + --non-interactive)',
    '  8 not_found        object, profile, or transport not found',
    '  9 locked           target object is locked by another user',
    '',
  ].join('\n');
}

/** Inverse helper used by the contract for back-references. */
export function categoryForExitCode(code: number): ErrorCategory | undefined {
  return categoryFor(code);
}