/**
 * ATC configuration object create flow — CHKC / CHKO / CHKV (ADT only).
 *
 * Reads the local AFF document (`<name>.<type>.json`), posts the ADT
 * collection, then activates the freshly created object. Mirrors
 * `create-srvb.ts` for the create/activate split; `--no-activate` leaves the
 * object inactive (the create itself succeeds, the object is just not usable
 * by ATC yet).
 *
 * Activation requirements come from SAP, not the CLI: a CHKO's implementing
 * class must be registered as an active ATC check, and a CHKV's check
 * parameters must match the implementing class. Those failures surface as
 * `ACTIVATION_FAILED` with SAP's messages.
 */
import * as path from 'node:path';
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { ATC_TYPE_INFO, atcObjectUrl } from '../../clients/atc.js';
import { CliError, printResult, type OutputMode } from '../../output/json.js';
import { atcArtifactFor, type AtcLocal, type AtcType } from '../../formats/atc/json.js';
import { toOutputPath } from '../../core/path-output.js';
import { transportForPackage } from '../../core/transport.js';
import { affObjectToken } from '../../formats/file-resolver.js';
import type { CreateOptions } from './create.js';
import type { CreateHandler } from './routing.js';

/** Lowercase suffix of the local AFF document for one ATC type. */
export function atcJsonSuffix(type: AtcType): string {
  return `.${type.toLowerCase()}.json`;
}

export async function runCreateAtc(
  type: AtcType,
  name: string,
  opts: CreateOptions,
  mode: OutputMode,
): Promise<void> {
  const suffix = atcJsonSuffix(type);
  if (!opts.file) {
    throw new CliError('USAGE', `Type ${type} requires --file <path> with an abap-file-format JSON`, {
      example: `abap create ${type} ${name} --file src/${affObjectToken(name)}${suffix} --package $TMP --yes`,
    });
  }
  const filePath = path.resolve(process.cwd(), opts.file);
  if (!filePath.toLowerCase().endsWith(suffix)) {
    throw new CliError('VALIDATION_ERROR', `${type} metadata must use the ${suffix} suffix: ${toOutputPath(opts.file)}`, {
      file: toOutputPath(opts.file),
    });
  }
  // The AFF filename encodes the object name; a mismatch would create an
  // object under the command-line name while the local document keeps pointing
  // at another one (and the following `push` would target the wrong object).
  const expectedFile = `${affObjectToken(name)}${suffix}`;
  if (path.basename(filePath).toLowerCase() !== expectedFile.toLowerCase()) {
    throw new CliError('VALIDATION_ERROR', `File ${toOutputPath(opts.file)} does not match object ${name}; expected ${expectedFile}`, {
      file: toOutputPath(opts.file),
      object: name,
      type,
      nextSteps: [`Rename the document to ${expectedFile}, or run create for the object named by the file.`],
      example: `abap create ${type} ${name} --file src/${expectedFile} --package $TMP --yes`,
    });
  }
  const artifact = atcArtifactFor(type);
  let doc: AtcLocal;
  try {
    doc = await artifact.read(filePath);
  } catch (error: unknown) {
    throw new CliError(
      'FILE_PARSE_ERROR',
      `Cannot read ${type} file ${toOutputPath(opts.file)}: ${error instanceof Error ? error.message : String(error)}`,
      { file: toOutputPath(opts.file) },
    );
  }
  const errors = await artifact.validate(doc);
  if (errors.length > 0) {
    throw new CliError(
      'VALIDATION_ERROR',
      `Invalid ${type} definition in ${toOutputPath(opts.file)}: ${errors.join('; ')}`,
      { file: toOutputPath(opts.file), details: errors },
    );
  }

  const targetPackage = (opts.package ?? '$TMP').trim().toUpperCase();
  // A stray --tr on a local package must not reach SAP.
  const transport = transportForPackage(targetPackage, opts.tr);
  const client = await AdtClientWrapper.create();
  await client.createAtcObject(type, name, doc, {
    packageName: targetPackage,
    ...(transport ? { transport } : {}),
  });
  if (opts.activate !== false) {
    await client.activate(atcObjectUrl(type, name), ATC_TYPE_INFO[type].objtype, name);
  }
  printResult(
    mode,
    {
      object: name,
      type,
      action: 'created',
      channel: 'adt',
      activated: opts.activate !== false,
    },
    `Created ${type} ${name} via ADT${opts.activate === false ? ' (inactive)' : ''}`,
  );
}

/** Per-type create handler factory (one row per ATC type in `routing.ts`). */
export function createAtcHandler(type: AtcType): CreateHandler {
  return async ({ name, opts, mode }) => {
    await runCreateAtc(type, name, opts, mode);
  };
}
