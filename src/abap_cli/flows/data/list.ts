/**
 * `abap list` flow coordinator.
 *
 * Read-only enumeration of ABAP objects in a package. Backed by ADT's
 * `quickSearch` with a `*` wildcard (the documented idiom for "list
 * everything"). Combined with `--type`, this gives the most common
 * scratch-cleanup queries:
 *
 *   abap list --package $TMP                     # every object in $TMP
 *   abap list --package $TMP --type CLAS         # every class in $TMP
 *
 * `--user` is intentionally out of scope for this command: ADT
 * `quickSearch` does not return author/responsible fields, and adding
 * an ICF `/data/query` round-trip on TADIR would change the cost shape
 * from "one search" to "search + DB query". Use `abap select --table TADIR`
 * for by-author audit instead.
 */
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { CliError } from '../../output/json.js';
import { SEARCH_RESULT_LIMIT } from '../../core/limits.js';
import { normalizeTypeInput } from '../../cli/type-alias.js';

export interface ListOptions {
  package: string;
  type?: string;
  limit?: number;
}

export interface ListEntry {
  name: string;
  type: string;
  packageName: string;
  description: string;
}

export interface ListResult {
  data: {
    count: number;
    truncated: boolean;
    entries: ListEntry[];
    packageName: string;
    type?: string;
  };
  human: string;
}

export async function runList(opts: ListOptions): Promise<ListResult> {
  if (!opts.package || !opts.package.trim()) {
    throw new CliError('USAGE', '--package is required', {
      nextSteps: [
        '`abap list --package $TMP` lists every object in $TMP.',
        'Combine with --type to narrow by object kind.',
      ],
      example: 'abap list --package $TMP --type CLAS',
    });
  }

  const limit = clampLimit(opts.limit);
  const typeUpper = opts.type ? normalizeTypeInput(opts.type).type.toUpperCase() : undefined;
  const client = await AdtClientWrapper.create();

  // `*` is ADT's documented quickSearch idiom for "every object of the
  // given type" (verified against vhcala4hci A4H); passing an empty
  // string returns nothing.
  const hits = await client.searchObject('*', typeUpper, limit);

  const target = opts.package.trim().toUpperCase();
  const filtered = hits
    .map((h) => ({
      name: String(h['adtcore:name'] ?? ''),
      type: String(h['adtcore:type'] ?? ''),
      packageName: String(h['adtcore:packageName'] ?? ''),
      description: String(h['adtcore:description'] ?? ''),
    }))
    .filter((h) => h.name !== '')
    .filter((h) => h.packageName.toUpperCase() === target);

  return {
    data: {
      count: filtered.length,
      truncated: hits.length >= limit,
      entries: filtered,
      packageName: opts.package,
      ...(typeUpper ? { type: typeUpper } : {}),
    },
    human: formatListHuman(filtered, opts.package, typeUpper, hits.length >= limit),
  };
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return SEARCH_RESULT_LIMIT;
  if (!Number.isFinite(limit) || limit < 1) return 1;
  if (limit > SEARCH_RESULT_LIMIT) return SEARCH_RESULT_LIMIT;
  return Math.floor(limit);
}

function formatListHuman(entries: ListEntry[], pkg: string, type: string | undefined, truncated: boolean): string {
  if (entries.length === 0) {
    return `No objects in package ${pkg}${type ? ` (type=${type})` : ''}.`;
  }
  const header = `${entries.length} object(s) in ${pkg}${type ? ` (type=${type})` : ''}${truncated ? ' [truncated]' : ''}`;
  const lines = [header];
  for (const e of entries) {
    lines.push(`  ${e.type.padEnd(8)} ${e.name.padEnd(34)} ${e.description}`);
  }
  return lines.join('\n');
}