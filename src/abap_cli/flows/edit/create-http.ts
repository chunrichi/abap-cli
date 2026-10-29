/**
 * HTTP service create flow.
 *
 * Reads the abap-file-format JSON from `--file`, validates it, converts to wire
 * schema, and POSTs /http/<name>. Command-line --description overrides the file's
 * description. Other required fields (package, transport for non-$TMP) are validated
 * client-side before the round-trip.
 *
 * Per decision 1A (Phase 5): HTTP `create` requires `--file`. The legacy
 * "no-file → write a local skeleton" branch was removed to align with the
 * DDIC / DDLS behavior — write the abap-file-format JSON yourself (see
 * `abap create --schema HTTP`) and pass it via `--file`.
 */
import * as path from 'node:path';
import { IcfClient } from '../../clients/icf-client.js';
import { CliError, printResult, type OutputMode } from '../../output/json.js';
import type { ErrorCode } from '../../output/error-codes.js';
import {
  readHttpJson,
  localToWire as httpLocalToWire,
  validateHttpObject,
} from '../../formats/http/json.js';
import { toOutputPath } from '../../core/path-output.js';
import type { CreateOptions } from './create.js';
import { registerCreateHandler, type CreateHandler } from '../../types/registry.js';

export async function runCreateHttp(
  objectName: string,
  opts: CreateOptions,
  mode: OutputMode,
): Promise<void> {
  if (!opts.file) {
    throw new CliError('USAGE', `HTTP create requires --file <path> with an abap-file-format JSON`, {
      example: `abap create HTTP ${objectName} --file src/${objectName.toLowerCase()}.http.json --package $TMP --description "..."`,
    });
  }
  const filePath = path.resolve(process.cwd(), opts.file);
  let local: Awaited<ReturnType<typeof readHttpJson>>;
  try {
    local = await readHttpJson(filePath);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const outFile = toOutputPath(opts.file);
    throw new CliError('INVALID_ARGUMENT', `Cannot read HTTP service file ${outFile}: ${message}`, {
      file: outFile,
      nextSteps: [
        'Verify the file exists and is valid JSON.',
        'See the abap-file-format HTTP schema (http-v1.json) for the expected layout.',
      ],
    });
  }

  const errors = validateHttpObject(local);
  if (errors.length > 0) {
    const outFile = toOutputPath(opts.file);
    throw new CliError('VALIDATION_ERROR', `Invalid HTTP definition in ${outFile}: ${errors.join('; ')}`, {
      file: outFile,
      type: 'HTTP',
      object: objectName,
      details: errors,
      nextSteps: [
        'Fix the errors above and re-run.',
        'See the abap-file-format HTTP schema (http-v1.json) for the per-field contract.',
      ],
    });
  }

  const targetPackage = (opts.package ?? '$TMP').trim().toUpperCase();
  if (targetPackage !== '$TMP' && !opts.tr) {
    throw new CliError('VALIDATION_ERROR', 'transportRequest is required when package is not $TMP', {
      nextSteps: ['Re-run with --tr <REQUEST>', 'Or use --package $TMP for local objects.'],
      example: `abap create HTTP ${objectName} --file ${toOutputPath(opts.file)} --package ${opts.package} --tr <REQUEST> --description "..."`,
    });
  }

  const wire = httpLocalToWire(local);
  if (opts.description) {
    wire.header = wire.header ?? {};
    wire.header.description = opts.description;
  }
  if (opts.package) wire.package = opts.package;
  if (opts.tr) wire.transportRequest = opts.tr;

  const icf = await IcfClient.create();
  const resp = await icf.postHttp<{ name: string; type: string; action: 'created' | 'updated' }>(objectName, wire);
  if (resp.status !== 'success' || !resp.data) {
    const code = (resp.error?.code ?? 'HTTP_CREATE_FAILED') as ErrorCode;
    throw new CliError(code, resp.error?.message ?? `Failed to create HTTP ${objectName}`, {
      object: objectName,
      type: 'HTTP',
      details: resp.error?.details,
      nextSteps: [
        'Verify the file conforms to the abap-file-format HTTP service JSON schema.',
        'Re-run after fixing the cause above.',
      ],
    });
  }

  printResult(mode,
    {
      object: resp.data.name,
      type: 'HTTP',
      action: resp.data.action,
      file: toOutputPath(opts.file),
    },
    `Created HTTP ${resp.data.name} via ICF ${resp.data.action === 'created' ? '(new)' : '(overwritten)'}`,
  );
}

// Module-load side effect: register HTTP. Decision 2A.
const httpHandler: CreateHandler = async ({ name, opts, mode }) => {
  await runCreateHttp(name, opts as CreateOptions, mode);
};
registerCreateHandler('HTTP', httpHandler);
