/**
 * Type pool (TYPE) pull flow — ADT only.
 *
 * Writes the AFF pair: `<name>.type.json` (header) and `<name>.type.abap`
 * (classic ABAP source from `source/main`). A missing type pool maps to
 * `OBJECT_NOT_FOUND`.
 */
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { parseTypegroupMeta } from '../../clients/typegroups.js';
import { CliError } from '../../output/json.js';
import { typeArtifact, type TypeLocal } from '../../formats/type/json.js';
import { affObjectToken, buildFilename } from '../../formats/file-resolver.js';
import { toOutputPath } from '../../core/path-output.js';
import type { PullHandler } from './routing.js';

export async function runPullType(name: string, opts: { dir?: string } = {}): Promise<{
  object: string;
  channel: 'adt';
  files: string[];
  doc: TypeLocal;
  source: string;
}> {
  const upper = name.trim().toUpperCase();
  const dir = opts.dir ?? '.';
  const client = await AdtClientWrapper.create();
  let meta: { xml: string; source: string };
  try {
    meta = await client.getTypegroup(upper);
  } catch (error) {
    if (error instanceof CliError && (error.details?.httpStatus === 404 || error.code === 'OBJECT_NOT_FOUND')) {
      throw new CliError('OBJECT_NOT_FOUND', `TYPE ${upper} not found`, {
        object: upper,
        type: 'TYPE',
        nextSteps: [`Verify the name/type: 'abap search ${upper}'.`, 'Type pool names are at most five characters.'],
      });
    }
    throw error;
  }
  const doc: TypeLocal = {
    formatVersion: '1',
    header: parseTypegroupMeta(meta.xml).header,
  };
  const errors = await typeArtifact.validate(doc);
  if (errors.length > 0) {
    throw new CliError('AFF_FIXTURE_INVALID', `Pulled TYPE ${upper} failed schema: ${errors.join('; ')}`, {
      object: upper,
      type: 'TYPE',
      details: errors,
    });
  }

  const token = affObjectToken(upper);
  const jsonName = buildFilename(upper, 'TYPE', undefined, '.json');
  const sourceName = buildFilename(upper, 'TYPE', undefined, '.abap');
  const jsonPath = path.resolve(process.cwd(), dir, jsonName);
  const sourcePath = path.resolve(process.cwd(), dir, sourceName);
  await typeArtifact.write(jsonPath, doc);
  await fs.writeFile(sourcePath, meta.source, 'utf8');
  return {
    object: upper,
    channel: 'adt',
    files: [toOutputPath(jsonPath), toOutputPath(sourcePath)],
    doc,
    source: meta.source,
  };
}

export const pullTypeHandler: PullHandler = async ({ objectName, opts }) => {
  const result = await runPullType(objectName, { dir: opts.dir });
  return { object: result.object, channel: result.channel, files: result.files };
};
