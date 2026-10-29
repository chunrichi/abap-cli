/**
 * MSAG create flow — dual-channel (ADT preferred, ICF fallback on ECC).
 */
import * as path from 'node:path';
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { IcfClient } from '../../clients/icf-client.js';
import { CliError, printResult, type OutputMode } from '../../output/json.js';
import {
  readMsagJson,
  validateMsagObject,
  localToWire as msagLocalToWire,
} from '../../formats/msag/json.js';
import { toOutputPath } from '../../core/path-output.js';
import { detectChannel, loadChannelProfile } from './channel-detect.js';
import type { CreateOptions } from './create.js';
import { registerCreateHandler, type CreateHandler } from '../../types/registry.js';

export async function runCreateMsag(
  name: string,
  opts: CreateOptions,
  mode: OutputMode,
): Promise<void> {
  if (!opts.file) {
    throw new CliError('USAGE', `Type MSAG requires --file <path> with an abap-file-format JSON`, {
      example: `abap create MSAG ${name} --file src/${name.toLowerCase()}/${name.toLowerCase()}.msag.json --package $TMP --yes`,
    });
  }
  const filePath = path.resolve(process.cwd(), opts.file);
  let doc: Awaited<ReturnType<typeof readMsagJson>>;
  try {
    doc = await readMsagJson(filePath);
  } catch (error: unknown) {
    throw new CliError('FILE_PARSE_ERROR', `Cannot read MSAG file ${toOutputPath(opts.file)}: ${error instanceof Error ? error.message : String(error)}`, {
      file: toOutputPath(opts.file),
    });
  }
  const errors = await validateMsagObject(doc);
  if (errors.length > 0) {
    throw new CliError('VALIDATION_ERROR', `Invalid MSAG definition in ${toOutputPath(opts.file)}: ${errors.join('; ')}`, {
      file: toOutputPath(opts.file),
      details: errors,
    });
  }
  const profile = await loadChannelProfile();
  const decision = detectChannel(profile, 'msag');
  const wire = msagLocalToWire(doc);
  if (decision.channel === 'adt') {
    const client = await AdtClientWrapper.create();
    await client.createMsag(name, wire, opts.package, opts.tr);
    printResult(mode, { object: name, type: 'MSAG', action: 'created', channel: 'adt' }, `Created MSAG ${name} via ADT`);
  } else {
    const icf = await IcfClient.create();
    const resp = await icf.post(`/ddic/msag/${encodeURIComponent(name)}`, { main: doc, ...(opts.tr ? { transportRequest: opts.tr } : {}) });
    if (resp.status !== 'success') {
      throw new CliError('DDIC_CREATE_FAILED' as never, resp.error?.message ?? 'ICF MSAG create failed', { object: name, type: 'MSAG', details: resp.error?.details });
    }
    printResult(mode, { object: name, type: 'MSAG', action: 'created', channel: 'icf' }, `Created MSAG ${name} via ICF fallback`);
  }
}

// Module-load side effect: register MSAG. Decision 2A.
const msagHandler: CreateHandler = async ({ name, opts, mode }) => {
  await runCreateMsag(name, opts as CreateOptions, mode);
};
registerCreateHandler('MSAG', msagHandler);
