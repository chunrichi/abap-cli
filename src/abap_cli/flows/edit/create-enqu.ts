/**
 * PR5 (B1): ENQU (lock object) create flow via the ICF `/ddic/enqu` route.
 *
 * Mirrors `create-ddic.ts`: read --file → validate against `enqu-v1.json` →
 * convert local → wire → POST. ENQU namespaces must start with `EZ` / `EY` /
 * `/` (SAP rule for lock objects); a name-prefix mismatch is a local check
 * before the round-trip so the CLI gives a clearer error than the BAPI
 * "object name invalid" generic message.
 */
import * as path from 'node:path';
import { IcfClient } from '../../clients/icf-client.js';
import { CliError, printResult, type OutputMode } from '../../output/json.js';
import type { ErrorCode } from '../../output/error-codes.js';
import { localToWire, loadAndValidate, type EnquLocal } from '../../formats/enqu/json.js';
import { toOutputPath } from '../../core/path-output.js';
import type { CreateOptions } from './create.js';
import { registerCreateHandler, type CreateHandler } from '../../types/registry.js';

const ENQU_NAME_PREFIX = /^(EZ|EY|\/)/i;

export async function runCreateEnqu(
  objectName: string,
  opts: CreateOptions,
  mode: OutputMode,
): Promise<void> {
  const upper = objectName.trim().toUpperCase();
  if (!ENQU_NAME_PREFIX.test(upper)) {
    throw new CliError(
      'INVALID_ARGUMENT',
      `ENQU object name must start with EZ, EY, or / (got "${objectName}")`,
      {
        object: upper,
        type: 'ENQU',
        nextSteps: [
          'Lock object names follow the SAP convention EZ* / EY* (customer / customer-namespace) or /foo/* (namespaced).',
        ],
        example: `abap create ENQU EZ_${upper.replace(/[^A-Z0-9_/]/g, '')}_LOCK --file <enqu.json> --yes`,
      },
    );
  }

  if (!opts.file) {
    throw new CliError(
      'VALIDATION_ERROR',
      'Type ENQU requires --file <path> with an abap-file-format JSON',
      {
        object: upper,
        type: 'ENQU',
        nextSteps: ['See `abap create --schema ENQU` for the contract.'],
        example: `abap create ENQU ${upper} --file src/enqu/${upper.toLowerCase()}/${upper.toLowerCase()}.enqu.json --yes`,
      },
    );
  }

  const filePath = path.resolve(process.cwd(), opts.file);
  let local: EnquLocal;
  try {
    local = await loadAndValidate(filePath);
  } catch (error: unknown) {
    if (error instanceof CliError) throw error;
    throw new CliError('VALIDATION_ERROR', `Cannot read ENQU file: ${error instanceof Error ? error.message : String(error)}`, {
      file: toOutputPath(opts.file),
      type: 'ENQU',
      object: upper,
    });
  }

  const targetPackage = (opts.package ?? '$TMP').trim().toUpperCase();
  if (targetPackage !== '$TMP' && !opts.tr) {
    throw new CliError('VALIDATION_ERROR', 'transportRequest is required when package is not $TMP', {
      nextSteps: ['Re-run with --tr <REQUEST>', 'Or use --package $TMP for local objects.'],
      example: `abap create ENQU ${upper} --file ${toOutputPath(opts.file)} --package ${opts.package} --tr <REQUEST> --yes`,
    });
  }

  const wire = localToWire(local);
  // The AFF enqu document carries no lock-object name: `primaryTable.name` is
  // the table being locked, which is a different thing. Send the object name
  // on the wire (the ABAP side reads it from the payload and falls back to the
  // URL path — the same convention create_ddic_table uses).
  (wire as Record<string, unknown>).name = upper;
  if (opts.description) wire.header = { ...(wire.header as object), description: opts.description };
  if (opts.package) (wire as Record<string, unknown>).package = opts.package;
  if (opts.tr) (wire as Record<string, unknown>).transportRequest = opts.tr;

  const icf = await IcfClient.create();
  const resp = await icf.postDdic<{ name: string; type: string; action: 'created' | 'updated' }>('enqu', wire);
  if (resp.status !== 'success' || !resp.data) {
    const code = (resp.error?.code ?? 'ENQU_CREATE_FAILED') as ErrorCode;
    throw new CliError(code, resp.error?.message ?? `Failed to create ENQU ${upper}`, {
      object: upper,
      type: 'ENQU',
      details: resp.error?.details,
    });
  }

  printResult(mode,
    {
      object: resp.data.name,
      type: 'ENQU',
      action: resp.data.action,
      file: toOutputPath(opts.file),
    },
    `Created ENQU ${resp.data.name} via ICF ${resp.data.action === 'created' ? '(new)' : '(overwritten)'}`,
  );
}

const enquHandler: CreateHandler = async ({ name, opts, mode }) => {
  await runCreateEnqu(name, opts as CreateOptions, mode);
};
registerCreateHandler('ENQU', enquHandler);
