/**
 * `abap search` flow — ADT quickSearch with paging, filters and exact-match
 * widening.
 *
 * Owns the query shaping (`--exact` re-widening to a prefix search), paging
 * (`--page` / `--page-all`), client-side filters (`--exact`, `--package`) and
 * the result/human envelopes. The command layer only declares the commander
 * surface and prints `{ data, human }`.
 */
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { CliError } from '../../output/json.js';
import { collectWarning } from '../../output/meta.js';
import { SEARCH_RESULT_LIMIT, PAGE_ALL_DEFAULT_MAX, SEARCH_EXACT_SCAN_LIMIT } from '../../core/limits.js';
import type { SearchResult } from 'abap-adt-api';

export interface SearchResultItem {
  name: string;
  type: string;
  /** Top-level ADT category, e.g. "TABL" split out of "TABL/DT". */
  category: string;
  /** DDIC sub-kind when `type` is "category/subtype" (TABL/DT, TABL/DB, …). */
  ddicSubtype?: string;
  uri: string;
  description: string;
  packageName: string;
}

export interface SearchRunOptions {
  type?: string;
  limit?: string;
  page?: string;
  exact?: boolean;
  fuzzy?: boolean;
  package?: string;
  /** Fetch all results in one request (cap = pageAllMax × limit). */
  pageAll?: boolean;
  /** Page-count cap that sizes the --page-all single request (default 50). */
  pageAllMax?: string;
}

/** Flow outcome: JSON envelope data + human summary, printed by the command layer. */
export interface SearchResultEnvelope {
  data: Record<string, unknown>;
  human: string;
}

export async function runSearch(query: string | undefined, opts: SearchRunOptions): Promise<SearchResultEnvelope> {
  if (!query?.trim()) {
    throw new CliError('USAGE', 'Search query must not be empty');
  }
  if (opts.exact && opts.fuzzy) {
    throw new CliError('INVALID_ARGUMENT', '--exact and --fuzzy are mutually exclusive', {
      nextSteps: ['Use --exact for a precise name match.', 'Or --fuzzy (default) for substring matching.'],
      example: 'abap search ZCL_DEMO --exact',
    });
  }
  if (opts.pageAll && opts.page !== undefined && opts.page !== '1') {
    throw new CliError('INVALID_ARGUMENT', '--page-all is mutually exclusive with --page', {
      nextSteps: ['Drop --page (--page-all fetches all results in one request).'],
      example: `abap search ${query} --page-all`,
    });
  }

  const limit = parsePositiveInt(opts.limit, '--limit', SEARCH_RESULT_LIMIT);
  const pageAllMax = parsePositiveInt(opts.pageAllMax, '--page-all-max', PAGE_ALL_DEFAULT_MAX);
  const type = opts.type?.trim().toUpperCase() || undefined;

  // --exact on a bare name: real ADT quickSearch returns zero hits without `*`
  // (resolve.ts has the same quirk), so widen and filter client-side. Widen with
  // a PREFIX (`NAME*`), not `*NAME*`: an exact name always matches its own
  // prefix, and a prefix keeps the candidate set small, whereas `*NAME*` can
  // match thousands of unrelated objects and push the exact hit out of the
  // fetched window (feedback F-13 / F-28).
  const effectiveQuery = opts.exact && !query.includes('*') ? `${query.trim()}*` : query;

  const client = await AdtClientWrapper.create();

  // quickSearch has no offset: every call returns the same leading slice, so
  // --page-all fetches once with the largest accepted maxResults (limit ×
  // pageAllMax) and reports whether the server may still have more.
  if (opts.pageAll) {
    const requested = limit * pageAllMax;
    const raw = await client.searchObject(effectiveQuery, type, requested);
    const items: SearchResultItem[] = [];
    for (const item of applyFilters(raw.map(toResultItem), opts, query)) {
      // De-dup by URI in case the server repeats entries within a large set.
      if (!items.some((a) => a.uri && a.uri === item.uri)) items.push(item);
    }
    const truncated = raw.length >= requested;
    if (truncated) {
      collectWarning(
        'PAGINATION_LIMITED',
        `Reached the --page-all-max ${pageAllMax} page cap (${requested} items). Narrow with --type/--package/--exact.`,
        { requested, pageAllMax },
      );
    }
    const hint = items.length === 0
      ? 'No matches. Broaden the query, drop --package, or use --fuzzy.'
      : '';
    return {
      data: {
        items,
        pageAll: true,
        requested,
        limit,
        total: items.length,
        ...(truncated ? { truncated: true } : {}),
        ...(hint ? { hint } : {}),
      },
      human: humanSummaryAll(query, type, items, truncated),
    };
  }

  // Single-page (default) path: keep the existing "fetch limit*page then slice"
  // behavior so back-compat with --page and --limit is unchanged.
  const page = parsePositiveInt(opts.page, '--page', 1);
  // Fetch limit*page in one call, then slice client-side. `--exact` filters
  // client-side too (see effectiveQuery), so its candidate window must be much
  // larger than the returned page — otherwise an exact hit that sorts beyond the
  // first `limit*page` results is reported as "no matches" (F-13 / F-28).
  const requestMax = opts.exact ? Math.max(limit * page, SEARCH_EXACT_SCAN_LIMIT) : limit * page;
  const results = await client.searchObject(effectiveQuery, type, requestMax);

  let mapped: SearchResultItem[] = results.map(toResultItem);
  mapped = applyFilters(mapped, opts, query);

  const start = (page - 1) * limit;
  const items = mapped.slice(start, start + limit);
  const truncated = mapped.length >= requestMax;

  const hint = truncated
    ? `Result truncated. Narrow with --type/--package/--exact, or use --page ${page + 1}.`
    : mapped.length === 0
      ? 'No matches. Broaden the query, drop --package, or use --fuzzy.'
      : '';

  return {
    data: { items, page, limit, truncated, ...(hint ? { hint } : {}) },
    human: humanSummary(query, type, items, truncated),
  };
}

function toResultItem(r: SearchResult): SearchResultItem {
  const rawType = r['adtcore:type'] ?? '';
  // Split ADT "category/subtype" (e.g. "TABL/DT") into a separate `ddicSubtype`
  // so agents can distinguish transparent tables (DT) from pooled (DB),
  // append structures (DY), etc. without parsing the slash on their own.
  const slash = rawType.indexOf('/');
  const category = slash >= 0 ? rawType.slice(0, slash) : rawType;
  const ddicSubtype = slash >= 0 ? rawType.slice(slash + 1) : undefined;
  const item: SearchResultItem = {
    name: r['adtcore:name'] ?? '',
    type: rawType,
    category,
    uri: r['adtcore:uri'] ?? '',
    description: r['adtcore:description'] ?? '',
    packageName: r['adtcore:packageName'] ?? '',
  };
  if (ddicSubtype !== undefined) item.ddicSubtype = ddicSubtype;
  return item;
}

function applyFilters(items: SearchResultItem[], opts: SearchRunOptions, query: string): SearchResultItem[] {
  let mapped = items;
  if (opts.exact) {
    // Strip * so `--exact` works with wildcard queries like `*ZCL_X*`.
    const needle = query.trim().replace(/\*/g, '').toUpperCase();
    mapped = mapped.filter((r) => r.name.toUpperCase() === needle);
  }
  const pkg = opts.package?.trim().toUpperCase();
  if (pkg) {
    mapped = mapped.filter((r) => r.packageName.toUpperCase() === pkg);
  }
  return mapped;
}

function humanSummaryAll(
  query: string,
  type: string | undefined,
  items: SearchResultItem[],
  truncated: boolean,
): string {
  const filter = type ? ` (type ${type})` : '';
  if (items.length === 0) {
    return `No objects found for '${query}'${filter}.`;
  }
  const lines = [`Found ${items.length} object(s) matching '${query}'${filter}:`];
  for (const r of items) {
    const desc = r.description ? ` — ${r.description}` : '';
    const pkg = r.packageName ? ` (${r.packageName})` : '';
    lines.push(`  ${r.name} (${r.type})${desc}${pkg}`);
  }
  if (truncated) lines.push('(truncated by --page-all-max; narrow with --type/--package/--exact)');
  return lines.join('\n');
}

function humanSummary(query: string, type: string | undefined, items: SearchResultItem[], truncated: boolean): string {
  const filter = type ? ` (type ${type})` : '';
  if (items.length === 0) {
    return `No objects found for '${query}'${filter}.`;
  }
  const lines = [`Found ${items.length} object(s) matching '${query}'${filter}:`];
  for (const r of items) {
    const desc = r.description ? ` — ${r.description}` : '';
    const pkg = r.packageName ? ` (${r.packageName})` : '';
    lines.push(`  ${r.name} (${r.type})${desc}${pkg}`);
  }
  if (truncated) lines.push('(truncated — use --limit/--page to page through results)');
  return lines.join('\n');
}

function parsePositiveInt(value: string | undefined, flag: string, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new CliError('INVALID_ARGUMENT', `${flag} must be a positive integer`, {
      example: `abap search <query> ${flag} ${fallback}`,
    });
  }
  return n;
}
