/**
 * VIEW (DDIC database view) pull flow via the ICF `/ddic/view/<name>` route.
 *
 * GET → view-v1 wire document → local view-v1 → write
 * `<dir>/<name>.view.json` (single file, no sidecar).
 */
import * as path from 'node:path';
import { IcfClient } from '../../clients/icf-client.js';
import { CliError } from '../../output/json.js';
import type { ErrorCode } from '../../output/error-codes.js';
import { buildFilename } from '../../formats/file-resolver.js';
import { fileExists } from '../../formats/abap-source.js';
import { viewArtifact, type ViewWire } from '../../formats/view/json.js';
import { toOutputPath, normalizePullData } from '../../core/path-output.js';
import type { PullOptions, PullResult } from './pull-shared.js';

export async function runPullView(objectName: string, opts: PullOptions): Promise<PullResult> {
  const upper = objectName.trim().toUpperCase();
  const icf = await IcfClient.create();
  const resp = await icf.getDdic<Record<string, unknown>>('view', upper);
  if (resp.status !== 'success' || !resp.data) {
    const rawCode = resp.error?.code ?? 'SAP_ERROR';
    const code: ErrorCode = rawCode === 'DDIC_OBJECT_NOT_FOUND' ? 'OBJECT_NOT_FOUND' : (rawCode as ErrorCode);
    throw new CliError(code, resp.error?.message ?? `Failed to pull VIEW ${upper}`, {
      object: upper,
      type: 'VIEW',
      nextSteps: [
        'Verify the object exists in the target system.',
        'Run `abap search <name>` to confirm the object name and type.',
      ],
    });
  }

  const local = viewArtifact.fromWire(resp.data as unknown as ViewWire);
  const filename = buildFilename(upper, 'VIEW', 'main', '.json');
  const relPath = path.join(opts.dir, filename);
  const targetPath = path.resolve(process.cwd(), relPath);

  if (await fileExists(targetPath) && !opts.overwrite && !opts.skipExisting) {
    const outPath = toOutputPath(relPath);
    throw new CliError('OVERWRITE_REQUIRED', `${outPath} already exists; use --overwrite to replace it`, {
      file: outPath,
      nextSteps: ['Re-run with --overwrite to replace the existing file.'],
      example: `abap pull ${upper} --type VIEW --overwrite`,
    });
  }
  if (await fileExists(targetPath) && opts.skipExisting) {
    const outPath = toOutputPath(relPath);
    return {
      data: normalizePullData({ object: upper, type: 'VIEW', entries: [{ file: outPath, status: 'skipped' }], written: [], skipped: [outPath], failed: [] }),
      human: `Skipped VIEW ${upper} (file already exists: ${outPath})`,
    };
  }

  await viewArtifact.write(targetPath, local);
  const outPath = toOutputPath(relPath);
  return {
    data: normalizePullData({
      object: upper,
      type: 'VIEW',
      entries: [{ file: outPath, status: 'written' }],
      written: [outPath],
      skipped: [],
      failed: [],
    }),
    human: `Pulled VIEW ${upper} to ${outPath}`,
  };
}
