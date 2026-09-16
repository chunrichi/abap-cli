/**
 * PR5 (B1): NROB (number range object) create flow.
 *
 * NROB is exposed by S/4HANA as an ADT object type under
 * `/sap/bc/adt/numberranges/objects` (registry marks `source: 'ADT'`); on
 * older kernels (ECC EHP6) the same create/push path falls through to the
 * bundled ICF `/ddic/nrob` route — `channel-detect` decides at runtime, the
 * same way it does for MSAG / TTYP.
 *
 * On the ADT path the request body is the AFF `nrob-v1.json` document itself
 * (no XML wrapping): NROB source *is* the AFF JSON (proven in the previous
 * session by `$schema` returning the same vendored schema). On the ICF
 * fallback the ABAP side persists the same JSON into the classic TNRO /
 * TNROT / NRIV tables.
 *
 * NROB names follow the standard DDIC namespace: `Z*` / `Y*` / `/*`. The
 * 3-character interval name is what `SNRO` binds to in SAP.
 */
import * as path from 'node:path';
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { IcfClient } from '../../clients/icf-client.js';
import { CliError, printResult, type OutputMode } from '../../output/json.js';
import type { ErrorCode } from '../../output/error-codes.js';
import { localToWire, loadAndValidate, type NrobLocal } from '../../formats/nrob/json.js';
import { toOutputPath } from '../../core/path-output.js';
import { detectChannel, loadChannelProfile, type SystemProfile } from './channel-detect.js';
import type { CreateOptions } from './create.js';
import { registerCreateHandler, type CreateHandler } from '../../types/registry.js';

const NROB_NAME_PREFIX = /^(Z|Y|\/)/i;

export async function runCreateNrob(
  objectName: string,
  opts: CreateOptions,
  mode: OutputMode,
  profile?: SystemProfile,
): Promise<void> {
  const upper = objectName.trim().toUpperCase();
  if (!NROB_NAME_PREFIX.test(upper)) {
    throw new CliError(
      'INVALID_ARGUMENT',
      `NROB object name must start with Z, Y, or / (got "${objectName}")`,
      {
        object: upper,
        type: 'NROB',
        nextSteps: ['NROB names follow the standard DDIC namespace convention.'],
        example: `abap create NROB Z${upper.replace(/[^A-Z0-9_/]/g, '')} --file <nrob.json> --yes`,
      },
    );
  }

  if (!opts.file) {
    throw new CliError(
      'VALIDATION_ERROR',
      'Type NROB requires --file <path> with an abap-file-format JSON',
      {
        object: upper,
        type: 'NROB',
        nextSteps: ['See `abap create --schema NROB` for the contract.'],
        example: `abap create NROB ${upper} --file src/nrob/${upper.toLowerCase()}/${upper.toLowerCase()}.nrob.json --yes`,
      },
    );
  }

  const filePath = path.resolve(process.cwd(), opts.file);
  let local: NrobLocal;
  try {
    local = await loadAndValidate(filePath);
  } catch (error: unknown) {
    if (error instanceof CliError) throw error;
    throw new CliError('VALIDATION_ERROR', `Cannot read NROB file: ${error instanceof Error ? error.message : String(error)}`, {
      file: toOutputPath(opts.file),
      type: 'NROB',
      object: upper,
    });
  }

  const targetPackage = (opts.package ?? '$TMP').trim().toUpperCase();
  if (targetPackage !== '$TMP' && !opts.tr) {
    throw new CliError('VALIDATION_ERROR', 'transportRequest is required when package is not $TMP', {
      nextSteps: ['Re-run with --tr <REQUEST>', 'Or use --package $TMP for local objects.'],
      example: `abap create NROB ${upper} --file ${toOutputPath(opts.file)} --package ${opts.package} --tr <REQUEST> --yes`,
    });
  }

  const sysProfile = profile ?? (await loadChannelProfile());
  const decision = detectChannel(sysProfile, 'nrob');

  if (decision.channel === 'adt') {
    const wire = localToWire(local);
    const client = await AdtClientWrapper.create();
    await client.createNrobSource(upper, JSON.stringify(wire), opts.package ?? '$TMP', opts.tr);
    printResult(
      mode,
      { object: upper, type: 'NROB', action: 'created', channel: 'adt' },
      `Created NROB ${upper} via ADT`,
    );
    return;
  }

  // ICF fallback (ECC EHP5/6): the body shape is the same AFF JSON document
  // — the bundled `/ddic/nrob` ICF handler persists it via the classic
  // TNRO / TNROT / NRIV path.
  const wire = localToWire(local);
  if (opts.description) wire.header = { ...(wire.header as object), description: opts.description };
  if (opts.package) (wire as Record<string, unknown>).package = opts.package;
  if (opts.tr) (wire as Record<string, unknown>).transportRequest = opts.tr;

  const icf = await IcfClient.create();
  const resp = await icf.postDdic<{ name: string; type: string; action: 'created' | 'updated' }>('nrob', wire);
  if (resp.status !== 'success' || !resp.data) {
    const code = (resp.error?.code ?? 'NROB_CREATE_FAILED') as ErrorCode;
    throw new CliError(code, resp.error?.message ?? `Failed to create NROB ${upper}`, {
      object: upper,
      type: 'NROB',
      details: resp.error?.details,
    });
  }

  printResult(
    mode,
    {
      object: resp.data.name,
      type: 'NROB',
      action: resp.data.action,
      channel: 'icf',
      ...(decision.fallbackReason ? { fallbackReason: decision.fallbackReason } : {}),
      file: toOutputPath(opts.file),
    },
    `Created NROB ${resp.data.name} via ICF ${resp.data.action === 'created' ? '(new)' : '(overwritten)'}`,
  );
}

const nrobHandler: CreateHandler = async ({ name, opts, mode }) => {
  await runCreateNrob(name, opts as CreateOptions, mode);
};
registerCreateHandler('NROB', nrobHandler);