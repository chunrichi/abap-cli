/**
 * DDLS create flow — ADT only (DDLS_NOT_SUPPORTED_ON_ECC is raised by channel-detect on ECC).
 *
 * Reads both the `.ddls.json` (cds view spec) and the companion `.ddls.acds`
 * (DDL source string). Create requires both files; the JSON without the
 * source is meaningless.
 */
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { CliError, printResult, type OutputMode } from '../../output/json.js';
import {
  readDdlsJson,
  validateDdlsObject,
  localToWire as ddlsLocalToWire,
} from '../../formats/ddls/json.js';
import { toOutputPath } from '../../core/path-output.js';
import { detectChannel, loadChannelProfile } from './channel-detect.js';
import type { CreateOptions } from './create.js';
import { registerCreateHandler, type CreateHandler } from '../../types/registry.js';

export async function runCreateDdls(
  name: string,
  opts: CreateOptions,
  mode: OutputMode,
): Promise<void> {
  if (!opts.file) {
    throw new CliError('USAGE', `Type DDLS requires --file <path> with an abap-file-format JSON`, {
      example: `abap create DDLS ${name} --file src/${name.toLowerCase()}/${name.toLowerCase()}.ddls.json --package $TMP --yes`,
    });
  }
  const filePath = path.resolve(process.cwd(), opts.file);
  let doc: Awaited<ReturnType<typeof readDdlsJson>>;
  try {
    doc = await readDdlsJson(filePath);
  } catch (error: unknown) {
    throw new CliError('FILE_PARSE_ERROR', `Cannot read DDLS file ${toOutputPath(opts.file)}: ${error instanceof Error ? error.message : String(error)}`, {
      file: toOutputPath(opts.file),
    });
  }
  const errors = await validateDdlsObject(doc);
  if (errors.length > 0) {
    throw new CliError('VALIDATION_ERROR', `Invalid DDLS definition in ${toOutputPath(opts.file)}: ${errors.join('; ')}`, {
      file: toOutputPath(opts.file),
      details: errors,
    });
  }
  const profile = await loadChannelProfile();
  const decision = detectChannel(profile, 'ddls');
  if (decision.channel !== 'adt') {
    throw new CliError('DDLS_NOT_SUPPORTED_ON_ECC', 'DDLS on ECC is not supported', { object: name, type: 'DDLS' });
  }
  const basePath = filePath.replace(/\.ddls\.json$/, '');
  let source = '';
  try {
    source = await fs.readFile(`${basePath}.ddls.acds`, 'utf8');
  } catch {
    throw new CliError('VALIDATION_ERROR', `DDLS companion file missing: ${basePath}.ddls.acds`, {
      file: `${basePath}.ddls.acds`,
      nextSteps: ['Both files must be supplied on create — write the DDL next to the JSON.'],
    });
  }
  const wire = ddlsLocalToWire(doc, source);
  const client = await AdtClientWrapper.create();
  await client.createDdls(name, wire, opts.package, opts.tr);
  printResult(mode, { object: name, type: 'DDLS', action: 'created', channel: 'adt' }, `Created DDLS ${name} via ADT`);
}

// Module-load side effect: register DDLS. Decision 2A.
const ddlsHandler: CreateHandler = async ({ name, opts, mode }) => {
  await runCreateDdls(name, opts as CreateOptions, mode);
};
registerCreateHandler('DDLS', ddlsHandler);
