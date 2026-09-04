import type { ErrorCategory } from './error-codes.js';

/**
 * Sequential exit codes (0–9). 0 = success, 1 = unknown fallback, 2–9 = categories.
 * Stability contract: existing values NEVER change across versions; new categories
 * only occupy the reserved range (≥10) or are added via an explicit extension.
 * The mapping lives here so changes do not touch call sites.
 */
export const EXIT_CODES: Record<ErrorCategory, number> = {
  UNKNOWN: 1,
  USAGE: 2,
  CONFIG_ERROR: 3,
  TLS_ERROR: 4,
  AUTH_ERROR: 5,
  SAP_ERROR: 6,
  VALIDATION_ERROR: 7,
  NOT_FOUND: 8,
  LOCKED: 9,
  // 036-ttyp-msag-ddls: reserved-range slots. These explicit values are part
  // of the public contract so agents / CI greppers can identify the failure
  // shape unambiguously without diffing envelope data.
  DDLS_NOT_SUPPORTED: 64,
  CHANNEL_DETECT: 65,
};

/** Exit code 1 — unknown / unmapped failure (same value as EXIT_CODES.UNKNOWN). */
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