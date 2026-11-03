/**
 * ATC configuration object push flow — CHKC / CHKO / CHKV (ADT only).
 *
 * `push` updates an existing object: the local AFF document is validated and
 * sent as a locked PUT, then activated (`--no-activate` stops after the
 * write). A missing object is an `OBJECT_NOT_FOUND` with a pointer to
 * `abap create <type> <name> --file <json>` instead of a silent create.
 *
 * The object's package is read back from the ADT resource before the write so
 * the update body can keep the package reference and the transport rule stays
 * honest (`--tr` is required outside `$`-prefixed packages, matching delete).
 */
import * as path from 'node:path';
import type { AdtClientWrapper } from '../../clients/adt-client.js';
import { ATC_TYPE_INFO, atcObjectUrl, parseAtcPackageName } from '../../clients/atc.js';
import { CliError } from '../../output/json.js';
import { atcArtifactFor, type AtcLocal, type AtcType } from '../../formats/atc/json.js';
import { resolveFile } from '../../formats/file-resolver.js';
import { isLocalPackageName } from '../../core/transport.js';

export interface PushAtcOptions {
  /** Transport request to record the update in (`corrNr`). */
  transport?: string;
  /** false when `abap push --no-activate` was passed. */
  activate?: boolean;
}

export interface PushAtcResult {
  object: string;
  channel: 'adt';
  action: 'updated';
  activated: boolean;
}

function nameFromFile(type: AtcType, file: string): string {
  const resolved = resolveFile(file);
  if (resolved.objectType !== type) {
    throw new CliError('VALIDATION_ERROR', `Expected a .${type.toLowerCase()}.json file, got ${path.basename(file)}`, {
      file,
      type,
    });
  }
  return resolved.objectName;
}

export async function runPushAtc(
  client: AdtClientWrapper,
  type: AtcType,
  file: string,
  opts: PushAtcOptions = {},
): Promise<PushAtcResult> {
  const name = nameFromFile(type, file);
  const artifact = atcArtifactFor(type);
  let doc: AtcLocal;
  try {
    doc = await artifact.read(path.resolve(process.cwd(), file));
  } catch (error: unknown) {
    throw new CliError(
      'FILE_PARSE_ERROR',
      `Cannot read ${type} file ${file}: ${error instanceof Error ? error.message : String(error)}`,
      { file, type },
    );
  }
  const errors = await artifact.validate(doc);
  if (errors.length > 0) {
    throw new CliError('AFF_FIXTURE_INVALID', `${type} file ${file} failed schema validation: ${errors.join('; ')}`, {
      file,
      type,
      details: errors,
    });
  }

  // Existence + package read-back. A 404 must not fall through to a create.
  let packageName: string | undefined;
  try {
    const xml = await client.getAtcObject(type, name);
    packageName = parseAtcPackageName(type, xml);
  } catch (error) {
    if (error instanceof CliError && (error.details?.httpStatus === 404 || error.code === 'OBJECT_NOT_FOUND')) {
      throw new CliError('OBJECT_NOT_FOUND', `${type} ${name} does not exist; create it first`, {
        object: name,
        type,
        nextSteps: [`Create it: abap create ${type} ${name} --file ${file} --package $TMP --yes`],
        example: `abap create ${type} ${name} --file ${file} --package $TMP --yes`,
      });
    }
    throw error;
  }
  // Non-local objects need a transport request; local (`$`) packages are
  // transport-free and a stray --tr must not reach SAP.
  let transport = opts.transport;
  if (isLocalPackageName(packageName)) {
    transport = undefined;
  } else if (!transport) {
    throw new CliError('MISSING_TRANSPORT', `${type} ${name} is in package ${packageName ?? '?'}; --tr is required`, {
      object: name,
      type,
      details: { packageName },
      nextSteps: [
        'Pass --tr <request> to record the change in a transportable request.',
        'Or move the object to a local package ($TMP) for scratch work.',
      ],
      example: `abap push ${file} --tr NDK900123 --yes`,
    });
  }

  await client.updateAtcObject(type, name, doc, {
    ...(packageName ? { packageName } : {}),
    ...(transport ? { transport } : {}),
  });
  const activated = opts.activate !== false;
  if (activated) {
    await client.activate(atcObjectUrl(type, name), ATC_TYPE_INFO[type].objtype, name);
  }
  return { object: name, channel: 'adt', action: 'updated', activated };
}
