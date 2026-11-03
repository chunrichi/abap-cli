/**
 * Application-job push flow — SAJC / SAJT (ADT only).
 *
 * `push` updates an existing object: the local AFF document is validated, the
 * target system's JSON model is detected (the local AFF v1 document is
 * translated, and fields the target's legacy model cannot carry are rejected
 * instead of silently dropped), the object's package is read from the metadata
 * resource so the transport rule stays honest, then the document is written
 * under a lock. Writing `source/main` saves and activates in one step, so
 * `--no-activate` is rejected rather than silently ignored.
 *
 * A missing object maps to `OBJECT_NOT_FOUND` with a `create` pointer — push
 * never creates.
 */
import * as path from 'node:path';
import type { AdtClientWrapper } from '../../clients/adt-client.js';
import { parseAppJobMeta, rethrowAppJobSaveError } from '../../clients/appjob.js';
import { CliError } from '../../output/json.js';
import { appjobArtifactFor, type AppJobLocal, type AppJobType } from '../../formats/appjob/json.js';
import { toWireDocument } from '../../formats/appjob/wire.js';
import { isLocalPackageName } from '../../core/transport.js';
import { detectTargetWireFormat, nameFromAppJobFile } from './appjob-shared.js';

export interface PushAppJobOptions {
  /** Transport request to record the update in (`corrNr`). */
  transport?: string;
  /** false when `abap push --no-activate` was passed. */
  activate?: boolean;
}

export interface PushAppJobResult {
  object: string;
  channel: 'adt';
  action: 'updated';
  activated: boolean;
}

export async function runPushAppJob(
  client: AdtClientWrapper,
  type: AppJobType,
  file: string,
  opts: PushAppJobOptions = {},
): Promise<PushAppJobResult> {
  const name = nameFromAppJobFile(type, file);
  const artifact = appjobArtifactFor(type);
  const filePath = path.resolve(process.cwd(), file);
  let doc: AppJobLocal;
  try {
    doc = await artifact.read(filePath);
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

  // Existence + package read-back for the transport rule. A 404 must not fall
  // through to a create.
  let packageName: string | undefined;
  try {
    packageName = parseAppJobMeta(type, await client.getAppJobObject(type, name)).packageName;
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
  // Local (`$`-prefixed) packages are transport-free and a stray --tr must not
  // reach SAP; everything else needs an active request.
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

  if (opts.activate === false) {
    throw new CliError('VALIDATION_ERROR', `${type} JSON resources are saved and activated in one step; --no-activate is not supported`, {
      object: name,
      type,
      nextSteps: [
        'Drop --no-activate: the object is active as soon as the write succeeds.',
        'Application-job objects have no inactive version to activate later.',
      ],
    });
  }
  const format = await detectTargetWireFormat(client, type);
  const source = toWireDocument(type, doc, format);

  try {
    await client.writeAppJobSource(type, name, source, {
      ...(transport ? { transport } : {}),
      // The AFF header description lives in the object metadata, not in the
      // source document: sync it under the same lock so a pull → edit → push
      // round-trip keeps them aligned. The original language is forwarded so
      // the metadata PUT does not try to change the object's master language.
      description: doc.header.description,
      originalLanguage: doc.header.originalLanguage,
    });
    // No activation request: writing source/main saves the JSON as active.
    return { object: name, channel: 'adt', action: 'updated', activated: true };
  } catch (error) {
    rethrowAppJobSaveError(type, name, error);
  }
}
