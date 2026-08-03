import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs/promises';
import { AdtClientWrapper } from '../clients/adt-client.js';
import { buildFilename } from '../formats/file-resolver.js';
import { fileExists, writeAbapFile } from '../formats/abap-source.js';
import { CliError, printError, printResult, jsonFromCommand } from '../output/json.js';
import { commonErrorsAfter } from '../output/help-text.js';
import { resolveObject, getObjectParts, SEARCH_RESULT_LIMIT } from '../sync/resolve.js';

interface PullOptions {
  type?: string;
  package?: string;
  dir: string;
  overwrite?: boolean;
  skipExisting?: boolean;
  includeTests?: boolean;
  includeAllParts?: boolean;
  limit?: string;
  page?: string;
}

interface PullEntry {
  object: string;
  type: string;
  status: 'written' | 'skipped' | 'failed';
  files?: string[];
  detail?: string;
  code?: string;
}

export function registerPullCommand(program: Command): void {
  program
    .command('pull')
    .description('Download ABAP objects from SAP to local files')
    .addHelpText('after', commonErrorsAfter())
    .argument('[object-name]', 'Object name to download (e.g., ZCL_MY_CLASS)')
    .option('--type <type>', 'Object type (CLAS, PROG, INTF, etc.)')
    .option('--package <package>', 'Download all objects in a package')
    .option('--limit <n>', `Batch page size for --package (default ${SEARCH_RESULT_LIMIT})`)
    .option('--page <n>', 'Batch page number for --package (1-based)', '1')
    .option('--dir <path>', 'Output directory', 'src/')
    .option('--overwrite', 'Allow replacing a local file with different content')
    .option('--skip-existing', 'Skip files that already exist locally')
    .option('--include-tests', 'Include testclasses source part')
    .option('--include-all-parts', 'Include every source-code part')
    .action(async (objectName: string, opts: PullOptions, cmd) => {
      const json = jsonFromCommand(cmd);
      try {
        await runPull(objectName, opts, json);
      } catch (error: unknown) {
        printError(json, error);
      }
    });
}

async function runPull(objectName: string, opts: PullOptions, json: boolean): Promise<void> {
  const client = await AdtClientWrapper.create();
  if (opts.package) {
    await runPackagePull(client, opts, json);
    return;
  }
  if (!objectName) {
    throw new CliError('USAGE', 'Specify an object name (e.g., ZCL_MY_CLASS)', {
      nextSteps: ['Run `abap search <query>` first if you do not know the exact name.'],
      example: 'abap pull ZCL_DEMO',
    });
  }

  const object = await resolveObject(client, objectName, opts.type);
  const result = await pullObject(client, object, opts);
  printResult(
    json,
    { object: object.name, type: object.type, entries: result.entries, written: result.written, skipped: result.skipped, failed: result.failed },
    humanSummary(object, result),
  );
}

/** Enumerate a package (search + packageName filter) and pull each object (FR-024). */
async function runPackagePull(client: AdtClientWrapper, opts: PullOptions, json: boolean): Promise<void> {
  const limit = parsePositiveInt(opts.limit, '--limit', SEARCH_RESULT_LIMIT);
  const page = parsePositiveInt(opts.page, '--page', 1);
  const pkg = opts.package!.trim().toUpperCase();

  const results = await client.searchObject('', opts.type, limit * page);
  const matches = results.filter((r) => (r['adtcore:packageName'] ?? '').toUpperCase() === pkg);
  const start = (page - 1) * limit;
  const window = matches.slice(start, start + limit);
  const truncated = matches.length >= limit * page;

  const entries: PullEntry[] = [];
  const written: string[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];
  for (const hit of window) {
    const object = { name: hit['adtcore:name'], type: hit['adtcore:type'], objectUrl: hit['adtcore:uri'] };
    try {
      const result = await pullObject(client, object, opts);
      entries.push(...result.entries);
      written.push(...result.written);
      skipped.push(...result.skipped);
    } catch (error: unknown) {
      const err = error instanceof Error ? error : String(error);
      entries.push({
        object: object.name,
        type: object.type,
        status: 'failed',
        code: (error as { code?: string }).code,
        detail: err instanceof Error ? err.message : String(err),
      });
      failed.push(object.name);
    }
  }

  printResult(
    json,
    {
      package: pkg,
      entries,
      written,
      skipped,
      failed,
      page,
      limit,
      truncated,
      ...(truncated ? { hint: `Result truncated. Use --page ${page + 1} to fetch more.` } : {}),
    },
    `Pulled ${written.length} object(s) from ${pkg}${truncated ? ' (truncated)' : ''}.`,
  );
}

/** Pull one object's selected parts into local files (shared by single + batch). */
async function pullObject(
  client: AdtClientWrapper,
  object: { name: string; type: string; objectUrl: string },
  opts: { dir: string; overwrite?: boolean; skipExisting?: boolean; includeTests?: boolean; includeAllParts?: boolean },
): Promise<{ entries: PullEntry[]; written: string[]; skipped: string[]; failed: string[] }> {
  const allParts = await getObjectParts(client, object);
  const parts = opts.includeAllParts
    ? allParts
    : allParts.filter((p) => (opts.includeTests ? true : p.subtype !== 'testclasses'));

  const entries: PullEntry[] = [];
  const written: string[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];
  for (const part of parts) {
    const content = await client.getObjectSource(part.sourceUrl);
    const filename = buildFilename(object.name, object.type, part.subtype, '.abap');
    const filePath = path.join(opts.dir, filename);

    if (await fileExists(filePath)) {
      const existing = await fs.readFile(filePath, 'utf-8');
      if (existing === content) {
        entries.push({ object: object.name, type: object.type, status: 'skipped', detail: 'already matches' });
        skipped.push(filePath);
        continue;
      }
      if (opts.skipExisting) {
        entries.push({ object: object.name, type: object.type, status: 'skipped', detail: 'local file differs; --skip-existing' });
        skipped.push(filePath);
        continue;
      }
      if (!opts.overwrite) {
        throw new CliError(
          'OVERWRITE_REQUIRED',
          `Local file ${filePath} differs from SAP; refusing to overwrite.`,
          {
            details: { file: filePath, object: object.name },
            nextSteps: [
              'Re-run with --overwrite to replace the local file.',
              'Or re-run with --skip-existing to keep the local file unchanged.',
            ],
            example: `abap pull ${object.name} --overwrite`,
          },
        );
      }
    }
    await writeAbapFile(path.resolve(process.cwd(), filePath), content);
    entries.push({ object: object.name, type: object.type, status: 'written', files: [filePath] });
    written.push(filePath);
  }
  return { entries, written, skipped, failed };
}

function parsePositiveInt(value: string | undefined, flag: string, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new CliError('INVALID_ARGUMENT', `${flag} must be a positive integer`, {
      example: `abap pull --package ZPKG ${flag} ${fallback}`,
    });
  }
  return n;
}

function humanSummary(
  object: { name: string; type: string },
  result: { written: string[]; skipped: string[] },
): string {
  const lines = [`Pulled ${object.name} (${object.type}):`];
  for (const f of result.written) lines.push(`  ${f}`);
  if (result.skipped.length > 0) {
    lines.push(`Skipped ${result.skipped.length} file(s):`);
    for (const f of result.skipped) lines.push(`  ${f}`);
  }
  return lines.join('\n');
}
