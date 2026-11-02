/**
 * BDEF create flow — ADT only.
 *
 * Reads the AFF `<name>.bdef.json` (header metadata) and the companion
 * `<name>.bdef.abdl` source, creates the header through the blueSource
 * endpoint, then writes + activates the source. Mirrors `create-ddls.ts`.
 */
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { CliError, printResult, type OutputMode } from '../../output/json.js';
import { bdefArtifact, type BdefLocal } from '../../formats/bdef/json.js';
import { toOutputPath } from '../../core/path-output.js';
import { transportForPackage } from '../../core/transport.js';
import { affObjectToken } from '../../formats/file-resolver.js';
import type { CreateOptions } from './create.js';
import type { CreateHandler } from './routing.js';

const BDEF_JSON_SUFFIX = '.bdef.json';
const BDEF_SOURCE_SUFFIX = '.bdef.abdl';

export async function runCreateBdef(
  name: string,
  opts: CreateOptions,
  mode: OutputMode,
): Promise<void> {
  if (!opts.file) {
    throw new CliError('USAGE', 'Type BDEF requires --file <path> with an abap-file-format JSON', {
      example: `abap create BDEF ${name} --file src/${affObjectToken(name)}.bdef.json --package $TMP --yes`,
    });
  }
  const filePath = path.resolve(process.cwd(), opts.file);
  let doc: BdefLocal;
  try {
    doc = await bdefArtifact.read(filePath);
  } catch (error: unknown) {
    throw new CliError(
      'FILE_PARSE_ERROR',
      `Cannot read BDEF file ${toOutputPath(opts.file)}: ${error instanceof Error ? error.message : String(error)}`,
      { file: toOutputPath(opts.file) },
    );
  }
  const errors = await bdefArtifact.validate(doc);
  if (errors.length > 0) {
    throw new CliError(
      'VALIDATION_ERROR',
      `Invalid BDEF definition in ${toOutputPath(opts.file)}: ${errors.join('; ')}`,
      { file: toOutputPath(opts.file), details: errors },
    );
  }
  if (!filePath.endsWith(BDEF_JSON_SUFFIX)) {
    throw new CliError(
      'VALIDATION_ERROR',
      `BDEF metadata must use the ${BDEF_JSON_SUFFIX} suffix: ${toOutputPath(opts.file)}`,
      { file: toOutputPath(opts.file) },
    );
  }
  const sourcePath = `${filePath.slice(0, -BDEF_JSON_SUFFIX.length)}${BDEF_SOURCE_SUFFIX}`;
  let source: string;
  try {
    source = await fs.readFile(sourcePath, 'utf8');
  } catch {
    throw new CliError('VALIDATION_ERROR', `BDEF companion file missing: ${sourcePath}`, {
      file: sourcePath,
      nextSteps: ['Both files must be supplied on create — write the .abdl source next to the JSON.'],
    });
  }

  const targetPackage = (opts.package ?? '$TMP').trim().toUpperCase();
  // A stray --tr on a local package must not reach SAP.
  const transport = transportForPackage(targetPackage, opts.tr);
  const client = await AdtClientWrapper.create();
  await client.createBdef(name, {
    packageName: targetPackage,
    description: doc.header.description,
    originalLanguage: doc.header.originalLanguage,
    ...(transport ? { transport } : {}),
  });
  await client.writeBdefSource(name, source, transport);
  printResult(
    mode,
    { object: name, type: 'BDEF', action: 'created', channel: 'adt' },
    `Created BDEF ${name} via ADT`,
  );
}

export const createBdefHandler: CreateHandler = async ({ name, opts, mode }) => {
  await runCreateBdef(name, opts, mode);
};
