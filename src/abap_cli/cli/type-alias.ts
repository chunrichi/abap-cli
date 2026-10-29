/**
 * User-input type normalization.
 *
 * - Case-insensitive (`sicf` / `Sicf` both accepted) and uppercased.
 * - Preserves ADT subtype suffixes (e.g. `PROG/I` → `PROG/I`).
 */

export interface NormalizedType {
  /** Canonical type code (uppercase, e.g. "HTTP"). */
  type: string;
}

/** Normalize a user-provided type string. */
export function normalizeTypeInput(raw: string): NormalizedType {
  const trimmed = raw.trim();
  return { type: trimmed.toUpperCase() };
}
