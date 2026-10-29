/**
 * PR5 (B1): ENQU (lock object) pull flow via the ICF `/ddic/enqu/<name>` route.
 *
 * Mirrors `pull-ddic.ts`: GET /ddic/enqu/<name> → wire → local AFF → write
 * `src/enqu/<lower>/<lower>.enqu.json`. Single-file shape (no sidecar — ENQU
 * has no DDL / settings split).
 */
import * as path from 'node:path';
import { IcfClient } from '../../clients/icf-client.js';
import { CliError } from '../../output/json.js';
import type { ErrorCode } from '../../output/error-codes.js';
import { buildFilename } from '../../formats/file-resolver.js';
import { folderFor } from '../../formats/type-folder.js';
import { fileExists } from '../../formats/abap-source.js';
import { wireToLocal, writeEnquJson } from '../../formats/enqu/json.js';
import { toOutputPath, normalizePullData } from '../../core/path-output.js';
import type { PullOptions, PullResult } from './pull-shared.js';
import { registerPullHandler } from '../../types/registry.js';

export async function runPullEnqu(objectName: string, opts: PullOptions): Promise<PullResult> {
  const upper = objectName.trim().toUpperCase();
  const icf = await IcfClient.create();
  const resp = await icf.getDdic<Record<string, unknown>>('enqu', upper);
  if (resp.status !== 'success' || !resp.data) {
    const rawCode = resp.error?.code ?? 'SAP_ERROR';
    const code: ErrorCode = rawCode === 'DDIC_OBJECT_NOT_FOUND' ? 'OBJECT_NOT_FOUND' : (rawCode as ErrorCode);
    throw new CliError(code, resp.error?.message ?? `Failed to pull ENQU ${upper}`, {
      object: upper,
      type: 'ENQU',
      nextSteps: [
        'Verify the object exists in the target system.',
        'Run `abap search <name>` to confirm the object name and type.',
      ],
    });
  }

  const local = wireToLocal(resp.data);
  const filename = buildFilename(upper, 'ENQU', 'main', '.json');
  const relPath = path.join(opts.dir, folderFor('ENQU'), filename);
  const targetPath = path.resolve(process.cwd(), relPath);

  if (await fileExists(targetPath) && !opts.overwrite && !opts.skipExisting) {
    const outPath = toOutputPath(relPath);
    throw new CliError('OVERWRITE_REQUIRED', `${outPath} already exists; use --overwrite to replace it`, {
      file: outPath,
      nextSteps: ['Re-run with --overwrite to replace the existing file.'],
      example: `abap pull ${upper} --type ENQU --overwrite`,
    });
  }
  if (await fileExists(targetPath) && opts.skipExisting) {
    const outPath = toOutputPath(relPath);
    return {
      data: normalizePullData({ object: upper, type: 'ENQU', entries: [{ file: outPath, status: 'skipped' }], written: [], skipped: [outPath], failed: [] }),
      human: `Skipped ENQU ${upper} (file already exists: ${outPath})`,
    };
  }

  await writeEnquJson(targetPath, local);
  const outPath = toOutputPath(relPath);
  return {
    data: normalizePullData({
      object: upper,
      type: 'ENQU',
      entries: [{ file: outPath, status: 'written' }],
      written: [outPath],
      skipped: [],
      failed: [],
    }),
    human: `Pulled ENQU ${upper} to ${outPath}`,
  };
}

registerPullHandler('ENQU', async ({ objectName, opts }) => {
  const r = await runPullEnqu(objectName, opts as PullOptions);
  return { object: objectName.toUpperCase(), files: r.data.written as string[], channel: 'icf' };
});
