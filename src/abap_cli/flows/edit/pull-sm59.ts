/**
 * SM59 (HTTP destination) pull via the ICF `/sm59/<name>` route.
 *
 * GET → wire document → local sm59-v1 document → write
 * `<dir>/<name>.sm59.json` (single file, no sidecar). Only HTTP destinations
 * (RFCTYPE='G') are supported; the SAP side rejects other types with
 * `SM59_TYPE_NOT_SUPPORTED`, which is surfaced as a validation error (exit 7).
 */
import * as path from 'node:path';
import { IcfClient } from '../../clients/icf-client.js';
import { CliError } from '../../output/json.js';
import type { ErrorCode } from '../../output/error-codes.js';
import { buildFilename } from '../../formats/file-resolver.js';
import { fileExists } from '../../formats/abap-source.js';
import { sm59Artifact, type Sm59Wire } from '../../formats/sm59/json.js';
import { toOutputPath, normalizePullData } from '../../core/path-output.js';
import type { PullOptions, PullResult } from './pull-shared.js';
import { validateSm59Name } from './sm59-shared.js';

export async function runPullSm59(objectName: string, opts: PullOptions): Promise<PullResult> {
  const upper = validateSm59Name(objectName);
  const icf = await IcfClient.create();
  const resp = await icf.getSm59<Sm59Wire>(upper);
  if (resp.status !== 'success' || !resp.data) {
    if (resp.error?.code === 'SM59_OBJECT_NOT_FOUND') {
      throw new CliError('OBJECT_NOT_FOUND', `SM59 ${upper} does not exist`, {
        object: upper,
        type: 'SM59',
        nextSteps: ['Verify the destination exists in the target system (transaction SM59).'],
        example: `abap pull ${upper} --type SM59`,
      });
    }
    if (resp.error?.code === 'SM59_TYPE_NOT_SUPPORTED') {
      throw new CliError(
        'SM59_TYPE_NOT_SUPPORTED',
        resp.error.message ?? `SM59 ${upper} is not an HTTP destination (RFCTYPE='G')`,
        {
          object: upper,
          type: 'SM59',
          details: resp.error.details,
          nextSteps: ['Only HTTP connections to external server (RFCTYPE=G) are supported by this type.'],
        },
      );
    }
    throw new CliError((resp.error?.code ?? 'SM59_READ_FAILED') as ErrorCode, resp.error?.message ?? `Failed to pull SM59 ${upper}`, {
      object: upper,
      type: 'SM59',
      details: resp.error?.details,
      nextSteps: ['Check that the bundled ICF service is deployed and its version matches the CLI.'],
    });
  }

  // Defensive: the route rejects non-HTTP destinations with
  // SM59_TYPE_NOT_SUPPORTED, but never map a non-G payload to a local file.
  if (resp.data.type !== undefined && resp.data.type.toUpperCase() !== 'G') {
    throw new CliError('SM59_TYPE_NOT_SUPPORTED', `SM59 ${upper} is not an HTTP destination (RFCTYPE='${resp.data.type}')`, {
      object: upper,
      type: 'SM59',
      details: { rfctype: resp.data.type },
      nextSteps: ["Only HTTP connections to external server (RFCTYPE=G) are supported by this type."],
    });
  }

  const local = sm59Artifact.fromWire(resp.data);
  const filename = buildFilename(upper, 'SM59', 'main', '.json');
  const relPath = path.join(opts.dir, filename);
  const targetPath = path.resolve(process.cwd(), relPath);

  if (await fileExists(targetPath) && !opts.overwrite && !opts.skipExisting) {
    const outPath = toOutputPath(relPath);
    throw new CliError('OVERWRITE_REQUIRED', `${outPath} already exists; use --overwrite to replace it`, {
      file: outPath,
      nextSteps: ['Re-run with --overwrite to replace the existing file.'],
      example: `abap pull ${upper} --type SM59 --overwrite`,
    });
  }
  if (await fileExists(targetPath) && opts.skipExisting) {
    const outPath = toOutputPath(relPath);
    return {
      data: normalizePullData({
        object: upper,
        type: 'SM59',
        entries: [{ file: outPath, status: 'skipped' }],
        written: [],
        skipped: [outPath],
        failed: [],
      }),
      human: `Skipped SM59 ${upper} (file already exists: ${outPath})`,
    };
  }

  await sm59Artifact.write(targetPath, local);
  const outPath = toOutputPath(relPath);
  return {
    data: normalizePullData({
      object: upper,
      type: 'SM59',
      entries: [{ file: outPath, status: 'written' }],
      written: [outPath],
      skipped: [],
      failed: [],
    }),
    human: `Pulled SM59 ${upper} to ${outPath}`,
  };
}
