import * as path from 'path';
import * as fs from 'fs/promises';
import { AdtClientWrapper } from '../clients/adt-client.js';
import { IcfClient } from '../clients/icf-client.js';
import { objectDirName, buildFilename } from '../formats/file-resolver.js';
import { fileExists, writeAbapFile } from '../formats/abap-source.js';
import { writeDdicJson, DDIC_SUPPORTED_TYPES, wireToLocal, type DdicSupportedType } from '../dictionary/ddic-json.js';
import { parseTextpoolProperties, serializeTextpoolProperties, type TextElementCategory } from '../formats/textpool.js';
import { routeTextpool } from '../textpool/textpool-router.js';
import { strategyFor } from '../formats/pull-strategy.js';
import { CliError } from '../output/json.js';
import type { ErrorCode } from '../output/error-codes.js';
import { resolveObject } from '../core/resolve.js';
import { SEARCH_RESULT_LIMIT } from '../core/limits.js';

export interface PullOptions {
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
  /** 015: pull the object's active version source from a remote system (Version Management). */
  remote?: string;
}

export interface PullEntry {
  object: string;
  type: string;
  status: 'written' | 'skipped' | 'failed';
  files?: string[];
  detail?: string;
  code?: string;
}

/** Flow outcome: JSON envelope data + human summary, printed by the command layer. */
export interface PullResult {
  data: Record<string, unknown>;
  human: string;
}

export async function runPull(objectName: string, opts: PullOptions): Promise<PullResult> {
  const client = await AdtClientWrapper.create();
  if (opts.package) {
    return runPackagePull(client, opts);
  }
  if (!objectName) {
    throw new CliError('USAGE', 'Specify an object name (e.g., ZCL_MY_CLASS)', {
      nextSteps: ['Run `abap search <query>` first if you do not know the exact name.'],
      example: 'abap pull ZCL_DEMO',
    });
  }

  // 015: --remote pulls the active (00000) source of an object as transported to
  // another system via the Version Management endpoint (/version-source).
  if (opts.remote) {
    return runPullRemote(objectName, opts.type, opts.remote, opts);
  }

  // 014: --textpool pulls the three .properties files (mixed-mode route).
  if (opts.textpool) {
    return runPullTextpool(objectName, opts.type, opts);
  }

  // 014: DDIC objects route to the self-built ICF service (FR-015).
  const typeUpper = opts.type?.toUpperCase();
  if (typeUpper && isDdicSupportedType(typeUpper)) {
    return runPullDdic(objectName, typeUpper, opts);
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
  return {
    data: { object: object.name, type: object.type, entries: result.entries, written: result.written, skipped: result.skipped, failed: result.failed },
    human: humanSummary(object, result),
  };
}

/**
 * 014: pull textpool .properties files for an object via the mixed-mode route
 * (ADT when the cached capability allows reads, otherwise ICF fallback — Q1:
 * route is decided from the recorded profile, no runtime fallback).
 */
async function runPullTextpool(objectName: string, type: string | undefined, opts: PullOptions): Promise<PullResult> {
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

  return {
    data: { object: objectName, type: objType, route, entries, written, skipped, failed },
    human: `Pulled textpool for ${objType} ${objectName} (route: ${route})`,
  };
}

/** 014: load the active system name for route decisions. */
async function loadProjectConfig(): Promise<{ systemName: string }> {
  const { loadConfig } = await import('../config/project-config.js');
  const cfg = await loadConfig();
  return { systemName: cfg.systemName };
}

/** 014: pull a DDIC object via ICF GET /ddic/<type>/<name> and write the local JSON. */
async function runPullDdic(objectName: string, type: DdicSupportedType, opts: PullOptions): Promise<PullResult> {
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
    return {
      data: { object: objectName, type, entries: [{ file: relPath, status: 'skipped' }], written: [], skipped: [relPath], failed: [] },
      human: `Skipped ${type} ${objectName} (file already exists: ${relPath})`,
    };
  }

  await writeDdicJson(targetPath, local);

  return {
    data: {
      object: objectName,
      type,
      entries: [{ file: relPath, status: 'written' }],
      written: [relPath],
      skipped: [],
      failed: [],
    },
    human: `Pulled ${type} ${objectName} to ${relPath}`,
  };
}

/** 014: narrow an arbitrary type string to the supported DDIC types. */
function isDdicSupportedType(t: string): t is DdicSupportedType {
  return (DDIC_SUPPORTED_TYPES as readonly string[]).includes(t);
}

/** 015: CLI object type → Version Management (VRSD) object type for remote pulls. */
const VERSION_SOURCE_TYPES: Record<string, string> = {
  PROG: 'REPS',
  INTF: 'INTF',
  CLAS: 'CLSD',
};

/** 015: pull the active (00000) source of an object as transported to a remote system. */
async function runPullRemote(objectName: string, type: string | undefined, remoteId: string, opts: PullOptions): Promise<PullResult> {
  const objType = (type ?? 'PROG').toUpperCase();
  const vrsdType = VERSION_SOURCE_TYPES[objType];
  if (!vrsdType) {
    throw new CliError('TYPE_NOT_SUPPORTED', `Remote pull not supported for object type ${objType}`, {
      type: objType,
      nextSteps: [`Supported types: ${Object.keys(VERSION_SOURCE_TYPES).join(', ')}.`],
      example: `abap pull ${objectName} --remote PRD`,
    });
  }
  // Backend validates the same shape (RFC destination = TMSADM@<id>.DOMAIN_<id>).
  const remoteUpper = remoteId.trim().toUpperCase();
  if (remoteUpper.length > 60 || !/^[A-Z0-9@._-]+$/.test(remoteUpper)) {
    throw new CliError('INVALID_ARGUMENT', `Invalid remote system ID '${remoteId}'`, {
      example: `abap pull ${objectName} --remote PRD`,
    });
  }

  const icf = await IcfClient.create();
  const resp = await icf.getRemoteSource<{ objectType: string; objectName: string; version: string; source: string }>(
    vrsdType,
    objectName,
    remoteUpper,
  );
  if (resp.status !== 'success' || !resp.data) {
    // REMOTE_VERSION_NOT_FOUND normalizes to OBJECT_NOT_FOUND (exit 8, NOT_FOUND family).
    const rawCode = resp.error?.code ?? 'SAP_ERROR';
    const code: ErrorCode = rawCode === 'REMOTE_VERSION_NOT_FOUND' ? 'OBJECT_NOT_FOUND' : (rawCode as ErrorCode);
    throw new CliError(code, resp.error?.message ?? `Failed to pull remote ${objType} ${objectName}`, {
      object: objectName,
      type: objType,
      nextSteps: [
        'Verify the object was transported to the remote system.',
        'Verify the remote system ID (RFC destination) is correct and reachable.',
      ],
      example: `abap pull ${objectName} --remote ${remoteUpper}`,
    });
  }

  const { source, version } = resp.data;
  // The remote source is a single blob; write it under the object's standard
  // abap-file-format filename (e.g. zprog.prog.abap / zcl_x.clas.abap).
  const filename = buildFilename(objectName, objType, undefined, '.abap');
  const relPath = path.join(opts.dir, objectDirName(objectName), filename);
  const targetPath = path.resolve(process.cwd(), relPath);

  if (await fileExists(targetPath) && !opts.overwrite && !opts.skipExisting) {
    throw new CliError('OVERWRITE_REQUIRED', `${relPath} already exists; use --overwrite to replace it`, {
      file: relPath,
      nextSteps: ['Re-run with --overwrite to replace the existing file.'],
      example: `abap pull ${objectName} --remote ${remoteUpper} --overwrite`,
    });
  }
  if (await fileExists(targetPath) && opts.skipExisting) {
    return {
      data: {
        object: objectName,
        type: objType,
        remote: remoteUpper,
        version,
        entries: [{ file: relPath, status: 'skipped' }],
        written: [],
        skipped: [relPath],
        failed: [],
      },
      human: `Skipped ${objType} ${objectName} (file already exists: ${relPath})`,
    };
  }

  await writeAbapFile(targetPath, source);

  return {
    data: {
      object: objectName,
      type: objType,
      remote: remoteUpper,
      version,
      entries: [{ file: relPath, status: 'written' }],
      written: [relPath],
      skipped: [],
      failed: [],
    },
    human: `Pulled ${objType} ${objectName} from ${remoteUpper} (version ${version}) to ${relPath}`,
  };
}

/** Enumerate a package (search + packageName filter) and pull each object (FR-024). */
async function runPackagePull(client: AdtClientWrapper, opts: PullOptions): Promise<PullResult> {
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

  return {
    data: {
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
    human: `Pulled ${written.length} object(s) from ${pkg}${truncated ? ' (truncated)' : ''}.`,
  };
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
