import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs/promises';
import { AdtClientWrapper } from '../clients/adt-client.js';
import { IcfClient } from '../clients/icf-client.js';
import { objectDirName, buildFilename } from '../formats/file-resolver.js';
import { fileExists, writeAbapFile } from '../formats/abap-source.js';
import { writeDdicJson, DDIC_SUPPORTED_TYPES, wireToLocal, type DdicSupportedType } from '../formats/ddic-json.js';
import { parseTextpoolProperties, serializeTextpoolProperties, type TextElementCategory } from '../formats/textpool.js';
import { routeTextpool } from '../textpool/textpool-router.js';
import { strategyFor } from '../formats/pull-strategy.js';
import { CliError, printError, printResult, jsonFromCommand } from '../output/json.js';
import type { ErrorCode } from '../output/error-codes.js';
import { commonErrorsAfter } from '../output/help-text.js';
import { resolveObject, SEARCH_RESULT_LIMIT } from '../sync/resolve.js';

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
  /** 014: also pull textpool .properties files (texts/selections/headings). */
  textpool?: boolean;
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
    .option('--textpool', '014: also pull textpool files (.texts/.selections/.headings.<lang>.properties)')
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

  // 014: --textpool pulls the three .properties files (mixed-mode route).
  if (opts.textpool) {
    await runPullTextpool(objectName, opts.type, opts, json);
    return;
  }

  // 014: DDIC objects route to the self-built ICF service (FR-015).
  const typeUpper = opts.type?.toUpperCase();
  if (typeUpper && isDdicSupportedType(typeUpper)) {
    await runPullDdic(objectName, typeUpper, opts, json);
    return;
  }
  if (typeUpper && DDIC_SUPPORTED_TYPES.indexOf(typeUpper as DdicSupportedType) === -1) {
    // Unknown DDIC-looking type (e.g. TTYP, deferred) is rejected explicitly.
    if (/^(DOMA|DTEL|TABL|STRU|TTYP)$/.test(typeUpper)) {
      throw new CliError('DDIC_NOT_SUPPORTED', `Object type ${typeUpper} is not supported in this phase`, {
        type: typeUpper,
        nextSteps: [`Supported DDIC types: ${DDIC_SUPPORTED_TYPES.join(', ')}.`],
      });
    }
  }

  const object = await resolveObject(client, objectName, opts.type);
  const result = await pullObject(client, object, opts);
  printResult(
    json,
    { object: object.name, type: object.type, entries: result.entries, written: result.written, skipped: result.skipped, failed: result.failed },
    humanSummary(object, result),
  );
}

/**
 * 014: pull textpool .properties files for an object via the mixed-mode route
 * (ADT when the cached capability allows reads, otherwise ICF fallback — Q1:
 * route is decided from the recorded profile, no runtime fallback).
 */
async function runPullTextpool(objectName: string, type: string | undefined, opts: PullOptions, json: boolean): Promise<void> {
  const objType = (type ?? 'PROG').toUpperCase();
  const { systemName } = await loadProjectConfig();
  const route = routeTextpool(systemName, 'read');

  const categories: TextElementCategory[] = ['symbols', 'selections', 'headings'];
  const entries: PullEntry[] = [];
  const written: string[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];

  const client = await AdtClientWrapper.create();
  const icf = await IcfClient.create();

  for (const adtCat of categories) {
    const fileCat: 'texts' | 'selections' | 'headings' = adtCat === 'symbols' ? 'texts' : adtCat;
    const filename = `${objectName.toLowerCase()}.${objType.toLowerCase()}.${fileCat}.en.properties`;
    const relPath = path.join(opts.dir, objectDirName(objectName), filename);
    const targetPath = path.resolve(process.cwd(), relPath);

    if (await fileExists(targetPath) && !opts.overwrite && !opts.skipExisting) {
      throw new CliError('OVERWRITE_REQUIRED', `${relPath} already exists; use --overwrite to replace it`, {
        file: relPath,
        nextSteps: ['Re-run with --overwrite to replace the existing file.'],
        example: `abap pull ${objectName} --textpool --overwrite`,
      });
    }
    if (await fileExists(targetPath) && opts.skipExisting) {
      entries.push({ object: objectName, type: objType, status: 'skipped', files: [relPath] });
      skipped.push(relPath);
      continue;
    }

    let content: string;
    if (route === 'adt') {
      const res = await client.getTextElements(objType, objectName, adtCat);
      content = serializeTextpoolProperties(fileCat, res.textElements ?? []);
    } else {
      const resp = await icf.getTextpool<{ elements?: Array<{ id: string; text: string }> }>(fileCat, objectName, objType);
      if (resp.status !== 'success' || !resp.data) {
        const code = resp.error?.code === 'TEXTPOOL_OBJECT_NOT_FOUND' ? 'OBJECT_NOT_FOUND' : (resp.error?.code as ErrorCode | undefined) ?? 'SAP_ERROR';
        entries.push({ object: objectName, type: objType, status: 'failed', code, detail: resp.error?.message, files: [relPath] });
        failed.push(relPath);
        continue;
      }
      // Reuse the shared properties serializer so ADT/ICF output is identical (FR-023).
      content = serializeTextpoolProperties(
        fileCat,
        (resp.data.elements ?? []).map((e) => ({ id: e.id, text: e.text })),
      );
    }

    await writeAbapFile(targetPath, content);
    entries.push({ object: objectName, type: objType, status: 'written', files: [relPath] });
    written.push(relPath);
  }

  printResult(
    json,
    { object: objectName, type: objType, route, entries, written, skipped, failed },
    `Pulled textpool for ${objType} ${objectName} (route: ${route})`,
  );
}

/** 014: load the active system name for route decisions. */
async function loadProjectConfig(): Promise<{ systemName: string }> {
  const { loadConfig } = await import('../config/project-config.js');
  const cfg = await loadConfig();
  return { systemName: cfg.systemName };
}

/** 014: pull a DDIC object via ICF GET /ddic/<type>/<name> and write the local JSON. */
async function runPullDdic(objectName: string, type: DdicSupportedType, opts: PullOptions, json: boolean): Promise<void> {
  const icf = await IcfClient.create();
  const resp = await icf.getDdic<Record<string, unknown>>(type.toLowerCase(), objectName);
  if (resp.status !== 'success' || !resp.data) {
    // DDIC_OBJECT_NOT_FOUND normalizes to OBJECT_NOT_FOUND (exit 8, NOT_FOUND family).
    const rawCode = resp.error?.code ?? 'SAP_ERROR';
    const code: ErrorCode = rawCode === 'DDIC_OBJECT_NOT_FOUND' ? 'OBJECT_NOT_FOUND' : (rawCode as ErrorCode);
    throw new CliError(code, resp.error?.message ?? `Failed to pull ${type} ${objectName}`, {
      object: objectName,
      type,
      nextSteps: [
        'Verify the object exists in the target system.',
        'Run `abap search <name>` to confirm the object name and type.',
      ],
    });
  }

  const local = wireToLocal(type, resp.data as unknown as Parameters<typeof wireToLocal>[1]);
  // DDIC files are flat: src/<name>.<type>.json (data-model §5), no subdirectory.
  const filename = buildFilename(objectName, type, 'main', '.json');
  const relPath = path.join(opts.dir, filename);
  const targetPath = path.resolve(process.cwd(), relPath);

  if (await fileExists(targetPath) && !opts.overwrite && !opts.skipExisting) {
    throw new CliError('OVERWRITE_REQUIRED', `${relPath} already exists; use --overwrite to replace it`, {
      file: relPath,
      nextSteps: ['Re-run with --overwrite to replace the existing file.'],
      example: `abap pull ${objectName} --type ${type} --overwrite`,
    });
  }
  if (await fileExists(targetPath) && opts.skipExisting) {
    printResult(
      json,
      { object: objectName, type, entries: [{ file: relPath, status: 'skipped' }], written: [], skipped: [relPath], failed: [] },
      `Skipped ${type} ${objectName} (file already exists: ${relPath})`,
    );
    return;
  }

  await writeDdicJson(targetPath, local);

  printResult(
    json,
    {
      object: objectName,
      type,
      entries: [{ file: relPath, status: 'written' }],
      written: [relPath],
      skipped: [],
      failed: [],
    },
    `Pulled ${type} ${objectName} to ${relPath}`,
  );
}

/** 014: narrow an arbitrary type string to the supported DDIC types. */
function isDdicSupportedType(t: string): t is DdicSupportedType {
  return (DDIC_SUPPORTED_TYPES as readonly string[]).includes(t);
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
  const files = await strategyFor(object.type).files({ client, object, opts });

  const entries: PullEntry[] = [];
  const written: string[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];

  // abap-file-format layout: one directory per object under opts.dir.
  const objectDir = objectDirName(object.name);

  for (const file of files) {
    await writeOne(await file.content(), file.filename);
  }
  return { entries, written, skipped, failed };

  /** Write one file with exists/skip/overwrite conflict handling. */
  async function writeOne(content: string, filename: string): Promise<void> {
    const filePath = path.join(opts.dir, objectDir, filename);
    const absPath = path.resolve(process.cwd(), filePath);
    if (await fileExists(absPath)) {
      const existing = await fs.readFile(absPath, 'utf-8');
      if (existing === content) {
        entries.push({ object: object.name, type: object.type, status: 'skipped', detail: 'already matches' });
        skipped.push(filePath);
        return;
      }
      if (opts.skipExisting) {
        entries.push({ object: object.name, type: object.type, status: 'skipped', detail: 'local file differs; --skip-existing' });
        skipped.push(filePath);
        return;
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
    await writeAbapFile(absPath, content);
    entries.push({ object: object.name, type: object.type, status: 'written', files: [filePath] });
    written.push(filePath);
  }
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
