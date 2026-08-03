import { EXIT_CODES, categoryFor } from './exit-codes.js';
import type { ErrorCategory } from './error-codes.js';

/**
 * Return the markdown block attached via `addHelpText('after', ...)` on every
 * command. The exit-code table is generated from the same source of truth
 * (EXIT_CODES) so docs and code can't drift.
 */
export function commonErrorsAfter(): string {
  const rows: string[] = [];
  const order: ErrorCategory[] = [
    'USAGE',
    'CONFIG_ERROR',
    'TLS_ERROR',
    'AUTH_ERROR',
    'SAP_ERROR',
    'VALIDATION_ERROR',
    'NOT_FOUND',
    'LOCKED',
  ];
  for (const cat of order) {
    const code = EXIT_CODES[cat];
    rows.push(`  ${code} ${cat.toLowerCase()}`);
  }
  return [
    '',
    'Common errors and how to fix them:',
    '',
    '  TLS_ERROR      self-signed / untrusted cert →  abap system set <name> --ca <pem>',
    '                                            or   abap system set <name> --insecure',
    '  AUTH_ERROR     401/403 (password expired)  →  abap system set <name> --password <new>',
    '  NOT_FOUND      OBJECT_NOT_FOUND            →  abap search <query>',
    '  LOCKED         LOCK_FAILED                 →  release the lock in SE03 or retry later',
    '  NO_TRANSPORT   no modifiable transport     →  abap push <file> --tr NDK123456',
    '  OVERWRITE_REQUIRED pull refuses to overwrite →  abap pull <obj> --overwrite',
    '',
    'Exit codes:',
    ...rows,
    '',
  ].join('\n');
}

/** Inverse helper used by the contract for back-references. */
export function categoryForExitCode(code: number): ErrorCategory | undefined {
  return categoryFor(code);
}