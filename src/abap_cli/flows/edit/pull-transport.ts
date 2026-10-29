/**
 * Pull transaction codes (SE93) via ICF GET /tran/<code> and write
 * the abap-file-format TRAN JSON to <rootDir>/tran/<name>.tran.json.
 */
import * as path from 'path';
import { IcfClient } from '../../clients/icf-client.js';
import { buildFilename } from '../../formats/file-resolver.js';
import { folderFor } from '../../formats/type-folder.js';
import { fileExists } from '../../formats/abap-source.js';
import { writeTranJson, wireToLocal as tranWireToLocal, type TranWirePayload } from '../../formats/transport/json.js';
import { CliError } from '../../output/json.js';
import type { ErrorCode } from '../../output/error-codes.js';
import { toOutputPath, normalizePullData } from '../../core/path-output.js';
import type { PullOptions, PullResult } from './pull-shared.js';

export async function runPullTran(objectName: string, opts: PullOptions): Promise<PullResult> {
  const icf = await IcfClient.create();
  const resp = await icf.getTran<TranWirePayload>(objectName);
  if (resp.status !== 'success' || !resp.data) {
    const rawCode = resp.error?.code ?? 'SAP_ERROR';
    const code: ErrorCode = rawCode === 'TRAN_OBJECT_NOT_FOUND' ? 'OBJECT_NOT_FOUND' : (rawCode as ErrorCode);
    throw new CliError(code, resp.error?.message ?? `Failed to pull TRAN ${objectName}`, {
      object: objectName,
      type: 'TRAN',
      nextSteps: [
        'Verify the transaction code exists in the target system.',
        'Run `abap tcode <code>` to confirm the code resolves.',
      ],
    });
  }

  const local = tranWireToLocal(resp.data);
  const filename = buildFilename(objectName, 'TRAN', 'main', '.json');
  const relPath = path.join(opts.dir, folderFor('TRAN'), filename);
  const targetPath = path.resolve(process.cwd(), relPath);

  if (await fileExists(targetPath) && !opts.overwrite && !opts.skipExisting) {
    const outPath = toOutputPath(relPath);
    throw new CliError('OVERWRITE_REQUIRED', `${outPath} already exists; use --overwrite to replace it`, {
      file: outPath,
      nextSteps: ['Re-run with --overwrite to replace the existing file.'],
      example: `abap pull ${objectName} --type TRAN --overwrite`,
    });
  }
  if (await fileExists(targetPath) && opts.skipExisting) {
    const outPath = toOutputPath(relPath);
    return {
      data: normalizePullData({ object: objectName, type: 'TRAN', entries: [{ file: outPath, status: 'skipped' }], written: [], skipped: [outPath], failed: [] }),
      human: `Skipped TRAN ${objectName} (file already exists: ${outPath})`,
    };
  }

  await writeTranJson(targetPath, local);
  const outPath = toOutputPath(relPath);

  return {
    data: normalizePullData({
      object: objectName,
      type: 'TRAN',
      entries: [{ file: outPath, status: 'written' }],
      written: [outPath],
      skipped: [],
      failed: [],
    }),
    human: `Pulled TRAN ${objectName} to ${outPath}`,
  };
}