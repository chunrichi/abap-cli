/**
 * Generic AFF create. The transport depends on the type's channel:
 *
 *   - APLO / CHDO / EVTB / SMBC (`affChannel: 'adt-blue'`): the object is an
 *     ADT blueSource resource whose `source/main` is the official AFF document.
 *     Create posts the blueSource metadata, then writes the document under a
 *     lock (which saves the object and activates it).
 *   - ENHO / ENHS (`affChannel: 'icf'`): read-only. The dispatcher rejects the
 *     create before this flow runs; the local guard here is defensive.
 *
 * In both cases `--file` must be the canonical main AFF document
 * (`<object-token>.<type>.json`); companions of the same prefix are discovered
 * and validated together, and the document is checked against its vendored
 * schema before any SAP round-trip.
 */
import * as path from 'node:path';
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { CliError, printResult, type OutputMode } from '../../output/json.js';
import { collectWarning } from '../../output/meta.js';
import { toOutputPath } from '../../core/path-output.js';
import { createUnsupportedReasonFor } from '../../types/registry.js';
import {
  affHeaderInfo,
  affMainFileName,
  applyAffDescription,
  assertAffMainFile,
  discoverAffBundleFiles,
  parseAffMainDocument,
  readAffBundle,
  validateAffBundle,
  type AffBundle,
  type AffBundleFile,
} from '../../formats/aff/bundle.js';
import { createAdtAffObject, pullAdtAffObject, requireSingleAffDocument } from '../../formats/aff/adt-transport.js';
import {
  affChannelForType,
  affTransportFor,
  normalizeAffObjectName,
  requireAdtAffType,
  requireAffBundleType,
} from './aff-shared.js';
import { writeAffBundle } from './pull-aff.js';
import type { CreateOptions } from './create.js';
import type { CreateHandler } from './routing.js';

export async function runCreateAff(
  typeArg: string,
  objectName: string,
  opts: CreateOptions,
  mode: OutputMode,
): Promise<void> {
  const type = requireAffBundleType(typeArg);
  const channel = affChannelForType(type);
  const name = normalizeAffObjectName(objectName);
  if (!opts.file) {
    throw new CliError('USAGE', `Type ${type} requires --file <path> with the main AFF document`, {
      type,
      object: name,
      example: `abap create ${type} ${name} --file src/<object-token>.${type.toLowerCase()}.json --package '$TMP' --yes`,
    });
  }
  if (opts.activate === false) {
    throw new CliError('VALIDATION_ERROR', `${type} AFF writes save and activate in one step; --no-activate is not supported`, {
      type,
      object: name,
      nextSteps: [
        'Drop --no-activate: the object is saved/active as soon as the AFF write succeeds.',
        'AFF objects have no separate activation step in this CLI.',
      ],
    });
  }

  const mainPath = path.resolve(process.cwd(), opts.file);
  const outFile = toOutputPath(opts.file);
  assertAffMainFile(mainPath, name, type);

  const dir = path.dirname(mainPath);
  const localFiles = await discoverAffBundleFiles(dir, name, type);
  let bundle: AffBundleFile[] = await readAffBundle(localFiles);
  // --description overrides the AFF header description (same rule as DDIC).
  if (opts.description) {
    const mainName = affMainFileName(name, type);
    bundle = bundle.map((file) =>
      file.name.toLowerCase() === mainName ? applyAffDescription(file, opts.description!) : file,
    );
  }
  await validateAffBundle(bundle, name, type);

  const targetPackage = (opts.package as string).trim().toUpperCase();

  // --check-only: the local bundle is the proposed object; nothing is sent.
  if (opts.checkOnly) {
    printResult(
      mode,
      {
        object: name,
        type,
        channel,
        checkOnly: true,
        valid: true,
        package: targetPackage,
        files: bundle.map((file) => file.name),
        file: outFile,
      },
      `Validation passed for ${type} ${name} (no object created).`,
    );
    return;
  }

  if (channel === 'icf') {
    throw new CliError(
      'VALIDATION_ERROR',
      `Cannot create ${type}: ${createUnsupportedReasonFor(type) ?? 'the ICF /aff channel is read-only for this type'}`,
      {
        type,
        object: name,
        nextSteps: [
          `Pull the existing object instead: abap pull ${name} --type ${type}`,
          'Maintain enhancement spots/implementations in Eclipse ADT/SEEF.',
        ],
      },
    );
  }

  const adtType = requireAdtAffType(type);
  const docFile = requireSingleAffDocument(bundle, type);
  const header = affHeaderInfo(parseAffMainDocument(bundle, name, type));
  const description = (opts.description ?? header.description ?? name).trim() || name;
  const transport = affTransportFor({ type, name, packageName: targetPackage }, opts.tr, 'create');

  const client = await AdtClientWrapper.create();
  await createAdtAffObject(client, adtType, {
    objectName: name,
    packageName: targetPackage,
    description,
    ...(header.originalLanguage ? { originalLanguage: header.originalLanguage } : {}),
    ...(transport ? { transport } : {}),
    source: docFile.content,
  });

  // create-then-pull (default): local state = canonical SAP serialization.
  let localFilesWritten: string[] = [];
  if (opts.pull !== false) {
    const fresh = await pullAdtAffObject(client, adtType, name);
    const freshBundle: AffBundle = {
      type,
      name,
      ...(fresh.meta.packageName ? { package: fresh.meta.packageName } : {}),
      files: [{ name: affMainFileName(name, type), content: fresh.source }],
    };
    const write = await writeAffBundle(freshBundle, {
      dir: 'src',
      overwrite: opts.overwrite === true,
      skipExisting: opts.overwrite !== true,
    });
    localFilesWritten = [...write.written, ...write.skipped];
    for (const kept of write.skippedExisting) {
      if (!kept.changed) continue;
      collectWarning(
        'LOCAL_FILE_KEPT',
        `${kept.file} already exists and was left untouched; the fresh SAP copy was not written. Re-run with --overwrite to replace it.`,
        { file: kept.file },
      );
    }
  }

  printResult(
    mode,
    {
      object: name,
      type,
      channel: 'adt',
      action: 'created',
      package: targetPackage,
      transport: transport ?? '',
      activated: true,
      files: [docFile.name],
      localFiles: localFilesWritten.length > 0 ? localFilesWritten : undefined,
    },
    `Created ${type} ${name} via ADT${transport ? ` (transport ${transport})` : ''}` +
      (localFilesWritten.length > 0 ? `; pulled ${localFilesWritten.join(', ')}` : ''),
  );
}

export const createAffHandler: CreateHandler = async ({ type, name, opts, mode }) => {
  await runCreateAff(type, name, opts, mode);
};
