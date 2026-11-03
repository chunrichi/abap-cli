/**
 * JOBD (application job definition, SM36) pull via the ICF `/jobd/<name>` route.
 *
 * GET → jobd-v1 wire document → local jobd-v1 → write `<dir>/<name>.jobd.json`
 * (single file, no sidecar).
 */
import * as path from 'node:path';
import { IcfClient } from '../../clients/icf-client.js';
import { CliError } from '../../output/json.js';
import type { ErrorCode } from '../../output/error-codes.js';
import { buildFilename } from '../../formats/file-resolver.js';
import { fileExists } from '../../formats/abap-source.js';
import { jobdArtifact, type JobdWire } from '../../formats/jobd/json.js';
import { toOutputPath, normalizePullData } from '../../core/path-output.js';
import type { PullOptions, PullResult } from './pull-shared.js';

export async function runPullJobd(objectName: string, opts: PullOptions): Promise<PullResult> {
  const upper = objectName.trim().toUpperCase();
  const icf = await IcfClient.create();
  const resp = await icf.getJobd<JobdWire>(upper);
  if (resp.status !== 'success' || !resp.data) {
    if (resp.error?.code === 'JOBD_NOT_FOUND') {
      throw new CliError('OBJECT_NOT_FOUND', `JOBD ${upper} does not exist`, {
        object: upper,
        type: 'JOBD',
        nextSteps: ['Verify the job definition exists in the target system (SM36).'],
      });
    }
    throw new CliError((resp.error?.code ?? 'SAP_ERROR') as ErrorCode, resp.error?.message ?? `Failed to pull JOBD ${upper}`, {
      object: upper,
      type: 'JOBD',
    });
  }

  const local = jobdArtifact.fromWire(resp.data);
  const filename = buildFilename(upper, 'JOBD', 'main', '.json');
  const relPath = path.join(opts.dir, filename);
  const targetPath = path.resolve(process.cwd(), relPath);

  if (await fileExists(targetPath) && !opts.overwrite && !opts.skipExisting) {
    const outPath = toOutputPath(relPath);
    throw new CliError('OVERWRITE_REQUIRED', `${outPath} already exists; use --overwrite to replace it`, {
      file: outPath,
      nextSteps: ['Re-run with --overwrite to replace the existing file.'],
      example: `abap pull ${upper} --type JOBD --overwrite`,
    });
  }
  if (await fileExists(targetPath) && opts.skipExisting) {
    const outPath = toOutputPath(relPath);
    return {
      data: normalizePullData({ object: upper, type: 'JOBD', entries: [{ file: outPath, status: 'skipped' }], written: [], skipped: [outPath], failed: [] }),
      human: `Skipped JOBD ${upper} (file already exists: ${outPath})`,
    };
  }

  await jobdArtifact.write(targetPath, local);
  const outPath = toOutputPath(relPath);
  return {
    data: normalizePullData({
      object: upper,
      type: 'JOBD',
      entries: [{ file: outPath, status: 'written' }],
      written: [outPath],
      skipped: [],
      failed: [],
    }),
    human: `Pulled JOBD ${upper} to ${outPath}`,
  };
}
