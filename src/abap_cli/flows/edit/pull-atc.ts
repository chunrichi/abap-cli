/**
 * ATC configuration object pull flow — CHKC / CHKO / CHKV (ADT only).
 *
 * Reads the versioned ADT XML resource, projects it onto the vendored AFF
 * document (`chkc-v1` / `chko-v1` / `chkv-v1`), validates it against the
 * schema and writes `<name>.<type>.json` into `--dir` (default `src/`).
 *
 * The wire carries server-side details the AFF schema does not model
 * (timestamps, responsible user, remote-enabled implementation details, CHKV
 * syntax configuration). Those are intentionally dropped; pull is honest
 * about the AFF subset it returns.
 */
import * as path from 'node:path';
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { parseAtcObject } from '../../clients/atc.js';
import { CliError } from '../../output/json.js';
import { atcArtifactFor, type AtcLocal, type AtcType } from '../../formats/atc/json.js';
import { buildFilename } from '../../formats/file-resolver.js';
import { toOutputPath } from '../../core/path-output.js';
import type { PullHandler } from './routing.js';

export async function runPullAtc(type: AtcType, name: string, opts: { dir?: string } = {}): Promise<{
  object: string;
  channel: 'adt';
  files: string[];
}> {
  const upper = name.trim().toUpperCase();
  const dir = opts.dir ?? '.';
  const client = await AdtClientWrapper.create();
  let xml: string;
  try {
    xml = await client.getAtcObject(type, upper);
  } catch (error) {
    if (error instanceof CliError && (error.details?.httpStatus === 404 || error.code === 'OBJECT_NOT_FOUND')) {
      throw new CliError('OBJECT_NOT_FOUND', `${type} ${upper} not found`, {
        object: upper,
        type,
        nextSteps: [
          `Verify the name/type: 'abap search ${upper}'.`,
          `${type} objects live in ATC (transaction ATC / ADT); they are not DDIC objects.`,
        ],
      });
    }
    throw error;
  }

  const doc: AtcLocal = parseAtcObject(type, xml);
  const artifact = atcArtifactFor(type);
  const errors = await artifact.validate(doc);
  if (errors.length > 0) {
    throw new CliError('AFF_FIXTURE_INVALID', `Pulled ${type} ${upper} failed schema: ${errors.join('; ')}`, {
      object: upper,
      type,
      details: errors,
    });
  }

  const filename = buildFilename(upper, type, undefined, '.json');
  const targetPath = path.resolve(process.cwd(), dir, filename);
  await artifact.write(targetPath, doc);
  return {
    object: upper,
    channel: 'adt',
    files: [toOutputPath(path.join(dir, filename))],
  };
}

/** Per-type pull handler factory (one row per ATC type in `routing.ts`). */
export function pullAtcHandler(type: AtcType): PullHandler {
  return async ({ objectName, opts }) => {
    const result = await runPullAtc(type, objectName, { dir: opts.dir });
    return { object: result.object, channel: result.channel, files: result.files };
  };
}
