/**
 * SRVB create flow — ADT only.
 *
 * Reads the AFF `<name>.srvb.json` (metadata-only), creates the binding
 * through the ADT bindings collection, activates it, and optionally publishes
 * it. Mirrors `create-ddls.ts` for the ADT create/activate split.
 */
import * as path from 'node:path';
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { parseBindingType, srvbObjectUrl } from '../../clients/srvb.js';
import { CliError, printResult, type OutputMode } from '../../output/json.js';
import { srvbArtifact, type SrvbLocal } from '../../formats/srvb/json.js';
import { toOutputPath } from '../../core/path-output.js';
import { transportForPackage } from '../../core/transport.js';
import { affObjectToken } from '../../formats/file-resolver.js';
import type { CreateOptions } from './create.js';
import type { CreateHandler } from './routing.js';

const SRVB_JSON_SUFFIX = '.srvb.json';

export async function runCreateSrvb(
  name: string,
  opts: CreateOptions,
  mode: OutputMode,
): Promise<void> {
  if (!opts.file) {
    throw new CliError('USAGE', 'Type SRVB requires --file <path> with an abap-file-format JSON', {
      example: `abap create SRVB ${name} --file src/${affObjectToken(name)}.srvb.json --package $TMP --yes`,
    });
  }
  const filePath = path.resolve(process.cwd(), opts.file);
  let doc: SrvbLocal;
  try {
    doc = await srvbArtifact.read(filePath);
  } catch (error: unknown) {
    throw new CliError(
      'FILE_PARSE_ERROR',
      `Cannot read SRVB file ${toOutputPath(opts.file)}: ${error instanceof Error ? error.message : String(error)}`,
      { file: toOutputPath(opts.file) },
    );
  }
  const errors = await srvbArtifact.validate(doc);
  if (errors.length > 0) {
    throw new CliError(
      'VALIDATION_ERROR',
      `Invalid SRVB definition in ${toOutputPath(opts.file)}: ${errors.join('; ')}`,
      { file: toOutputPath(opts.file), details: errors },
    );
  }
  if (!filePath.endsWith(SRVB_JSON_SUFFIX)) {
    throw new CliError(
      'VALIDATION_ERROR',
      `SRVB metadata must use the ${SRVB_JSON_SUFFIX} suffix: ${toOutputPath(opts.file)}`,
      { file: toOutputPath(opts.file) },
    );
  }
  const binding = parseBindingType(doc.bindingType);
  if (!binding.type || !binding.version) {
    throw new CliError(
      'VALIDATION_ERROR',
      `Invalid SRVB bindingType "${doc.bindingType}" (expected "<type> <version>", e.g. "ODATA V4")`,
      { file: toOutputPath(opts.file) },
    );
  }
  const serviceVersion = doc.services[0]?.versions[0]?.serviceVersion;
  if (!serviceVersion) {
    throw new CliError('VALIDATION_ERROR', 'SRVB definition has no service version to create', {
      file: toOutputPath(opts.file),
    });
  }
  if (opts.publish) {
    if (opts.activate === false) {
      throw new CliError('VALIDATION_ERROR', 'Cannot publish a service binding created with --no-activate', {
        object: name,
        nextSteps: ['Remove --no-activate or activate the binding before publishing.'],
      });
    }
  }

  const targetPackage = (opts.package ?? '$TMP').trim().toUpperCase();
  // A stray --tr on a local package must not reach SAP.
  const transport = transportForPackage(targetPackage, opts.tr);
  const client = await AdtClientWrapper.create();
  await client.createSrvb(name, doc, {
    packageName: targetPackage,
    ...(transport ? { transport } : {}),
  });
  if (opts.activate !== false) {
    await client.activate(srvbObjectUrl(name), 'SRVB/SVB', name);
  }
  let published = false;
  if (opts.publish) {
    await client.publishSrvb(name, serviceVersion, binding.version);
    published = true;
  }
  printResult(
    mode,
    {
      object: name,
      type: 'SRVB',
      action: 'created',
      channel: 'adt',
      ...(opts.publish ? { published } : {}),
    },
    `Created SRVB ${name} via ADT${opts.publish ? ' and published it' : ''}`,
  );
}

export const createSrvbHandler: CreateHandler = async ({ name, opts, mode }) => {
  await runCreateSrvb(name, opts, mode);
};
