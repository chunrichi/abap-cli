/**
 * Type pool (TYPE) push flow — ADT only.
 *
 * Validates the AFF pair, reads the package from the metadata resource so the
 * transport rule stays honest, writes the source under a lock (with a metadata
 * PUT that keeps the AFF description in sync) and activates it unless
 * `--no-activate` was passed. Pushing the `.type.abap` companion directly is
 * rejected — it travels with its JSON document.
 */
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { assertTypegroupName, parseTypegroupMeta } from '../../clients/typegroups.js';
import { CliError } from '../../output/json.js';
import { typeArtifact, type TypeLocal } from '../../formats/type/json.js';
import { resolveFile } from '../../formats/file-resolver.js';
import { isLocalPackageName } from '../../core/transport.js';
import { typeSourcePath } from './create-type.js';

export interface PushTypeOptions {
  /** Transport request to record the update in (`corrNr`). */
  transport?: string;
  /** false when `abap push --no-activate` was passed. */
  activate?: boolean;
}

export interface PushTypeResult {
  object: string;
  channel: 'adt';
  action: 'updated';
  activated: boolean;
}

export async function runPushType(file: string, opts: PushTypeOptions = {}): Promise<PushTypeResult> {
  const resolved = resolveFile(file);
  if (resolved.objectType !== 'TYPE') {
    throw new CliError('VALIDATION_ERROR', `Expected a .type.json file, got ${path.basename(file)}`, {
      file,
      type: 'TYPE',
    });
  }
  if (resolved.format !== 'json') {
    throw new CliError(
      'INVALID_ARGUMENT',
      `${path.basename(file)} is the TYPE source companion; push its JSON document instead`,
      {
        file,
        type: 'TYPE',
        nextSteps: [`Push ${path.basename(file).replace(/\.type\.abap$/i, '.type.json')}; the companion is sent automatically.`],
      },
    );
  }
  const name = assertTypegroupName(resolved.objectName);
  const filePath = path.resolve(process.cwd(), file);
  let doc: TypeLocal;
  try {
    doc = await typeArtifact.read(filePath);
  } catch (error: unknown) {
    throw new CliError('FILE_PARSE_ERROR', `Cannot read TYPE file ${file}: ${error instanceof Error ? error.message : String(error)}`, {
      file,
      type: 'TYPE',
    });
  }
  const errors = await typeArtifact.validate(doc);
  if (errors.length > 0) {
    throw new CliError('AFF_FIXTURE_INVALID', `TYPE file ${file} failed schema validation: ${errors.join('; ')}`, {
      file,
      type: 'TYPE',
      details: errors,
    });
  }
  const sourcePath = typeSourcePath(filePath);
  let source: string;
  try {
    source = await fs.readFile(sourcePath, 'utf8');
  } catch {
    throw new CliError('VALIDATION_ERROR', `TYPE companion source missing: ${path.basename(sourcePath)}`, {
      file,
      nextSteps: [`Run 'abap pull ${name} --type TYPE' to regenerate the .type.json + .type.abap pair.`],
    });
  }
  if (!source.trim()) {
    throw new CliError('VALIDATION_ERROR', `TYPE companion source is empty: ${path.basename(sourcePath)}`, { file });
  }

  const client = await AdtClientWrapper.create();
  // Existence + package read-back; a 404 must not fall through to a create.
  let packageName: string | undefined;
  try {
    packageName = parseTypegroupMeta((await client.getTypegroup(name)).xml).packageName;
  } catch (error) {
    if (error instanceof CliError && (error.details?.httpStatus === 404 || error.code === 'OBJECT_NOT_FOUND')) {
      throw new CliError('OBJECT_NOT_FOUND', `TYPE ${name} does not exist; create it first`, {
        object: name,
        type: 'TYPE',
        nextSteps: [`Create it: abap create TYPE ${name} --file ${file} --package $TMP --yes`],
      });
    }
    throw error;
  }
  let transport = opts.transport;
  if (isLocalPackageName(packageName)) {
    transport = undefined;
  } else if (!transport) {
    throw new CliError('MISSING_TRANSPORT', `TYPE ${name} is in package ${packageName ?? '?'}; --tr is required`, {
      object: name,
      type: 'TYPE',
      details: { packageName },
      nextSteps: [
        'Pass --tr <request> to record the change in a transportable request.',
        'Or move the object to a local package ($TMP) for scratch work.',
      ],
      example: `abap push ${file} --tr NDK900123 --yes`,
    });
  }

  await client.writeTypegroupSource(name, source, {
    ...(transport ? { transport } : {}),
    description: doc.header.description,
  });
  const activated = opts.activate !== false;
  if (activated) await client.activateTypegroup(name);
  return { object: name, channel: 'adt', action: 'updated', activated };
}
