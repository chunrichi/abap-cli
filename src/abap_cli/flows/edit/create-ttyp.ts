/**
 * TTYP create flow — dual-channel (ADT preferred, ICF fallback on ECC or when
 * the ADT endpoint is not routed on this kernel).
 *
 * ADT splits creation in two calls: the collection POST registers the table
 * type with default content, then a locked PUT applies the row type / access
 * type / keys and activates the object. The ICF fallback is upsert-shaped and
 * takes the local AFF document.
 */
import * as path from 'node:path';
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { IcfClient } from '../../clients/icf-client.js';
import { CliError, printResult, type OutputMode } from '../../output/json.js';
import { ttypArtifact, localToWire, type TtypLocal } from '../../formats/ttyp/json.js';
import { toOutputPath } from '../../core/path-output.js';
import { transportForPackage } from '../../core/transport.js';
import { detectChannel, loadChannelProfile, isAdtEndpointUnavailable } from './channel-detect.js';
import { writeTtypContent } from './ttyp-adt.js';
import { affObjectToken } from '../../formats/file-resolver.js';
import type { CreateOptions } from './create.js';
import type { CreateHandler } from './routing.js';

export async function runCreateTtyp(
  name: string,
  opts: CreateOptions,
  mode: OutputMode,
): Promise<void> {
  if (!opts.file) {
    throw new CliError('USAGE', `Type TTYP requires --file <path> with an abap-file-format JSON`, {
      example: `abap create TTYP ${name} --file src/${affObjectToken(name)}.ttyp.json --package $TMP --yes`,
    });
  }
  const filePath = path.resolve(process.cwd(), opts.file);
  let doc: TtypLocal;
  try {
    doc = await ttypArtifact.read(filePath);
  } catch (error: unknown) {
    throw new CliError('FILE_PARSE_ERROR', `Cannot read TTYP file ${toOutputPath(opts.file)}: ${error instanceof Error ? error.message : String(error)}`, {
      file: toOutputPath(opts.file),
    });
  }
  const errors = await ttypArtifact.validate(doc);
  if (errors.length > 0) {
    throw new CliError('VALIDATION_ERROR', `Invalid TTYP definition in ${toOutputPath(opts.file)}: ${errors.join('; ')}`, {
      file: toOutputPath(opts.file),
      details: errors,
    });
  }
  if (doc.lineType.rowStructure) {
    throw new CliError('VALIDATION_ERROR', 'TTYP lineType.rowStructure is not supported on the ADT channel: a DDIC table type needs a repository row type (data element / structure / table / table type)', {
      file: toOutputPath(opts.file),
      nextSteps: ['Replace lineType.rowStructure with lineType.rowType naming a repository type.'],
    });
  }
  const profile = await loadChannelProfile();
  const decision = detectChannel(profile, 'ttyp');
  const targetPackage = (opts.package ?? '$TMP').trim().toUpperCase();
  // A stray --tr on a local package must not reach either channel.
  const transport = transportForPackage(targetPackage, opts.tr);
  if (decision.channel === 'adt') {
    try {
      const client = await AdtClientWrapper.create();
      // ADT only persists the DDIC description when the body language equals
      // the logon language, so the wire always speaks the profile language.
      const language = client.getConfig().sap.language;
      const createBody = localToWire(doc, name, { packageName: targetPackage, language });
      const updateBody = localToWire(doc, name, { language });
      await client.createTtyp(createBody, transport);
      await writeTtypContent(client, name, updateBody, transport);
      printResult(mode, { object: name, type: 'TTYP', action: 'created', channel: 'adt' }, `Created TTYP ${name} via ADT`);
      return;
    } catch (error) {
      if (!isAdtEndpointUnavailable(error)) throw error;
      // ADT endpoint missing on this kernel — use the bundled ICF fallback.
    }
  }
  const icf = await IcfClient.create();
  const resp = await icf.post(`/ddic/ttyp/${encodeURIComponent(name)}`, {
    main: doc,
    package: targetPackage,
    ...(transport ? { transportRequest: transport } : {}),
  });
  if (resp.status !== 'success') {
    throw new CliError('DDIC_CREATE_FAILED' as never, resp.error?.message ?? 'ICF TTYP create failed', { object: name, type: 'TTYP', details: resp.error?.details });
  }
  printResult(mode, { object: name, type: 'TTYP', action: 'created', channel: 'icf' }, `Created TTYP ${name} via ICF fallback`);
}

export const createTtypHandler: CreateHandler = async ({ name, opts, mode }) => {
  await runCreateTtyp(name, opts, mode);
};
