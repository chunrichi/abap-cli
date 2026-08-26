import * as path from 'path';
import * as fs from 'fs/promises';
import { AdtClientWrapper } from '../clients/adt-client.js';
import { IcfClient } from '../clients/icf-client.js';
import { objectDirName, buildFilename } from '../formats/file-resolver.js';
import { folderFor } from '../formats/type-folder.js';
import { fileExists, writeAbapFile } from '../formats/abap-source.js';
import { writeDdicJson, DDIC_SUPPORTED_TYPES, wireToLocal, type DdicSupportedType } from '../dictionary/ddic-json.js';
import { writeHttpJson, wireToLocal as httpWireToLocal, type HttpWirePayload } from '../dictionary/http-json.js';
import { parseTextpoolProperties, serializeTextpoolProperties, type TextElementCategory } from '../formats/textpool.js';
import { routeTextpool } from '../textpool/textpool-router.js';
import { strategyFor } from '../formats/pull-strategy.js';
import { CliError } from '../output/json.js';
import type { ErrorCode } from '../output/error-codes.js';
import { resolveObject } from '../core/resolve.js';
import { toOutputPath, normalizePullData } from '../core/path-output.js';
import { showTransport } from './transport-ops.js';
import { SEARCH_RESULT_LIMIT } from '../core/limits.js';

export interface PullOptions {
  type?: string;
  package?: string;
  /** T4.2: pull all objects bound to a transport request (mutually exclusive with object name and --package). */
  tr?: string;
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
  // T4.2: --tr selector — mutually exclusive with object name and --package.
  if (opts.tr !== undefined) {
    const selectorCount = Number(Boolean(objectName)) + Number(Boolean(opts.package)) + Number(opts.tr !== undefined);
    if (selectorCount > 1) {
      throw new CliError(
        'INVALID_ARGUMENT',
        '--tr cannot be combined with an object name or --package',
        {
          nextSteps: ['Choose exactly one pull selector: an object name, --package, or --tr.'],
          example: 'abap pull --tr NDK123456',
        },
      );
    }
    if (!opts.tr.trim()) {
      throw new CliError('INVALID_ARGUMENT', '--tr must not be empty', {
        example: 'abap pull --tr NDK123456',
      });
    }
    const client = await AdtClientWrapper.create();
    return runTransportPull(client, opts.tr.trim(), opts);
  }

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
  // 022: HTTP service also routes to the self-built ICF service.
  const typeUpper = opts.type?.toUpperCase();
  if (typeUpper === 'HTTP') {
    return runPullHttp(objectName, opts);
  }
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
    data: normalizePullData({ object: object.name, type: object.type, entries: result.entries, written: result.written, skipped: result.skipped, failed: result.failed }),
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
    const relPath = path.join(opts.dir, folderFor(objType), objectDirName(objectName), filename);
    const targetPath = path.resolve(process.cwd(), relPath);

    if (await fileExists(targetPath) && !opts.overwrite && !opts.skipExisting) {
      const outPath = toOutputPath(relPath);
      throw new CliError('OVERWRITE_REQUIRED', `${outPath} already exists; use --overwrite to replace it`, {
        file: outPath,
        nextSteps: ['Re-run with --overwrite to replace the existing file.'],
        example: `abap pull ${objectName} --textpool --overwrite`,
      });
    }
    if (await fileExists(targetPath) && opts.skipExisting) {
      const outPath = toOutputPath(relPath);
      entries.push({ object: objectName, type: objType, status: 'skipped', files: [outPath] });
      skipped.push(outPath);
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
        const outPath = toOutputPath(relPath);
        entries.push({ object: objectName, type: objType, status: 'failed', code, detail: resp.error?.message, files: [outPath] });
        failed.push(outPath);
        continue;
      }
      // Reuse the shared properties serializer so ADT/ICF output is identical (FR-023).
      content = serializeTextpoolProperties(
        fileCat,
        (resp.data.elements ?? []).map((e) => ({ id: e.id, text: e.text })),
      );
    }

    await writeAbapFile(targetPath, content);
    const outPath = toOutputPath(relPath);
    entries.push({ object: objectName, type: objType, status: 'written', files: [outPath] });
    written.push(outPath);
  }

  return {
    data: normalizePullData({ object: objectName, type: objType, route, entries, written, skipped, failed }),
    human: `Pulled textpool for ${objType} ${objectName} (route: ${route})`,
  };
}

/** 014: load the active system name for route decisions. */
async function loadProjectConfig(): Promise<{ systemName: string }> {
  const { loadConfig } = await import('../config/project-config.js');
  const cfg = await loadConfig();
  return { systemName: cfg.systemName };
}

/** 014: pull a DDIC object via ICF GET /ddic/<type>/<name> and write the local JSON.
 *  024: TABL/STRU switch to the abap-file-format three-piece layout
 *  (main + ddic + settings.json) when the wire carries canonical strings from
 *  zcl_abap_vibe_tabl_format. DOMA/DTEL stay on the flat single-file layout. */
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

  // 024: TABL/STRU three-piece layout when wire carries canonical strings.
// When the wire has ddicSource but is missing mainJson, fall through to the
// flat wire path (legacy data) — writePullDdicTabl will detect the partial
// state and reject with TABL_ARTIFACT_INCOMPLETE.
  if ((type === 'TABL' || type === 'STRU') && typeof resp.data.mainJson === 'string' && typeof resp.data.ddicSource === 'string') {
    return writePullDdicTabl(objectName, type, resp.data as unknown as Parameters<typeof wireToLocal>[1], opts);
  }
  if ((type === 'TABL' || type === 'STRU') && (typeof resp.data.mainJson !== 'undefined' || typeof resp.data.ddicSource !== 'undefined')) {
    // Wire carries SOME three-piece strings but not all — partial state must
    // not be silently downgraded to the flat layout.
    throw new CliError('TABL_ARTIFACT_INCOMPLETE', `TABL/STRU wire for ${type} ${objectName} carries partial abap-file-format three-piece data (mainJson=${typeof resp.data.mainJson}, ddicSource=${typeof resp.data.ddicSource})`, {
      object: objectName,
      type,
      nextSteps: [
        'Verify the ICF service is version 0.5.0 or newer (run `abap doctor`).',
        'Re-deploy the ICF bundle so zcl_abap_vibe_tabl_format is active.',
      ],
    });
  }

  const local = wireToLocal(type, resp.data as unknown as Parameters<typeof wireToLocal>[1]);
  // DDIC files now sit under their type subdirectory (Q5=B: local convention).
  // Was previously flat `src/<name>.<type>.json` — see wiki/abap-file-format-export.md.
  const filename = buildFilename(objectName, type, 'main', '.json');
  const relPath = path.join(opts.dir, folderFor(type), filename);
  const targetPath = path.resolve(process.cwd(), relPath);

  if (await fileExists(targetPath) && !opts.overwrite && !opts.skipExisting) {
    const outPath = toOutputPath(relPath);
    throw new CliError('OVERWRITE_REQUIRED', `${outPath} already exists; use --overwrite to replace it`, {
      file: outPath,
      nextSteps: ['Re-run with --overwrite to replace the existing file.'],
      example: `abap pull ${objectName} --type ${type} --overwrite`,
    });
  }
  if (await fileExists(targetPath) && opts.skipExisting) {
    const outPath = toOutputPath(relPath);
    return {
      data: normalizePullData({ object: objectName, type, entries: [{ file: outPath, status: 'skipped' }], written: [], skipped: [outPath], failed: [] }),
      human: `Skipped ${type} ${objectName} (file already exists: ${outPath})`,
    };
  }

  await writeDdicJson(targetPath, local);
  const outPath = toOutputPath(relPath);

  return {
    data: normalizePullData({
      object: objectName,
      type,
      entries: [{ file: outPath, status: 'written' }],
      written: [outPath],
      skipped: [],
      failed: [],
    }),
    human: `Pulled ${type} ${objectName} to ${outPath}`,
  };
}

/** 024: write the abap-file-format three-piece layout for TABL/STRU.
 *  Always requires mainJson + ddicSource; settings.json is written when present
 *  (TABL yes, STRU no — zcl_abap_vibe_tabl_format controls). */
async function writePullDdicTabl(
  objectName: string,
  type: DdicSupportedType,
  wire: Parameters<typeof wireToLocal>[1],
  opts: PullOptions,
): Promise<PullResult> {
  const { extractTablArtifactWire } = await import('../dictionary/ddic-json.js');
  const { parseTablDdic, tablArtifactPaths } = await import('../dictionary/tabl-artifact.js');
  const pieces = extractTablArtifactWire(wire);
  if (!pieces) {
    throw new CliError('TABL_ARTIFACT_INCOMPLETE', `TABL/STRU wire for ${type} ${objectName} is missing mainJson or ddicSource`, {
      object: objectName,
      type,
      nextSteps: [
        'Verify the ICF service is version 0.5.0 or newer (run `abap doctor`).',
        'Re-deploy the ICF bundle so zcl_abap_vibe_tabl_format is active.',
      ],
    });
  }

  // Validate DDL up front so we never write partial files.
  try {
    parseTablDdic(pieces.ddicSource);
  } catch (error) {
    throw new CliError('TABL_DDL_INVALID', error instanceof Error ? error.message : `Invalid Table and Structure DDL for ${type} ${objectName}`, {
      object: objectName,
      type,
      nextSteps: [
        'Inspect the DDL source in the error details.',
        'Report the object to the abap maintainers if the DDL looks correct.',
      ],
    });
  }

  const objectLower = objectName.toLowerCase();
  const baseName = `${objectLower}.${type.toLowerCase()}`;
  const folder = path.join(opts.dir, folderFor(type));
  const mainRel = path.join(folder, `${baseName}.json`);
  const ddicRel = path.join(folder, `${baseName}.ddic`);
  const settingsRel = pieces.hasSettings && pieces.settingsJson !== undefined
    ? path.join(folder, `${baseName}.settings.json`)
    : undefined;
  const mainAbs = path.resolve(process.cwd(), mainRel);
  const ddicAbs = path.resolve(process.cwd(), ddicRel);
  const settingsAbs = settingsRel ? path.resolve(process.cwd(), settingsRel) : undefined;
  const allFiles = [mainRel, ddicRel, ...(settingsRel ? [settingsRel] : [])];
  const allAbs = [mainAbs, ddicAbs, ...(settingsAbs ? [settingsAbs] : [])];

  const existing = await Promise.all(allAbs.map(fileExists));
  const anyExists = existing.some(Boolean);
  if (anyExists && !opts.overwrite && !opts.skipExisting) {
    const conflicting = allAbs.filter((_, idx) => existing[idx]).map((_, idx) => allFiles[idx]!);
    const conflictingOut = conflicting.map(toOutputPath);
    throw new CliError('OVERWRITE_REQUIRED', `${conflictingOut.join(', ')} already exists; use --overwrite to replace`, {
      file: conflictingOut.join(', '),
      nextSteps: ['Re-run with --overwrite to replace the existing files.'],
      example: `abap pull ${objectName} --type ${type} --overwrite`,
    });
  }
  if (anyExists && opts.skipExisting) {
    const skipped = allFiles.filter((_, idx) => existing[idx]);
    const skippedOut = skipped.map(toOutputPath);
    return {
      data: normalizePullData({
        object: objectName,
        type,
        entries: skippedOut.map((file) => ({ file, status: 'skipped' })),
        written: [],
        skipped: skippedOut,
        failed: [],
        layout: 'tabl-aff-three-piece',
      }),
      human: `Skipped ${type} ${objectName} (files already exist: ${skippedOut.join(', ')})`,
    };
  }

  // Cross-check tabl-artifact helper (sanity): paths() should agree on casing.
  const helperPaths = tablArtifactPaths(mainAbs);
  if (helperPaths.main !== mainAbs || helperPaths.ddic !== ddicAbs) {
    throw new CliError('TABL_ARTIFACT_INCOMPLETE', `Tabl artifact path helper disagrees with computed paths for ${objectName}`, {
      object: objectName,
      type,
    });
  }

  await fs.mkdir(path.dirname(mainAbs), { recursive: true });
  await fs.writeFile(mainAbs, pieces.mainJson.endsWith('\n') ? pieces.mainJson : pieces.mainJson + '\n', 'utf-8');
  await fs.writeFile(ddicAbs, pieces.ddicSource.endsWith('\n') ? pieces.ddicSource : pieces.ddicSource + '\n', 'utf-8');
  if (settingsAbs && pieces.settingsJson !== undefined) {
    await fs.writeFile(settingsAbs, pieces.settingsJson.endsWith('\n') ? pieces.settingsJson : pieces.settingsJson + '\n', 'utf-8');
  }

  const mainOut = toOutputPath(mainRel);
  const ddicOut = toOutputPath(ddicRel);
  const settingsOut = settingsRel ? toOutputPath(settingsRel) : undefined;
  const writtenOut = settingsOut ? [mainOut, ddicOut, settingsOut] : [mainOut, ddicOut];

  return {
    data: normalizePullData({
      object: objectName,
      type,
      entries: writtenOut.map((file) => ({ file, status: 'written' })),
      written: writtenOut,
      skipped: [],
      failed: [],
      layout: settingsRel ? 'tabl-aff-three-piece' : 'tabl-aff-two-piece',
      warnings: Array.isArray(wire.warnings) ? wire.warnings : undefined,
    }),
    human: settingsRel
      ? `Pulled ${type} ${objectName} to ${mainOut}, ${ddicOut}, ${settingsOut}`
      : `Pulled ${type} ${objectName} to ${mainOut}, ${ddicOut}`,
  };
}

/** 022: pull an HTTP service via ICF GET /http/<name> and write the local JSON. */
async function runPullHttp(objectName: string, opts: PullOptions): Promise<PullResult> {
  const icf = await IcfClient.create();
  const resp = await icf.getHttp<HttpWirePayload>(objectName);
  if (resp.status !== 'success' || !resp.data) {
    // HTTP_OBJECT_NOT_FOUND normalizes to OBJECT_NOT_FOUND (exit 8, NOT_FOUND family).
    const rawCode = resp.error?.code ?? 'SAP_ERROR';
    const code: ErrorCode = rawCode === 'HTTP_OBJECT_NOT_FOUND' ? 'OBJECT_NOT_FOUND' : (rawCode as ErrorCode);
    throw new CliError(code, resp.error?.message ?? `Failed to pull HTTP ${objectName}`, {
      object: objectName,
      type: 'HTTP',
      nextSteps: [
        'Verify the HTTP service exists in the target system.',
        'Run `abap search <name>` to confirm the object name.',
      ],
    });
  }

  const local = httpWireToLocal(resp.data);
  // HTTP files live under <rootDir>/http/<name>.http.json (Q5=B: local convention).
  const filename = buildFilename(objectName, 'HTTP', 'main', '.json');
  const relPath = path.join(opts.dir, folderFor('HTTP'), filename);
  const targetPath = path.resolve(process.cwd(), relPath);

  if (await fileExists(targetPath) && !opts.overwrite && !opts.skipExisting) {
    const outPath = toOutputPath(relPath);
    throw new CliError('OVERWRITE_REQUIRED', `${outPath} already exists; use --overwrite to replace it`, {
      file: outPath,
      nextSteps: ['Re-run with --overwrite to replace the existing file.'],
      example: `abap pull ${objectName} --type HTTP --overwrite`,
    });
  }
  if (await fileExists(targetPath) && opts.skipExisting) {
    const outPath = toOutputPath(relPath);
    return {
      data: normalizePullData({ object: objectName, type: 'HTTP', entries: [{ file: outPath, status: 'skipped' }], written: [], skipped: [outPath], failed: [] }),
      human: `Skipped HTTP ${objectName} (file already exists: ${outPath})`,
    };
  }

  await writeHttpJson(targetPath, local);
  const outPath = toOutputPath(relPath);

  return {
    data: normalizePullData({
      object: objectName,
      type: 'HTTP',
      entries: [{ file: outPath, status: 'written' }],
      written: [outPath],
      skipped: [],
      failed: [],
    }),
    human: `Pulled HTTP ${objectName} to ${outPath}`,
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
  const relPath = path.join(opts.dir, folderFor(objType), objectDirName(objectName), filename);
  const targetPath = path.resolve(process.cwd(), relPath);

  if (await fileExists(targetPath) && !opts.overwrite && !opts.skipExisting) {
    const outPath = toOutputPath(relPath);
    throw new CliError('OVERWRITE_REQUIRED', `${outPath} already exists; use --overwrite to replace it`, {
      file: outPath,
      nextSteps: ['Re-run with --overwrite to replace the existing file.'],
      example: `abap pull ${objectName} --remote ${remoteUpper} --overwrite`,
    });
  }
  if (await fileExists(targetPath) && opts.skipExisting) {
    const outPath = toOutputPath(relPath);
    return {
      data: normalizePullData({
        object: objectName,
        type: objType,
        remote: remoteUpper,
        version,
        entries: [{ file: outPath, status: 'skipped' }],
        written: [],
        skipped: [outPath],
        failed: [],
      }),
      human: `Skipped ${objType} ${objectName} (file already exists: ${outPath})`,
    };
  }

  await writeAbapFile(targetPath, source);
  const outPath = toOutputPath(relPath);

  return {
    data: normalizePullData({
      object: objectName,
      type: objType,
      remote: remoteUpper,
      version,
      entries: [{ file: outPath, status: 'written' }],
      written: [outPath],
      skipped: [],
      failed: [],
    }),
    human: `Pulled ${objType} ${objectName} from ${remoteUpper} (version ${version}) to ${outPath}`,
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
    data: normalizePullData({
      package: pkg,
      entries,
      written,
      skipped,
      failed,
      page,
      limit,
      truncated,
      ...(truncated ? { hint: `Result truncated. Use --page ${page + 1} to fetch more.` } : {}),
    }),
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

  // abap-file-format layout: one directory per object under <typeFolder>/<opts.dir>.
  const objectDir = objectDirName(object.name);
  const typeFolder = folderFor(object.type);

  for (const file of files) {
    await writeOne(await file.content(), file.filename);
  }
  return { entries, written, skipped, failed };

  /** Write one file with exists/skip/overwrite conflict handling. */
  async function writeOne(content: string, filename: string): Promise<void> {
    const filePath = path.join(opts.dir, typeFolder, objectDir, filename);
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
        const outPath = toOutputPath(filePath);
        throw new CliError(
          'OVERWRITE_REQUIRED',
          `Local file ${outPath} differs from SAP; refusing to overwrite.`,
          {
            details: { file: outPath, object: object.name },
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
    const outPath = toOutputPath(filePath);
    entries.push({ object: object.name, type: object.type, status: 'written', files: [outPath] });
    written.push(outPath);
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

/**
 * T4.2: pull every object bound to a transport request.
 * Iterates direct objects + nested task objects, deduplicates,
 * routes each through the standard pull pipeline.
 */
async function runTransportPull(client: AdtClientWrapper, requestNumber: string, opts: PullOptions): Promise<PullResult> {
  const transport = await showTransport(client, requestNumber);
  const seen = new Set<string>();
  const ordered: { name: string; type: string }[] = [];

  for (const obj of transport.objects) {
    const key = `${obj.type}::${obj.name}`;
    if (!seen.has(key)) {
      seen.add(key);
      ordered.push({ name: obj.name, type: obj.type });
    }
  }
  for (const task of transport.tasks) {
    for (const obj of task.objects) {
      const key = `${obj.type}::${obj.name}`;
      if (!seen.has(key)) {
        seen.add(key);
        ordered.push({ name: obj.name, type: obj.type });
      }
    }
  }

  const entries: PullEntry[] = [];
  const written: string[] = [];
  const skipped: string[] = [];
  let pulled = 0;
  let failed = 0;

  for (const item of ordered) {
    try {
      // HTTP service — ICF route.
      if (item.type === 'HTTP') {
        const res = await runPullHttp(item.name, opts);
        const entry: PullEntry = { object: item.name, type: item.type, status: 'written' };
        entries.push(entry);
        written.push(item.name);
        pulled++;
        continue;
      }
      // DDIC — ICF route.
      const ddicType = item.type.toUpperCase();
      if (isDdicSupportedType(ddicType)) {
        const res = await runPullDdic(item.name, ddicType, opts);
        const entry: PullEntry = { object: item.name, type: item.type, status: 'written' };
        entries.push(entry);
        written.push(item.name);
        pulled++;
        continue;
      }
      // Source object — ADT route.
      const object = await resolveObject(client, item.name, item.type);
      const result = await pullObject(client, object, opts);
      entries.push({
        object: object.name,
        type: object.type,
        status: result.failed.length > 0 ? 'failed' : 'written',
        ...(result.failed.length > 0 ? { detail: result.failed[0] } : {}),
      });
      written.push(...result.written);
      skipped.push(...result.skipped);
      if (result.failed.length > 0) failed++;
      else pulled++;
    } catch (error: unknown) {
      const code = error instanceof CliError ? error.code : 'PULL_FAILED';
      const detail = error instanceof Error ? error.message : String(error);
      entries.push({ object: item.name, type: item.type, status: 'failed', code, detail });
      failed++;
    }
  }

  const data: Record<string, unknown> = normalizePullData({
    transport: requestNumber,
    requested: ordered.length,
    pulled,
    failed,
    deduplicated: transport.deduplicated,
    entries,
    written,
    skipped,
  });
  if (failed > 0) {
    data.partial = true;
  }
  const human = [
    `Pulled ${pulled}/${ordered.length} objects from transport ${requestNumber}` + (failed > 0 ? ` (${failed} failed)` : ''),
    ...written.map((f) => `  wrote ${f}`),
  ].join('\n');
  return { data, human };
}
