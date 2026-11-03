/**
 * JOBD (application job definition, SM36) create via the ICF `/jobd/<name>`
 * route.
 *
 * Read `--file` → validate against `jobd-v1.json` + semantic rules → POST.
 * Writes save and activate in one step (the ICF handler creates the inactive
 * version and activates it immediately), so `--no-activate` is rejected.
 */
import * as path from 'node:path';
import { IcfClient } from '../../clients/icf-client.js';
import { CliError, printResult, type OutputMode } from '../../output/json.js';
import type { ErrorCode } from '../../output/error-codes.js';
import { isLocalPackageName } from '../../core/transport.js';
import { jobdArtifact, JOB_DEFINITION_NAME_MAX_LENGTH, type JobdLocal } from '../../formats/jobd/json.js';
import { toOutputPath } from '../../core/path-output.js';
import { affObjectToken } from '../../formats/file-resolver.js';
import type { CreateOptions } from './create.js';
import type { CreateHandler } from './routing.js';
import { jobdTransportFor } from './jobd-shared.js';

export async function runCreateJobd(
  objectName: string,
  opts: CreateOptions,
  mode: OutputMode,
): Promise<void> {
  const upper = objectName.trim().toUpperCase();
  if (!upper || upper.length > JOB_DEFINITION_NAME_MAX_LENGTH || !/^[A-Z0-9_/]+$/.test(upper.replace(/^\/+/, ''))) {
    throw new CliError(
      'JOBD_NAME_INVALID',
      `JOBD name must be 1-${JOB_DEFINITION_NAME_MAX_LENGTH} characters of A-Z, 0-9, _ or / (got "${objectName}")`,
      {
        object: upper,
        type: 'JOBD',
        nextSteps: [`Use a job definition name of at most ${JOB_DEFINITION_NAME_MAX_LENGTH} characters (JR_JDNAME).`],
        example: `abap create JOBD ZCLI_TC_JOBD_DAILY --file src/zcli_tc_jobd_daily.jobd.json --package '$TMP' --yes`,
      },
    );
  }

  if (!opts.file) {
    throw new CliError('VALIDATION_ERROR', 'Type JOBD requires --file <path> with a jobd-v1 JSON', {
      object: upper,
      type: 'JOBD',
      nextSteps: ['See `abap create --schema JOBD` for the contract and a minimal example.'],
      example: `abap create JOBD ${upper} --file src/${affObjectToken(upper)}.jobd.json --yes`,
    });
  }

  if (opts.activate === false) {
    throw new CliError('VALIDATION_ERROR', 'JOBD writes save and activate in one step; --no-activate is not supported', {
      object: upper,
      type: 'JOBD',
      nextSteps: [
        'Drop --no-activate: the definition is active as soon as the write succeeds.',
        'Job definitions have no separate activation step in this CLI.',
      ],
    });
  }

  if (opts.description) {
    throw new CliError('VALIDATION_ERROR', 'JOBD has no description field; remove --description', {
      object: upper,
      type: 'JOBD',
      nextSteps: ['The AFF document itself carries all editable fields (report, variant, scheduling).'],
    });
  }

  const filePath = path.resolve(process.cwd(), opts.file);
  if (!filePath.toLowerCase().endsWith('.jobd.json')) {
    throw new CliError('VALIDATION_ERROR', `JOBD document must use the .jobd.json suffix: ${opts.file}`, {
      file: toOutputPath(opts.file),
      type: 'JOBD',
      object: upper,
    });
  }
  let local: JobdLocal;
  try {
    local = await jobdArtifact.load(filePath);
  } catch (error: unknown) {
    if (error instanceof CliError) throw error;
    throw new CliError('FILE_PARSE_ERROR', `Cannot read JOBD file: ${error instanceof Error ? error.message : String(error)}`, {
      file: toOutputPath(opts.file),
      type: 'JOBD',
      object: upper,
    });
  }

  if (local.name && local.name.trim().toUpperCase() !== upper) {
    throw new CliError(
      'JOBD_NAME_INVALID',
      `job definition name in ${toOutputPath(opts.file)} ("${local.name}") does not match the command argument "${upper}"`,
      {
        file: toOutputPath(opts.file),
        type: 'JOBD',
        object: upper,
        nextSteps: ['Change the JSON `name` field, or pass the matching name to `abap create`.'],
      },
    );
  }

  const targetPackage = (opts.package ?? local.package ?? '$TMP').trim().toUpperCase();
  const transport = jobdTransportFor(targetPackage, opts.tr, 'create');
  const wire = jobdArtifact.toWire({ ...local, name: upper });

  const icf = await IcfClient.create();
  const resp = await icf.postJobd<{ name: string; type: string; action: 'created'; package: string; activated: boolean }>(
    upper,
    wire,
    { package: targetPackage, ...(transport ? { transportRequest: transport } : {}) },
  );
  if (resp.status !== 'success' || !resp.data) {
    throw new CliError((resp.error?.code ?? 'JOBD_WRITE_FAILED') as ErrorCode, resp.error?.message ?? `Failed to create JOBD ${upper}`, {
      object: upper,
      type: 'JOBD',
      details: resp.error?.details,
      nextSteps: [
        'Fix the cause above and re-run.',
        `Check the document with \`abap validate:aff ${toOutputPath(opts.file)}\` (if the file was hand-edited).`,
      ],
    });
  }

  printResult(mode,
    {
      object: resp.data.name,
      type: 'JOBD',
      action: 'created',
      package: resp.data.package ?? targetPackage,
      activated: true,
      file: toOutputPath(opts.file),
    },
    `Created JOBD ${resp.data.name} via ICF${isLocalPackageName(targetPackage) ? ' (local package)' : ''}`,
  );
}

export const createJobdHandler: CreateHandler = async ({ name, opts, mode }) => {
  await runCreateJobd(name, opts, mode);
};
