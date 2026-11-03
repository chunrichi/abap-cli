/**
 * SM59 (HTTP destination) push via the ICF `/sm59/<name>` route.
 *
 * Like the other ICF types, `push --file` probes the destination first
 * (`GET /sm59/<name>`) so push stays update-only; `create` is the only path
 * that may create a destination. The whole editable document is replaced
 * through `POST /sm59/<name>`.
 *
 * Destinations are client-independent system-table entries: `--tr` is rejected
 * (nothing can be transported) and there is no activation step, so
 * `--no-activate` is rejected as well.
 */
import * as path from 'node:path';
import type { AdtClientWrapper } from '../../clients/adt-client.js';
import { IcfClient } from '../../clients/icf-client.js';
import { CliError } from '../../output/json.js';
import type { ErrorCode } from '../../output/error-codes.js';
import { toRelativeOutputPath } from '../../core/path-output.js';
import { resolveFile } from '../../formats/file-resolver.js';
import {
  localToWire,
  sm59Artifact,
  type Sm59Local,
  type Sm59Wire,
} from '../../formats/sm59/json.js';
import type { JsonPushTarget, PushFileOptions, PushOneResult } from './push-types.js';
import {
  assertSm59FileNameMatches,
  rejectSm59PackageAndTransport,
  validateSm59Name,
} from './sm59-shared.js';

/** Read + validate an sm59-v1 JSON file (shared with the `--atomic` phase-1 gate). */
async function readValidatedSm59(file: string, objectName: string): Promise<Sm59Local> {
  const outFile = toRelativeOutputPath(file);
  const filePath = path.resolve(process.cwd(), file);
  if (!filePath.toLowerCase().endsWith('.sm59.json')) {
    throw new CliError('VALIDATION_ERROR', `SM59 document must use the .sm59.json suffix: ${outFile}`, {
      file: outFile,
      type: 'SM59',
      object: objectName,
    });
  }
  assertSm59FileNameMatches(objectName, filePath, outFile);
  try {
    return await sm59Artifact.load(filePath);
  } catch (error: unknown) {
    if (error instanceof CliError) throw error;
    throw new CliError('INVALID_ARGUMENT', `Cannot read SM59 file ${outFile}: ${error instanceof Error ? error.message : String(error)}`, {
      file: outFile,
      type: 'SM59',
      object: objectName,
      nextSteps: ['Verify the file exists and is a valid sm59-v1 JSON document.'],
    });
  }
}

/** `--atomic` phase-1 wrapper: validate only, discard the parsed payload. */
export async function validateSm59File(file: string): Promise<void> {
  await readValidatedSm59(file, validateSm59Name(resolveFile(file).objectName));
}

export async function pushSm59File(
  _client: AdtClientWrapper,
  resolved: JsonPushTarget,
  file: string,
  opts: PushFileOptions,
): Promise<PushOneResult> {
  const objectName = validateSm59Name(resolved.objectName);
  rejectSm59PackageAndTransport({ tr: opts.tr }, 'push');
  if (opts.activate === false) {
    throw new CliError('VALIDATION_ERROR', 'SM59 destinations have no activation step; --no-activate is not supported', {
      object: objectName,
      type: 'SM59',
      nextSteps: ['Drop --no-activate: the destination is in effect as soon as the write succeeds.'],
    });
  }
  const local = await readValidatedSm59(file, objectName);
  const outFile = toRelativeOutputPath(file);

  const icf = await IcfClient.create();
  // push updates existing destinations only; `create` is the creating path.
  const head = await icf.getSm59<Sm59Wire>(objectName);
  if (head.status !== 'success' || !head.data) {
    if (head.error?.code === 'SM59_OBJECT_NOT_FOUND') {
      throw new CliError('OBJECT_NOT_FOUND', `SM59 ${objectName} does not exist; push updates existing destinations only`, {
        object: objectName,
        type: 'SM59',
        file: outFile,
        nextSteps: [
          `Create it first: abap create SM59 ${objectName} --file ${outFile} --yes`,
          'Then push again to update the destination.',
        ],
        example: `abap push ${outFile}`,
      });
    }
    if (head.error?.code === 'SM59_TYPE_NOT_SUPPORTED') {
      throw new CliError(
        'SM59_TYPE_NOT_SUPPORTED',
        head.error.message ?? `SM59 ${objectName} is not an HTTP destination (RFCTYPE='G')`,
        {
          object: objectName,
          type: 'SM59',
          file: outFile,
          details: head.error.details,
          nextSteps: ["Only HTTP connections to external server (RFCTYPE=G) can be pushed by this type."],
        },
      );
    }
    throw new CliError((head.error?.code ?? 'SM59_READ_FAILED') as ErrorCode, head.error?.message ?? `Failed to check whether SM59 ${objectName} exists`, {
      object: objectName,
      type: 'SM59',
      file: outFile,
      details: head.error?.details,
    });
  }
  if (head.data.type !== undefined && head.data.type.toUpperCase() !== 'G') {
    throw new CliError('SM59_TYPE_NOT_SUPPORTED', `SM59 ${objectName} is not an HTTP destination (RFCTYPE='${head.data.type}')`, {
      object: objectName,
      type: 'SM59',
      file: outFile,
      nextSteps: ["Only HTTP connections to external server (RFCTYPE=G) can be pushed by this type."],
    });
  }

  const wire = localToWire(local, objectName);
  const resp = await icf.postSm59<{ name: string; type: string; action: 'created' | 'updated' }>(objectName, wire);
  if (resp.status !== 'success' || !resp.data) {
    throw new CliError((resp.error?.code ?? 'SM59_WRITE_FAILED') as ErrorCode, resp.error?.message ?? `Failed to push SM59 ${objectName}`, {
      object: objectName,
      type: 'SM59',
      file: outFile,
      details: resp.error?.details,
      nextSteps: ['Fix the cause above and re-run.'],
    });
  }
  return { transport: '', status: 'written' };
}
