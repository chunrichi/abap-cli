/**
 * User-input type normalization with alias support.
 *
 * Maps deprecated / alternative type codes to the canonical type:
 *   - "SICF" → "HTTP" (the SICF transaction name; HTTP is the canonical code)
 *
 * The CLI surface accepts both for backwards compatibility, but `meta.warnings`
 * carries the deprecation message so callers learn the canonical form.
 */

export interface NormalizedType {
  /** Canonical type code (uppercase, e.g. "HTTP"). */
  type: string;
  /** Optional deprecation warning string when an alias was applied. */
  aliasWarning?: string;
}

/** Type-code alias table; values are the canonical type. */
const TYPE_ALIASES: Record<string, { canonical: string; deprecation: string }> = {
  SICF: {
    canonical: 'HTTP',
    deprecation: '--type SICF is deprecated; use --type HTTP',
  },
};

/**
 * Normalize a user-provided type string.
 *
 * - Case-insensitive (`sicf` / `Sicf` both accepted).
 * - Preserves ADT subtype suffixes (e.g. `PROG/I` → `PROG/I`).
 * - Returns `aliasWarning` when an alias mapping was applied; callers should
 *   surface this via `meta.warnings[]` on the JSON envelope.
 */
export function normalizeTypeInput(raw: string): NormalizedType {
  const trimmed = raw.trim();
  const upper = trimmed.toUpperCase();
  const primary = upper.split('/')[0]!;
  const alias = TYPE_ALIASES[primary];
  if (!alias) return { type: upper };
  const canonicalWithSubtype = alias.canonical + upper.substring(primary.length);
  return { type: canonicalWithSubtype, aliasWarning: alias.deprecation };
}
