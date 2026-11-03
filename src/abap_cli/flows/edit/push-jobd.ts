/**
 * JOBD (application job definition, SM36) push via the ICF `/jobd/<name>` route.
 *
 * Like the other ICF types, `push --file` probes the object first
 * (`GET /jobd/<name>`) so push stays update-only; `create` is the only path
 * that may create an object. The whole editable document is replaced through
 * `PUT /jobd/<name>`; the existing object's package decides local-ness and
 * therefore the transport rule.
 */
import * as path from 'node:path';
import type { AdtClientWrapper } from '../../clients/adt-client.js';
import { IcfClient } from '../../clients/icf-client.js';
import { CliError } from '../../output/json.js';
import type { ErrorCode } from '../../output/error-codes.js';
import { toRelativeOutputPath } from '../../core/path-output.js';
import { resolveFile } from '../../formats/file-resolver.js';
import { jobdArtifact, type JobdLocal } from '../../formats/jobd/json.js';
import { jobdTransportFor } from './jobd-shared.js';
import type { JsonPushTarget, PushFileOptions, PushOneResult } from './push-types.js';

/** Read + validate a jobd-v1 JSON file (shared with the `--atomic` phase-1 gate). */
async function readValidatedJobd(file: string, objectName: string): Promise<JobdLocal> {
  const outFile = toRelativeOutputPath(file);
  try {
    return await jobdArtifact.load(path.resolve(process.cwd(), file));
  } catch (error: unknown) {
    if (error instanceof CliError) throw error;
    throw new CliError('INVALID_ARGUMENT', `Cannot read JOBD file ${outFile}: ${error instanceof Error ? error.message : String(error)}`, {
      file: outFile,
      type: 'JOBD',
      object: objectName,
      nextSteps: ['Verify the file exists and is a valid jobd-v1 JSON document.'],
    });
  }
}

/** `--atomic` phase-1 wrapper: validate only, discard the parsed payload. */
export async function validateJobdFile(file: string): Promise<void> {
  await readValidatedJobd(file, resolveFile(file).objectName);
}

export async function pushJobdFile(
  _client: AdtClientWrapper,
  resolved: JsonPushTarget,
  file: string,
  opts: PushFileOptions,
): Promise<PushOneResult> {
  const local = await readValidatedJobd(file, resolved.objectName);
  const objectName = resolved.objectName.toUpperCase();
  if (opts.activate === false) {
    throw new CliError('VALIDATION_ERROR', 'JOBD writes save and activate in one step; --no-activate is not supported', {
      object: objectName,
      type: 'JOBD',
      nextSteps: ['Drop --no-activate: the definition is active as soon as the write succeeds.'],
    });
  }

  const icf = await IcfClient.create();
  // push updates existing objects only; the read also yields the package that
  // decides the transport rule.
  const head = await icf.getJobd<{ package?: string }>(objectName);
  if (head.status !== 'success' || !head.data) {
    const outFile = toRelativeOutputPath(file);
    if (head.error?.code === 'JOBD_NOT_FOUND') {
      throw new CliError('OBJECT_NOT_FOUND', `JOBD ${objectName} does not exist; push updates existing job definitions only`, {
        object: objectName,
        type: 'JOBD',
        file: outFile,
        nextSteps: [
          `Create it first: abap create JOBD ${objectName} --file ${outFile} --package <package> --yes`,
          'Then push again to update the definition.',
        ],
        example: `abap push ${outFile}`,
      });
    }
    throw new CliError((head.error?.code ?? 'SAP_ERROR') as ErrorCode, head.error?.message ?? `Failed to check whether JOBD ${objectName} exists`, {
      object: objectName,
      type: 'JOBD',
      file: outFile,
    });
  }

  const packageName = head.data.package;
  const transport = jobdTransportFor(packageName, opts.tr, 'update');
  const wire = jobdArtifact.toWire({ ...local, name: objectName });

  const resp = await icf.putJobd<{ name: string; type: string; action: 'updated' }>(objectName, wire, {
    ...(transport ? { transportRequest: transport } : {}),
  });
  if (resp.status !== 'success' || !resp.data) {
    throw new CliError((resp.error?.code ?? 'JOBD_WRITE_FAILED') as ErrorCode, resp.error?.message ?? `Failed to push JOBD ${objectName}`, {
      object: objectName,
      type: 'JOBD',
      details: resp.error?.details,
      nextSteps: ['Fix the cause above and re-run.'],
    });
  }
  return { transport: transport ?? '', status: 'written' };
}
