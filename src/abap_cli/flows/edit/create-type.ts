/**
 * Type pool (TYPE) create flow — ADT only.
 *
 * Reads the AFF metadata (`<name>.type.json`) plus the classic ABAP companion
 * (`<name>.type.abap`), posts the object to the type-groups collection, writes
 * the source under a lock and activates it. Type pools are limited to five
 * characters, so the name is validated before the create request.
 */
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { assertTypegroupName } from '../../clients/typegroups.js';
import { CliError, printResult, type OutputMode } from '../../output/json.js';
import { typeArtifact, type TypeLocal } from '../../formats/type/json.js';
import { affObjectToken } from '../../formats/file-resolver.js';
import { toOutputPath } from '../../core/path-output.js';
import { transportForPackage } from '../../core/transport.js';
import type { CreateOptions } from './create.js';
import type { CreateHandler } from './routing.js';

/** Companion source path for a `*.type.json` metadata document. */
export function typeSourcePath(jsonPath: string): string {
  return jsonPath.replace(/\.type\.json$/i, '.type.abap');
}

export async function runCreateType(name: string, opts: CreateOptions, mode: OutputMode): Promise<void> {
  const upper = assertTypegroupName(name);
  if (!opts.file) {
    throw new CliError('USAGE', 'Type TYPE requires --file <path> with an abap-file-format JSON', {
      example: `abap create TYPE ${upper} --file src/${upper.toLowerCase()}.type.json --package $TMP --yes`,
    });
  }
  const filePath = path.resolve(process.cwd(), opts.file);
  if (!filePath.toLowerCase().endsWith('.type.json')) {
    throw new CliError('VALIDATION_ERROR', `TYPE metadata must use the .type.json suffix: ${toOutputPath(opts.file)}`, {
      file: toOutputPath(opts.file),
    });
  }
  const expected = `${affObjectToken(upper)}.type.json`;
  if (path.basename(filePath).toLowerCase() !== expected) {
    throw new CliError('VALIDATION_ERROR', `File ${path.basename(filePath)} does not match type pool ${upper}; expected ${expected}`, {
      object: upper,
      type: 'TYPE',
      nextSteps: [`Rename the document to ${expected}, or create the object named by the file.`],
    });
  }
  let doc: TypeLocal;
  try {
    doc = await typeArtifact.read(filePath);
  } catch (error: unknown) {
    throw new CliError('FILE_PARSE_ERROR', `Cannot read TYPE file ${toOutputPath(opts.file)}: ${error instanceof Error ? error.message : String(error)}`, {
      file: toOutputPath(opts.file),
    });
  }
  const errors = await typeArtifact.validate(doc);
  if (errors.length > 0) {
    throw new CliError('VALIDATION_ERROR', `Invalid TYPE definition in ${toOutputPath(opts.file)}: ${errors.join('; ')}`, {
      file: toOutputPath(opts.file),
      details: errors,
    });
  }
  const sourcePath = typeSourcePath(filePath);
  let source: string;
  try {
    source = await fs.readFile(sourcePath, 'utf8');
  } catch {
    throw new CliError('VALIDATION_ERROR', `TYPE companion source missing: ${path.basename(sourcePath)}`, {
      file: toOutputPath(opts.file),
      nextSteps: ['Write the classic ABAP source next to the JSON: `<name>.type.abap` (TYPE-POOL ... TYPES ...).'],
    });
  }
  if (!source.trim()) {
    throw new CliError('VALIDATION_ERROR', `TYPE companion source is empty: ${path.basename(sourcePath)}`, {
      file: sourcePath,
    });
  }

  const targetPackage = (opts.package ?? '$TMP').trim().toUpperCase();
  // A stray --tr on a local package must not reach SAP.
  const transport = transportForPackage(targetPackage, opts.tr);
  const client = await AdtClientWrapper.create();
  await client.createTypegroup(upper, {
    packageName: targetPackage,
    description: doc.header.description,
    originalLanguage: doc.header.originalLanguage,
    ...(transport ? { transport } : {}),
  });
  await client.writeTypegroupSource(upper, source, { ...(transport ? { transport } : {}) });
  const activated = opts.activate !== false;
  if (activated) await client.activateTypegroup(upper);
  printResult(
    mode,
    { object: upper, type: 'TYPE', action: 'created', channel: 'adt', activated },
    `Created TYPE ${upper} via ADT${activated ? '' : ' (inactive)'}`,
  );
}

export const createTypeHandler: CreateHandler = async ({ name, opts, mode }) => {
  await runCreateType(name, opts, mode);
};
