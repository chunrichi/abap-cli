/**
 * HTTP service create flow.
 *
 * Reads the abap-file-format JSON from `--file`, validates it, converts to wire
 * schema, and POSTs /http/<name>. Command-line --description overrides the file's
 * description. Other required fields (package, transport for non-local packages) are validated
 * client-side before the round-trip.
 *
 * Per decision 1A: HTTP `create` requires `--file`. The legacy
 * "no-file → write a local skeleton" branch was removed to align with the
 * DDIC / DDLS behavior — write the abap-file-format JSON yourself (see
 * `abap create --schema HTTP`) and pass it via `--file`.
 */
import * as path from 'node:path';
import { IcfClient } from '../../clients/icf-client.js';
import { CliError, printResult, type OutputMode } from '../../output/json.js';
import type { ErrorCode } from '../../output/error-codes.js';
import { isLocalPackageName, transportForPackage } from '../../core/transport.js';
import {
  httpArtifact,
  localToWire as httpLocalToWire,
  validateHttpObject,
  type HttpObjectLocal,
} from '../../formats/http/json.js';
import { toOutputPath } from '../../core/path-output.js';
import type { CreateOptions } from './create.js';
import type { CreateHandler } from './routing.js';

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
  let local: HttpObjectLocal;
  try {
    local = await httpArtifact.read(filePath);
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

  // The on-disk AFF document carries no object name (the file name carries
  // it), but the namespace/name guard needs it: inject the CLI argument before
  // validating so a pulled AFF file can be used as the create template.
  const errors = validateHttpObject({ ...local, name: objectName.toUpperCase() });
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

  // SICF node writes go through the bundled ICF service, which cannot record a
  // creation/change in a transport request: only local ($-prefixed) packages
  // are writable. Transportable nodes stay in transaction SICF.
  const targetPackage = (opts.package ?? '$TMP').trim().toUpperCase();
  if (!isLocalPackageName(targetPackage)) {
    throw new CliError('HTTP_PACKAGE_NOT_SUPPORTED', `HTTP services can only be written in local packages starting with $ (got ${targetPackage}); create transportable SICF nodes in transaction SICF`, {
      object: objectName,
      type: 'HTTP',
      nextSteps: [
        'Use a local package such as $TMP for scratch SICF nodes.',
        'Maintain transportable SICF nodes in transaction SICF so the change is recorded in a transport request.',
      ],
      example: `abap create HTTP ${objectName} --file ${toOutputPath(opts.file)} --package '$TMP' --yes`,
    });
  }

  const wire = httpLocalToWire(local);
  if (opts.description) {
    wire.header = wire.header ?? {};
    wire.header.description = opts.description;
  }
  wire.package = targetPackage;
  // Local packages are transport-free: a stray --tr must not reach the wire.
  const transport = transportForPackage(targetPackage, opts.tr);
  if (transport) wire.transportRequest = transport;

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

export const createHttpHandler: CreateHandler = async ({ name, opts, mode }) => {
  await runCreateHttp(name, opts, mode);
};
