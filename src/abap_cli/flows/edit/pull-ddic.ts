/**
 * Pull DDIC objects (DOMA / DTEL / TABL / STRU) via the self-built ICF service.
 *
 * - DOMA / DTEL: single wire-flat `<name>.<type>.json` file under the type folder.
 * - TABL / STRU: abap-file-format three-piece layout (`.json` + `.ddic` +
 *   optional `.settings.json`) when the ICF wire carries the canonical
 *   `mainJson` + `ddicSource` strings; otherwise the flat fallback.
 */
import * as path from 'path';
import * as fs from 'fs/promises';
import { IcfClient } from '../../clients/icf-client.js';
import { buildFilename } from '../../formats/file-resolver.js';
import { folderFor } from '../../formats/type-folder.js';
import { fileExists } from '../../formats/abap-source.js';
import { writeDdicJson, wireToLocal, type DdicSupportedType } from '../../formats/ddic/json.js';
import { CliError } from '../../output/json.js';
import type { ErrorCode } from '../../output/error-codes.js';
import { toOutputPath, normalizePullData } from '../../core/path-output.js';
import type { PullOptions, PullResult } from './pull-shared.js';

export async function runPullDdic(objectName: string, type: DdicSupportedType, opts: PullOptions): Promise<PullResult> {
  const icf = await IcfClient.create();
  let resp;
  try {
    resp = await icf.getDdic<Record<string, unknown>>(type.toLowerCase(), objectName);
  } catch (err) {
    // 037 US4: SAP-side DDL parser bug surfaces as HTTP 500 with an ABAP
    // short dump carrying `abap.string(N)` (e.g. `abap.string(000000)` for
    // empty .INCLUDE fragments). Convert to a structured TABL_DDL_PARSE_FAILED
    // so the agent can recognise the failure mode and try an alternate path.
    // Non-TABL types fall through (DOMA/DTEL/STRU have no DDL parser layer).
    const details = err instanceof CliError ? err.details : undefined;
    const httpStatus = (details?.httpStatus as number | undefined) ?? 0;
    const sapBody = (details?.sapErrorBody as string | undefined) ?? '';
    const isDdlParserFailure = /abap\.string\(\d+\)/.test(sapBody);
    if (type === 'TABL' && httpStatus >= 500 && isDdlParserFailure) {
      throw new CliError(
        'TABL_DDL_PARSE_FAILED',
        `TABL ${objectName} pulled but its DDL source could not be parsed by the SAP DDL parser`,
        {
          object: objectName,
          type,
          details: { httpStatus, sapErrorBody: sapBody.slice(0, 400) },
          nextSteps: [
            'SAP-side DDL parser bug (CX_DD_DDL_PARSE_ERROR on abap.string(N)); pull of the .tabl.ddic source is blocked.',
            'Push the .tabl.json + .tabl.ddic sidecars with `abap push` — the create path uses the GOX_TABLE_STD API and does not re-parse the DDL.',
            'If the object is already in SAP, leave it; no round-trip is required.',
          ],
          example: `abap push src/tabl/${objectName.toLowerCase()}/${objectName.toLowerCase()}.tabl.json`,
        },
      );
    }
    throw err;
  }
  if (resp.status !== 'success' || !resp.data) {
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

  // TABL/STRU three-piece layout when wire carries canonical strings.
  if ((type === 'TABL' || type === 'STRU') && typeof resp.data.mainJson === 'string' && typeof resp.data.ddicSource === 'string') {
    return writePullDdicTabl(objectName, type, resp.data as unknown as Parameters<typeof wireToLocal>[1], opts);
  }
  if ((type === 'TABL' || type === 'STRU') && (typeof resp.data.mainJson !== 'undefined' || typeof resp.data.ddicSource !== 'undefined')) {
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

/** 024: write the abap-file-format three-piece layout for TABL/STRU. */
async function writePullDdicTabl(
  objectName: string,
  type: DdicSupportedType,
  wire: Parameters<typeof wireToLocal>[1],
  opts: PullOptions,
): Promise<PullResult> {
  const { extractTablArtifactWire } = await import('../../formats/ddic/json.js');
  const { parseTablDdic, tablArtifactPaths } = await import('../../formats/ddic/tabl-artifact.js');
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

export function isDdicSupportedType(t: string): t is DdicSupportedType {
  return ['DOMA', 'DTEL', 'TABL', 'STRU'].includes(t);
}