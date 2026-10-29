/**
 * TTYP create flow — dual-channel (ADT preferred, ICF fallback on ECC).
 *
 * Spec 036 US3 mirrors the create_ddic read → validate → POST shape but ships
 * only the AFF nested form. `channel-detect` picks the transport; ADT is
 * canonical, ICF only on older kernels.
 */
import * as path from 'node:path';
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { IcfClient } from '../../clients/icf-client.js';
import { CliError, printResult, type OutputMode } from '../../output/json.js';
import {
  readTtypJson,
  validateTtypObject,
  localToWire as ttypLocalToWire,
} from '../../formats/ttyp/json.js';
import { toOutputPath } from '../../core/path-output.js';
import { detectChannel, loadChannelProfile } from './channel-detect.js';
import type { CreateOptions } from './create.js';
import { registerCreateHandler, type CreateHandler } from '../../types/registry.js';

export async function runCreateTtyp(
  name: string,
  opts: CreateOptions,
  mode: OutputMode,
): Promise<void> {
  if (!opts.file) {
    throw new CliError('USAGE', `Type TTYP requires --file <path> with an abap-file-format JSON`, {
      example: `abap create TTYP ${name} --file src/${name.toLowerCase()}/${name.toLowerCase()}.ttyp.json --package $TMP --yes`,
    });
  }
  const filePath = path.resolve(process.cwd(), opts.file);
  let doc: Awaited<ReturnType<typeof readTtypJson>>;
  try {
    doc = await readTtypJson(filePath);
  } catch (error: unknown) {
    throw new CliError('FILE_PARSE_ERROR', `Cannot read TTYP file ${toOutputPath(opts.file)}: ${error instanceof Error ? error.message : String(error)}`, {
      file: toOutputPath(opts.file),
    });
  }
  const errors = await validateTtypObject(doc);
  if (errors.length > 0) {
    throw new CliError('VALIDATION_ERROR', `Invalid TTYP definition in ${toOutputPath(opts.file)}: ${errors.join('; ')}`, {
      file: toOutputPath(opts.file),
      details: errors,
    });
  }
  const profile = await loadChannelProfile();
  const decision = detectChannel(profile, 'ttyp');
  const wire = ttypLocalToWire(doc);
  if (decision.channel === 'adt') {
    const client = await AdtClientWrapper.create();
    await client.createTtyp(name, wire, opts.package, opts.tr);
    printResult(mode, { object: name, type: 'TTYP', action: 'created', channel: 'adt' }, `Created TTYP ${name} via ADT`);
  } else {
    const icf = await IcfClient.create();
    const resp = await icf.post(`/ddic/ttyp/${encodeURIComponent(name)}`, { main: doc, ...(opts.tr ? { transportRequest: opts.tr } : {}) });
    if (resp.status !== 'success') {
      throw new CliError('DDIC_CREATE_FAILED' as never, resp.error?.message ?? 'ICF TTYP create failed', { object: name, type: 'TTYP', details: resp.error?.details });
    }
    printResult(mode, { object: name, type: 'TTYP', action: 'created', channel: 'icf' }, `Created TTYP ${name} via ICF fallback`);
  }
}

// Module-load side effect: register TTYP. Decision 2A.
const ttypHandler: CreateHandler = async ({ name, opts, mode }) => {
  await runCreateTtyp(name, opts as CreateOptions, mode);
};
registerCreateHandler('TTYP', ttypHandler);
