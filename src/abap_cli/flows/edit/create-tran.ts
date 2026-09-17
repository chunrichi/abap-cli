/**
 * Transaction code (SE93) create flow.
 *
 * Reads the abap-file-format JSON from `--file`, validates it, converts to wire
 * schema, and POSTs /tran/<code>. Command-line --description overrides the file's
 * description. Non-$TMP package requires --tr.
 */
import * as path from 'node:path';
import { IcfClient } from '../../clients/icf-client.js';
import { CliError, printResult, type OutputMode } from '../../output/json.js';
import type { ErrorCode } from '../../output/error-codes.js';
import {
  readTranJson,
  localToWire as tranLocalToWire,
  validateTranObject,
} from '../../formats/transport/json.js';
import { toOutputPath } from '../../core/path-output.js';
import type { CreateOptions } from './create.js';
import { registerCreateHandler, type CreateHandler } from '../../types/registry.js';

export async function runCreateTran(
  objectName: string,
  opts: CreateOptions,
  mode: OutputMode,
): Promise<void> {
  if (!opts.file) {
    throw new CliError('USAGE', `Transaction code requires --file <path> with an abap-file-format JSON`, {
      example: `abap create TRAN ${objectName} --file src/${objectName.toLowerCase()}.tran.json --package $TMP --description "..."`,
    });
  }
  const filePath = path.resolve(process.cwd(), opts.file);
  let local: Awaited<ReturnType<typeof readTranJson>>;
  try {
    local = await readTranJson(filePath);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const outFile = toOutputPath(opts.file);
    throw new CliError('INVALID_ARGUMENT', `Cannot read Transaction file ${outFile}: ${message}`, {
      file: outFile,
      nextSteps: [
        'Verify the file exists and is valid JSON.',
        'See the abap-file-format Transaction schema (tran-v1.json) for the expected layout.',
      ],
    });
  }

  const errors = validateTranObject(local);
  if (errors.length > 0) {
    const outFile = toOutputPath(opts.file);
    throw new CliError('VALIDATION_ERROR', `Invalid TRAN definition in ${outFile}: ${errors.join('; ')}`, {
      file: outFile,
      type: 'TRAN',
      object: objectName,
      details: errors,
      nextSteps: [
        'Fix the errors above and re-run.',
        'See the abap-file-format Transaction schema (tran-v1.json) for the per-field contract.',
      ],
    });
  }

  const targetPackage = (opts.package ?? '$TMP').trim().toUpperCase();
  if (targetPackage !== '$TMP' && !opts.tr) {
    throw new CliError('VALIDATION_ERROR', 'transportRequest is required when package is not $TMP', {
      nextSteps: ['Re-run with --tr <REQUEST>', 'Or use --package $TMP for local objects.'],
      example: `abap create TRAN ${objectName} --file ${toOutputPath(opts.file)} --package ${opts.package} --tr <REQUEST> --description "..."`,
    });
  }

  const wire = tranLocalToWire(local);
  if (opts.description) {
    wire.header = { ...(wire.header ?? { description: opts.description, originalLanguage: 'en' }), description: opts.description };
  }
  if (opts.package) wire.package = opts.package;
  if (opts.tr) wire.transportRequest = opts.tr;

  const icf = await IcfClient.create();
  const resp = await icf.postTran<{ name: string; type: string; action: 'created' | 'updated' }>(objectName, wire);
  if (resp.status !== 'success' || !resp.data) {
    const code = (resp.error?.code ?? 'TRAN_CREATE_FAILED') as ErrorCode;
    throw new CliError(code, resp.error?.message ?? `Failed to create TRAN ${objectName}`, {
      object: objectName,
      type: 'TRAN',
      details: resp.error?.details,
      nextSteps: [
        'Verify the file conforms to the abap-file-format Transaction JSON schema.',
        'Re-run after fixing the cause above.',
      ],
    });
  }

  printResult(mode,
    {
      object: resp.data.name,
      type: 'TRAN',
      action: resp.data.action,
      file: toOutputPath(opts.file),
    },
    `Created TRAN ${resp.data.name} via ICF ${resp.data.action === 'created' ? '(new)' : '(overwritten)'}`,
  );
}

// Module-load side effect: register TRAN. Decision 2A.
const tranHandler: CreateHandler = async ({ name, opts, mode }) => {
  await runCreateTran(name, opts as CreateOptions, mode);
};
registerCreateHandler('TRAN', tranHandler);
