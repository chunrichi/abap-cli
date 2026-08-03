import { Command } from 'commander';
import { AdtClientWrapper } from '../clients/adt-client.js';
import { CliError, printError, printResult, jsonFromCommand } from '../output/json.js';
import { commonErrorsAfter } from '../output/help-text.js';
import { SEARCH_RESULT_LIMIT } from '../sync/resolve.js';

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
}

export function registerSearchCommand(program: Command): void {
  program
    .command('search')
    .description('Search for ABAP objects in SAP system')
    .addHelpText('after', commonErrorsAfter())
    .argument('<query>', 'Search query (supports * wildcard)')
    .option('--type <type>', 'Filter by object type')
    .option('--limit <n>', `Maximum results per page (default ${SEARCH_RESULT_LIMIT})`)
    .option('--page <n>', 'Page number (1-based)', '1')
    .option('--exact', 'Exact name match (mutually exclusive with --fuzzy)')
    .option('--fuzzy', 'Substring match (default)')
    .option('--package <package>', 'Filter by package')
    .option('--max <n>', 'DEPRECATED: alias for --limit')
    .action(async (query: string, opts: SearchOptions, cmd) => {
      const json = jsonFromCommand(cmd);
      try {
        await runSearch(query, opts, json);
      } catch (error: unknown) {
        printError(json, error);
      }
    });
}

async function runSearch(query: string, opts: SearchOptions, json: boolean): Promise<void> {
  if (!query.trim()) {
    throw new CliError('USAGE', 'Search query must not be empty');
  }
  if (opts.exact && opts.fuzzy) {
    throw new CliError('INVALID_ARGUMENT', '--exact and --fuzzy are mutually exclusive', {
      nextSteps: ['Use --exact for a precise name match.', 'Or --fuzzy (default) for substring matching.'],
      example: 'abap search ZCL_DEMO --exact',
    });
  }

  // --max is a deprecated alias for --limit; --limit wins when both are given.
  let deprecationWarning = '';
  if (opts.max !== undefined) {
    deprecationWarning = 'Warning: --max is deprecated; use --limit instead.';
    if (opts.limit === undefined) opts.limit = opts.max;
  }
  const limit = parsePositiveInt(opts.limit, '--limit', SEARCH_RESULT_LIMIT);
  const page = parsePositiveInt(opts.page, '--page', 1);
  const type = opts.type?.trim().toUpperCase() || undefined;

  const client = await AdtClientWrapper.create();
  // Fetch limit*page in one call, then slice client-side (research §1).
  const results = await client.searchObject(query, type, limit * page);

  let mapped: SearchResultItem[] = results.map((r) => ({
    name: r['adtcore:name'] ?? '',
    type: r['adtcore:type'] ?? '',
    uri: r['adtcore:uri'] ?? '',
    description: r['adtcore:description'] ?? '',
    packageName: r['adtcore:packageName'] ?? '',
  }));

  // --exact / --fuzzy and --package are applied client-side (research §2/§3).
  if (opts.exact) {
    const needle = query.trim().toUpperCase();
    mapped = mapped.filter((r) => r.name.toUpperCase() === needle);
  }
  const pkg = opts.package?.trim().toUpperCase();
  if (pkg) {
    mapped = mapped.filter((r) => r.packageName.toUpperCase() === pkg);
  }

  const start = (page - 1) * limit;
  const items = mapped.slice(start, start + limit);
  const truncated = mapped.length >= limit * page;

  const hint = truncated
    ? `Result truncated. Narrow with --type/--package/--exact, or use --page ${page + 1}.`
    : mapped.length === 0
      ? 'No matches. Broaden the query, drop --package, or use --fuzzy.'
      : '';

  const data = { items, page, limit, truncated, ...(hint ? { hint } : {}) };
  if (deprecationWarning) console.error(deprecationWarning);
  printResult(json, data, humanSummary(query, type, items, truncated));
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
