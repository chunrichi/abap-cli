/**
 * PR5 (B1): NROB (number range object) pull flow via the ICF `/ddic/nrob/<name>`
 * route. NROB has no abap-adt-api endpoint, so this is the only pull path
 * (no channel-detect — always ICF).
 */
import * as path from 'node:path';
import { IcfClient } from '../../clients/icf-client.js';
import { CliError } from '../../output/json.js';
import type { ErrorCode } from '../../output/error-codes.js';
import { buildFilename } from '../../formats/file-resolver.js';
import { folderFor } from '../../formats/type-folder.js';
import { fileExists } from '../../formats/abap-source.js';
import { wireToLocal, writeNrobJson } from '../../formats/nrob/json.js';
import { toOutputPath, normalizePullData } from '../../core/path-output.js';
import type { PullOptions, PullResult } from './pull-shared.js';
import { registerPullHandler } from '../../types/registry.js';

export async function runPullNrob(objectName: string, opts: PullOptions): Promise<PullResult> {
  const upper = objectName.trim().toUpperCase();
  const icf = await IcfClient.create();
  const resp = await icf.getDdic<Record<string, unknown>>('nrob', upper);
  if (resp.status !== 'success' || !resp.data) {
    const rawCode = resp.error?.code ?? 'SAP_ERROR';
    const code: ErrorCode = rawCode === 'DDIC_OBJECT_NOT_FOUND' ? 'OBJECT_NOT_FOUND' : (rawCode as ErrorCode);
    throw new CliError(code, resp.error?.message ?? `Failed to pull NROB ${upper}`, {
      object: upper,
      type: 'NROB',
      nextSteps: [
        'Verify the object exists in the target system.',
        'Run `abap search <name>` to confirm the object name and type.',
      ],
    });
  }

  const local = wireToLocal(resp.data);
  const filename = buildFilename(upper, 'NROB', 'main', '.json');
  const relPath = path.join(opts.dir, folderFor('NROB'), filename);
  const targetPath = path.resolve(process.cwd(), relPath);

  if (await fileExists(targetPath) && !opts.overwrite && !opts.skipExisting) {
    const outPath = toOutputPath(relPath);
    throw new CliError('OVERWRITE_REQUIRED', `${outPath} already exists; use --overwrite to replace it`, {
      file: outPath,
      nextSteps: ['Re-run with --overwrite to replace the existing file.'],
      example: `abap pull ${upper} --type NROB --overwrite`,
    });
  }
  if (await fileExists(targetPath) && opts.skipExisting) {
    const outPath = toOutputPath(relPath);
    return {
      data: normalizePullData({ object: upper, type: 'NROB', entries: [{ file: outPath, status: 'skipped' }], written: [], skipped: [outPath], failed: [] }),
      human: `Skipped NROB ${upper} (file already exists: ${outPath})`,
    };
  }

  await writeNrobJson(targetPath, local);
  const outPath = toOutputPath(relPath);
  return {
    data: normalizePullData({
      object: upper,
      type: 'NROB',
      entries: [{ file: outPath, status: 'written' }],
      written: [outPath],
      skipped: [],
      failed: [],
    }),
    human: `Pulled NROB ${upper} to ${outPath}`,
  };
}

registerPullHandler('NROB', async ({ objectName, opts }) => {
  const r = await runPullNrob(objectName, opts as PullOptions);
  return { object: objectName.toUpperCase(), files: r.data.written as string[], channel: 'icf' };
});
