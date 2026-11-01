/**
 * MSAG create flow — dual-channel (ADT preferred, ICF fallback on ECC or when
 * the ADT endpoint is not routed on this kernel).
 *
 * ADT splits creation in two calls: the collection POST creates the header
 * (name / description / language / package), then a locked PUT writes the
 * `mc:messages` content — a create body that carries messages is accepted but
 * the messages are dropped.
 */
import * as path from 'node:path';
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { IcfClient } from '../../clients/icf-client.js';
import { CliError, printResult, type OutputMode } from '../../output/json.js';
import { msagArtifact, localToWire, type MsagLocal } from '../../formats/msag/json.js';
import { toOutputPath } from '../../core/path-output.js';
import { transportForPackage } from '../../core/transport.js';
import { detectChannel, loadChannelProfile, isAdtEndpointUnavailable } from './channel-detect.js';
import { writeMsagContent } from './msag-adt.js';
import { affObjectToken } from '../../formats/file-resolver.js';
import type { CreateOptions } from './create.js';
import type { CreateHandler } from './routing.js';

export async function runCreateMsag(
  name: string,
  opts: CreateOptions,
  mode: OutputMode,
): Promise<void> {
  if (!opts.file) {
    throw new CliError('USAGE', `Type MSAG requires --file <path> with an abap-file-format JSON`, {
      example: `abap create MSAG ${name} --file src/${affObjectToken(name)}.msag.json --package $TMP --yes`,
    });
  }
  const filePath = path.resolve(process.cwd(), opts.file);
  let doc: MsagLocal;
  try {
    doc = await msagArtifact.read(filePath);
  } catch (error: unknown) {
    throw new CliError('FILE_PARSE_ERROR', `Cannot read MSAG file ${toOutputPath(opts.file)}: ${error instanceof Error ? error.message : String(error)}`, {
      file: toOutputPath(opts.file),
    });
  }
  const errors = await msagArtifact.validate(doc);
  if (errors.length > 0) {
    throw new CliError('VALIDATION_ERROR', `Invalid MSAG definition in ${toOutputPath(opts.file)}: ${errors.join('; ')}`, {
      file: toOutputPath(opts.file),
      details: errors,
    });
  }
  const profile = await loadChannelProfile();
  const decision = detectChannel(profile, 'msag');
  const wire = localToWire(doc, name);
  // A stray --tr on a local package must not reach either channel.
  const transport = transportForPackage(opts.package ?? '$TMP', opts.tr);
  if (decision.channel === 'adt') {
    try {
      const client = await AdtClientWrapper.create();
      await client.createMsag(name, {
        packageName: opts.package ?? '$TMP',
        description: doc.header.description,
        language: doc.header.originalLanguage,
        ...(transport ? { transport } : {}),
      });
      await writeMsagContent(client, name, wire, transport);
      printResult(mode, { object: name, type: 'MSAG', action: 'created', channel: 'adt' }, `Created MSAG ${name} via ADT`);
      return;
    } catch (error) {
      if (!isAdtEndpointUnavailable(error)) throw error;
      // ADT endpoint missing on this kernel — use the bundled ICF fallback.
    }
  }
  const icf = await IcfClient.create();
  const resp = await icf.post(`/ddic/msag/${encodeURIComponent(name)}`, { main: doc, ...(transport ? { transportRequest: transport } : {}) });
  if (resp.status !== 'success') {
    throw new CliError('DDIC_CREATE_FAILED' as never, resp.error?.message ?? 'ICF MSAG create failed', { object: name, type: 'MSAG', details: resp.error?.details });
  }
  printResult(mode, { object: name, type: 'MSAG', action: 'created', channel: 'icf' }, `Created MSAG ${name} via ICF fallback`);
}

export const createMsagHandler: CreateHandler = async ({ name, opts, mode }) => {
  await runCreateMsag(name, opts, mode);
};
