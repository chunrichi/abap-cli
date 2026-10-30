/**
 * Supported Node.js runtime range.
 *
 * The CLI decompresses SAP HTTP responses in-process (axios auto-decodes a
 * `Content-Encoding: br` response), so a vulnerable Node.js Brotli decoder can
 * be corrupted by a crafted response. The floor therefore tracks the Node.js
 * security releases of 2026-10-21 rather than an API-compatibility minimum:
 * every line below is exposed to the Brotli decoder out-of-bounds write, and
 * end-of-life lines (18.x, 20.x, 23.x, 25.x) will not receive a fix.
 *
 * Keep this string identical to `engines.node` in package.json — a unit test
 * enforces the pair.
 */
export const SUPPORTED_NODE_RANGE = '^22.23.4 || ^24.22.1 || >=26.12.1';

type Version = [number, number, number];

function parseVersion(value: string): Version | undefined {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(value.trim());
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

function compare(a: Version, b: Version): number {
  const [aMajor, aMinor, aPatch] = a;
  const [bMajor, bMinor, bPatch] = b;
  if (aMajor !== bMajor) return aMajor - bMajor;
  if (aMinor !== bMinor) return aMinor - bMinor;
  return aPatch - bPatch;
}

/** One comparator (`^1.2.3`, `>=1.2.3`, ...); unknown syntax fails open. */
function satisfiesComparator(version: Version, comparator: string): boolean {
  const match = /^(\^|~|>=|<=|>|<|=)?\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(comparator.trim());
  if (!match) return true;
  const base: Version = [Number(match[2]), Number(match[3] ?? 0), Number(match[4] ?? 0)];
  const result = compare(version, base);
  switch (match[1] ?? '=') {
    case '>=':
      return result >= 0;
    case '>':
      return result > 0;
    case '<=':
      return result <= 0;
    case '<':
      return result < 0;
    case '=':
      return result === 0;
    case '~':
      return result >= 0 && version[0] === base[0] && version[1] === base[1];
    case '^':
      // Only majors >= 1 are supported here, so `^` means "same major, at least".
      return result >= 0 && version[0] === base[0];
    default:
      return true;
  }
}

/**
 * Whether `version` satisfies `range` — `a || b` alternatives, each a set of
 * space-separated comparators. Unparseable input fails open: doctor must never
 * invent a failure it cannot explain.
 */
export function nodeSatisfies(version: string, range: string = SUPPORTED_NODE_RANGE): boolean {
  const parsed = parseVersion(version);
  if (!parsed) return true;
  return range
    .split('||')
    .map((alternative) => alternative.trim().split(/\s+/).filter(Boolean))
    .some((comparators) => comparators.every((comparator) => satisfiesComparator(parsed, comparator)));
}
