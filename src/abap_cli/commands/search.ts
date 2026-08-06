import { Command } from 'commander';
import { AdtClientWrapper } from '../clients/adt-client.js';
import { CliError, printError, printResult, jsonFromCommand, printSchema, type CommandSchema } from '../output/json.js';
import { collectWarning } from '../output/meta.js';
import { commonErrorsAfter } from '../output/help-text.js';
import { SEARCH_RESULT_LIMIT } from '../core/limits.js';
import type { SearchResult } from 'abap-adt-api';

interface SearchResultItem {
  name: string;
  type: string;
  uri: string;
  description: string;
  packageName: string;
}

interface SearchOptions {
  type?: string;
  limit?: string;
  page?: string;
  exact?: boolean;
  fuzzy?: boolean;
  package?: string;
  max?: string; // deprecated alias for --limit
  schema?: boolean;
  /** Fetch all results in one request (cap = pageAllMax × limit). */
  pageAll?: boolean;
  /** Page-count cap that sizes the --page-all single request (default 50). */
  pageAllMax?: string;
}

/** Default hard cap for `--page-all` (50 × 20 = 1000 items). */
const PAGE_ALL_DEFAULT_MAX = 50;

export function registerSearchCommand(program: Command): void {
  program
    .command('search')
    .description('Search for ABAP objects in SAP system')
    .addHelpText('after', commonErrorsAfter())
    // [query]（可选）是因为 --schema 模式下不需要查询词；真实搜索仍需 query。
    .argument('[query]', 'Search query (supports * wildcard)')
    .option('--type <type>', 'Filter by object type')
    .option('--limit <n>', `Maximum results per page (default ${SEARCH_RESULT_LIMIT})`)
    .option('--page <n>', 'Page number (1-based)', '1')
    .option('--exact', 'Exact name match (mutually exclusive with --fuzzy)')
    .option('--fuzzy', 'Substring match (default)')
    .option('--package <package>', 'Filter by package')
    .option('--max <n>', 'DEPRECATED: alias for --limit')
    .option('--page-all', 'Fetch all results in one request (cap = --page-all-max × --limit; mutually exclusive with --page)')
    .option('--page-all-max <n>', `Page-count cap that sizes the --page-all single request (default ${PAGE_ALL_DEFAULT_MAX})`)
    .option('--schema', 'Print the command parameter schema as JSON and exit (no SAP call)')
    .action(async (query: string | undefined, opts: SearchOptions, cmd) => {
      const json = jsonFromCommand(cmd);
      try {
        await runSearch(query, opts, json);
      } catch (error: unknown) {
        printError(json, error);
      }
    });
}

async function runSearch(query: string | undefined, opts: SearchOptions, json: boolean): Promise<void> {
  if (opts.schema) {
    printSchema(searchSchema());
    return;
  }
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

  // --max is a deprecated alias for --limit; --limit wins when both are given.
  if (opts.max !== undefined) {
    collectWarning('DEPRECATED_OPTION', '--max is deprecated; use --limit instead.', { option: '--max' });
    if (opts.limit === undefined) opts.limit = opts.max;
  }
  const limit = parsePositiveInt(opts.limit, '--limit', SEARCH_RESULT_LIMIT);
  const pageAllMax = parsePositiveInt(opts.pageAllMax, '--page-all-max', PAGE_ALL_DEFAULT_MAX);
  const type = opts.type?.trim().toUpperCase() || undefined;

  // --exact on a bare name: real ADT quickSearch returns zero hits without `*`
  // (resolve.ts has the same quirk), so widen to *NAME* and filter client-side.
  const effectiveQuery = opts.exact && !query.includes('*') ? `*${query.trim()}*` : query;

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
    const data = {
      items,
      pageAll: true,
      requested,
      limit,
      total: items.length,
      ...(truncated ? { truncated: true } : {}),
      ...(hint ? { hint } : {}),
    };
    printResult(json, data, humanSummaryAll(query, type, items, truncated));
    return;
  }

  // Single-page (default) path: keep the existing "fetch limit*page then slice"
  // behavior so back-compat with --page and --limit is unchanged.
  const page = parsePositiveInt(opts.page, '--page', 1);
  // Fetch limit*page in one call, then slice client-side (research §1).
  const results = await client.searchObject(effectiveQuery, type, limit * page);

  let mapped: SearchResultItem[] = results.map(toResultItem);
  mapped = applyFilters(mapped, opts, query);

  const start = (page - 1) * limit;
  const items = mapped.slice(start, start + limit);
  const truncated = mapped.length >= limit * page;

  const hint = truncated
    ? `Result truncated. Narrow with --type/--package/--exact, or use --page ${page + 1}.`
    : mapped.length === 0
      ? 'No matches. Broaden the query, drop --package, or use --fuzzy.'
      : '';

  const data = { items, page, limit, truncated, ...(hint ? { hint } : {}) };
  printResult(json, data, humanSummary(query, type, items, truncated));
}

function toResultItem(r: SearchResult): SearchResultItem {
  return {
    name: r['adtcore:name'] ?? '',
    type: r['adtcore:type'] ?? '',
    uri: r['adtcore:uri'] ?? '',
    description: r['adtcore:description'] ?? '',
    packageName: r['adtcore:packageName'] ?? '',
  };
}

function applyFilters(items: SearchResultItem[], opts: SearchOptions, query: string): SearchResultItem[] {
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

/** Machine-readable parameter contract for `abap search --schema` (P0.1). */
function searchSchema(): CommandSchema {
  return {
    schemaVersion: 1,
    command: 'search',
    description: 'Search for ABAP objects in SAP system',
    usage: 'abap search [options] <query>',
    arguments: [{ name: 'query', required: true, description: 'Search query (supports * wildcard)' }],
    options: [
      { name: '--type', type: 'string', valuePlaceholder: '<type>', description: 'Filter by object type' },
      { name: '--limit', type: 'int', valuePlaceholder: '<n>', default: SEARCH_RESULT_LIMIT, description: 'Maximum results per page' },
      { name: '--page', type: 'int', valuePlaceholder: '<n>', default: 1, description: 'Page number (1-based)' },
      { name: '--exact', type: 'boolean', description: 'Exact name match (mutually exclusive with --fuzzy)' },
      { name: '--fuzzy', type: 'boolean', description: 'Substring match (default)' },
      { name: '--package', type: 'string', valuePlaceholder: '<package>', description: 'Filter by package' },
      { name: '--max', type: 'int', valuePlaceholder: '<n>', deprecated: true, description: 'Deprecated alias for --limit' },
      { name: '--page-all', type: 'boolean', description: 'Fetch all results in one request (cap = --page-all-max × --limit; mutually exclusive with --page)' },
      { name: '--page-all-max', type: 'int', valuePlaceholder: '<n>', default: PAGE_ALL_DEFAULT_MAX, description: 'Page-count cap that sizes the --page-all single request' },
    ],
    exclusiveGroups: [['--exact', '--fuzzy'], ['--page', '--page-all']],
    globalOptions: ['--json', '--report-stuck'],
    examples: ['abap search ZCL_* --type CLAS --limit 50', 'abap search ZCL_DEMO --exact', 'abap search ZCL_* --page-all'],
  };
}
