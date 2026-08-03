import { Command } from 'commander';
import { AdtClientWrapper } from '../clients/adt-client.js';
import { CliError, printError, printResult, jsonFromCommand } from '../output/json.js';
import { commonErrorsAfter } from '../output/help-text.js';

interface SearchResult {
  name: string;
  type: string;
  uri: string;
  description: string;
  packageName: string;
}

export function registerSearchCommand(program: Command): void {
  program
    .command('search')
    .description('Search for ABAP objects in SAP system')
    .addHelpText('after', commonErrorsAfter())
    .argument('<query>', 'Search query (supports * wildcard)')
    .option('--type <type>', 'Filter by object type')
    .option('--max <n>', 'Maximum results', '100')
    .action(async (query: string, opts: { type?: string; max?: string }, cmd) => {
      const json = jsonFromCommand(cmd);
      try {
        await runSearch(query, opts, json);
      } catch (error: unknown) {
        printError(json, error);
      }
    });
}

async function runSearch(query: string, opts: { type?: string; max?: string }, json: boolean): Promise<void> {
  if (!query.trim()) {
    throw new CliError('USAGE', 'Search query must not be empty');
  }
  const max = parseMax(opts.max);
  const type = opts.type?.trim().toUpperCase() || undefined;

  const client = await AdtClientWrapper.create();
  const results = await client.searchObject(query, type, max);

  const mapped: SearchResult[] = results.map((r) => ({
    name: r['adtcore:name'] ?? '',
    type: r['adtcore:type'] ?? '',
    uri: r['adtcore:uri'] ?? '',
    description: r['adtcore:description'] ?? '',
    packageName: r['adtcore:packageName'] ?? '',
  }));

  printResult(json, { results: mapped, count: mapped.length }, humanSummary(query, type, mapped));
}

function parseMax(value?: string): number {
  if (value === undefined || value === '') return 100;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new CliError('INVALID_ARGUMENT', '--max must be a positive integer');
  }
  return n;
}

function humanSummary(query: string, type: string | undefined, results: SearchResult[]): string {
  const filter = type ? ` (type ${type})` : '';
  if (results.length === 0) {
    return `No objects found for '${query}'${filter}.`;
  }
  const lines = [`Found ${results.length} object(s) matching '${query}'${filter}:`];
  for (const r of results) {
    const desc = r.description ? ` — ${r.description}` : '';
    const pkg = r.packageName ? ` (${r.packageName})` : '';
    lines.push(`  ${r.name} (${r.type})${desc}${pkg}`);
  }
  return lines.join('\n');
}
