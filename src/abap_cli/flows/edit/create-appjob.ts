/**
 * Application-job create flow — SAJC / SAJT (ADT only).
 *
 * The local AFF JSON is validated against its vendored schema, translated to
 * the target release's wire model (`formats/appjob/wire.ts`), posted as a
 * blueSource object and written to `source/main` under a lock. The write *is*
 * the activation for these resources — no inactive version is ever created, so
 * `--no-activate` is rejected instead of silently ignored.
 *
 * Catalogue entries and templates reference other repository objects (the
 * executed class or the catalog entry). SAP validates those references at save
 * time and answers a generic rejection (localized to the logon language);
 * `rethrowAppJobSaveError` turns it into an actionable message.
 */
import * as path from 'node:path';
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { CliError, printResult, type OutputMode } from '../../output/json.js';
import { appjobArtifactFor, type AppJobLocal, type AppJobType } from '../../formats/appjob/json.js';
import { toWireDocument } from '../../formats/appjob/wire.js';
import { transportForPackage } from '../../core/transport.js';
import type { CreateOptions } from './create.js';
import type { CreateHandler } from './routing.js';
import { appJobSuffix, rethrowAppJobSaveError } from '../../clients/appjob.js';
import {
  assertAppJobFileName,
  assertAppJobNameLength,
  detectTargetWireFormat,
  expectedAppJobFile,
} from './appjob-shared.js';

export async function runCreateAppJob(
  type: AppJobType,
  name: string,
  opts: CreateOptions,
  mode: OutputMode,
): Promise<void> {
  const suffix = appJobSuffix(type);
  if (!opts.file) {
    throw new CliError('USAGE', `Type ${type} requires --file <path> with an abap-file-format JSON`, {
      example: `abap create ${type} ${name} --file src/${expectedAppJobFile(name, type)} --package $TMP --yes`,
    });
  }
  assertAppJobNameLength(type, name);
  // The ADT application-job JSON resources save and activate in one step: the
  // object is active as soon as source/main is written and there is never an
  // inactive version to activate later. Accepting --no-activate would leave the
  // caller believing the change is parked, so reject it explicitly.
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
  const filePath = path.resolve(process.cwd(), opts.file);
  if (!filePath.toLowerCase().endsWith(suffix)) {
    throw new CliError('VALIDATION_ERROR', `${type} document must use the ${suffix} suffix: ${opts.file}`, {
      file: opts.file,
      type,
    });
  }
  assertAppJobFileName(name, type, filePath);

  const artifact = appjobArtifactFor(type);
  let doc: AppJobLocal;
  try {
    doc = await artifact.read(filePath);
  } catch (error: unknown) {
    throw new CliError(
      'FILE_PARSE_ERROR',
      `Cannot read ${type} file ${opts.file}: ${error instanceof Error ? error.message : String(error)}`,
      { file: opts.file, type },
    );
  }
  const errors = await artifact.validate(doc);
  if (errors.length > 0) {
    throw new CliError('VALIDATION_ERROR', `Invalid ${type} definition in ${opts.file}: ${errors.join('; ')}`, {
      file: opts.file,
      type,
      details: errors,
    });
  }

  // --check-only: validate the document and the addressable name locally,
  // without any SAP write. The JSON resource has no separate "validate"
  // endpoint, so this is a local schema/name check (same contract as
  // `create --check-only` on the other `--file` types).
  if (opts.checkOnly) {
    printResult(
      mode,
      { object: name, type, checkOnly: true, valid: true, issues: [] },
      `Validation passed for ${type} ${name} (no object created).`,
    );
    return;
  }

  const client = await AdtClientWrapper.create();
  const format = await detectTargetWireFormat(client, type);
  const source = toWireDocument(type, doc, format);

  const targetPackage = (opts.package ?? '$TMP').trim().toUpperCase();
  // A stray --tr on a local package must not reach SAP.
  const transport = transportForPackage(targetPackage, opts.tr);
  await client.createAppJobObject(type, name, {
    packageName: targetPackage,
    description: doc.header.description,
    originalLanguage: doc.header.originalLanguage,
    ...(transport ? { transport } : {}),
  });
  try {
    await client.writeAppJobSource(type, name, source, {
      originalLanguage: doc.header.originalLanguage,
      ...(transport ? { transport } : {}),
    });
  } catch (error) {
    // The object header already exists at this point; a save rejection here is
    // a document/reference validation failure, not a duplicate-name error.
    rethrowAppJobSaveError(type, name, error);
  }

  // No activation request: the JSON write above is the save that makes the
  // document active (verified on the reference release — no inactive version is
  // ever created for these object types).
  printResult(
    mode,
    {
      object: name,
      type,
      action: 'created',
      channel: 'adt',
      activated: true,
    },
    `Created ${type} ${name} via ADT`,
  );
}

/** Per-type create handler factory (one row per application-job type in `routing.ts`). */
export function createAppJobHandler(type: AppJobType): CreateHandler {
  return async ({ name, opts, mode }) => {
    await runCreateAppJob(type, name, opts, mode);
  };
}
