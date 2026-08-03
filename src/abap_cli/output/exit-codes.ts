import type { ErrorCategory } from './error-codes.js';

/**
 * Sequential exit codes (2–9). 0 = success, 1 = generic fallback.
 * Per [research §2](../../../../specs/008-cli-foundation/research.md#2-categorised-exit-codes-fr-003)
 * the mapping lives here so changes do not touch call sites.
 */
export const EXIT_CODES: Record<ErrorCategory, number> = {
  USAGE: 2,
  CONFIG_ERROR: 3,
  TLS_ERROR: 4,
  AUTH_ERROR: 5,
  SAP_ERROR: 6,
  VALIDATION_ERROR: 7,
  NOT_FOUND: 8,
  LOCKED: 9,
};

/** Exit code 1 is reserved for the unknown / unmapped failure case. */
export const EXIT_GENERIC_FALLBACK = 1;
/** Exit code 0 is the success case. */
export const EXIT_SUCCESS = 0;

const CATEGORY_BY_EXIT_CODE: Map<number, ErrorCategory> = new Map(
  Object.entries(EXIT_CODES).map(([cat, code]) => [code, cat as ErrorCategory]),
);

export function exitCodeFor(category: ErrorCategory): number {
  return EXIT_CODES[category];
}

export function categoryFor(exitCode: number): ErrorCategory | undefined {
  return CATEGORY_BY_EXIT_CODE.get(exitCode);
}