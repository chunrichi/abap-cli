/**
 * Pull HTTP service definitions via ICF GET /http/<name> and write
 * the abap-file-format HTTP Service v1 JSON to the local <rootDir>/http/ folder.
 */
import * as path from 'path';
import { IcfClient } from '../../clients/icf-client.js';
import { buildFilename } from '../../formats/file-resolver.js';
import { folderFor } from '../../formats/type-folder.js';
import { fileExists } from '../../formats/abap-source.js';
import { writeHttpJson, wireToLocal as httpWireToLocal, type HttpWirePayload } from '../../formats/http/json.js';
import { CliError } from '../../output/json.js';
import type { ErrorCode } from '../../output/error-codes.js';
import { toOutputPath, normalizePullData } from '../../core/path-output.js';
import type { PullOptions, PullResult } from './pull-shared.js';

export async function runPullHttp(objectName: string, opts: PullOptions): Promise<PullResult> {
  const icf = await IcfClient.create();
  const resp = await icf.getHttp<HttpWirePayload>(objectName);
  if (resp.status !== 'success' || !resp.data) {
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