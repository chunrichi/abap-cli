/**
 * CDS technical object pull flow — DTDC / DTEB / DSFD / DSFI (ADT only).
 *
 * Source-bearing types read the metadata XML (header + package) and
 * `source/main` (`.acds`), then write the AFF pair. DSFI reads its single
 * JSON document from `source/main`, normalises SAP's empty
 * `abapLanguageVersion`, validates it and writes `<name>.dsfi.json`.
 */
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { parseCdsTechMeta, parseDsfiSource } from '../../clients/cds-tech.js';
import { CliError } from '../../output/json.js';
import { cdsTechArtifactFor, type CdsTechLocal, type CdsTechType, type DsfiLocal } from '../../formats/cds-tech/json.js';
import { buildFilename } from '../../formats/file-resolver.js';
import { toOutputPath } from '../../core/path-output.js';
import type { PullHandler } from './routing.js';

export async function runPullCdsTech(type: CdsTechType, name: string, opts: { dir?: string } = {}): Promise<{
  object: string;
  channel: 'adt';
  files: string[];
}> {
  const upper = name.trim().toUpperCase();
  const dir = opts.dir ?? '.';
  const client = await AdtClientWrapper.create();
  const artifact = cdsTechArtifactFor(type);

  let doc: CdsTechLocal;
  let source: string | undefined;
  try {
    if (type === 'DSFI') {
      doc = parseDsfiSource(await client.getCdsTechSource(type, upper));
    } else {
      const meta = parseCdsTechMeta(type, await client.getCdsTechObject(type, upper));
      source = await client.getCdsTechSource(type, upper);
      doc = { formatVersion: '1', header: meta.header };
    }
  } catch (error) {
    if (error instanceof CliError && (error.details?.httpStatus === 404 || error.code === 'OBJECT_NOT_FOUND')) {
      throw new CliError('OBJECT_NOT_FOUND', `${type} ${upper} not found`, {
        object: upper,
        type,
        nextSteps: [`Verify the name/type: 'abap search ${upper}'.`, 'CDS technical objects live in the DDIC/DSP area, not in a package browser.'],
      });
    }
    throw error;
  }

  const errors = await artifact.validate(doc);
  if (errors.length > 0) {
    throw new CliError('AFF_FIXTURE_INVALID', `Pulled ${type} ${upper} failed schema: ${errors.join('; ')}`, {
      object: upper,
      type,
      details: errors,
    });
  }

  const files: string[] = [];
  if (type === 'DSFI') {
    const filename = buildFilename(upper, type, undefined, '.json');
    await artifact.write(path.resolve(process.cwd(), dir, filename), doc as DsfiLocal);
    files.push(path.join(dir, filename));
  } else {
    const jsonName = buildFilename(upper, type, undefined, '.json');
    const acdsName = buildFilename(upper, type, undefined, '.acds');
    await artifact.write(path.resolve(process.cwd(), dir, jsonName), doc);
    await fs.writeFile(path.resolve(process.cwd(), dir, acdsName), source ?? '', 'utf8');
    files.push(path.join(dir, jsonName), path.join(dir, acdsName));
  }
  return {
    object: upper,
    channel: 'adt',
    files: files.map((f) => toOutputPath(f)),
  };
}

/** Per-type pull handler factory (one row per CDS technical type in `routing.ts`). */
export function pullCdsTechHandler(type: CdsTechType): PullHandler {
  return async ({ objectName, opts }) => {
    const result = await runPullCdsTech(type, objectName, { dir: opts.dir });
    return { object: result.object, channel: result.channel, files: result.files };
  };
}
