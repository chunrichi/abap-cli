/**
 * Application-job pull flow — SAJC / SAJT (ADT only).
 *
 * Reads the object's `source/main` JSON document (the blueSource metadata XML
 * is not needed: the document carries the header), translates the release's
 * wire model to the local AFF v1 document, validates it and writes
 * `<name>.sajc.json` / `<name>.sajt.json`.
 */
import * as path from 'node:path';
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { APPJOB_INFO } from '../../clients/appjob.js';
import { CliError } from '../../output/json.js';
import { appjobArtifactFor, type AppJobLocal, type AppJobType } from '../../formats/appjob/json.js';
import { fromWireDocument } from '../../formats/appjob/wire.js';
import { buildFilename } from '../../formats/file-resolver.js';
import { toOutputPath } from '../../core/path-output.js';
import type { PullHandler } from './routing.js';

export async function runPullAppJob(
  type: AppJobType,
  name: string,
  opts: { dir?: string } = {},
): Promise<{ object: string; channel: 'adt'; files: string[] }> {
  const upper = name.trim().toUpperCase();
  const dir = opts.dir ?? '.';
  const client = await AdtClientWrapper.create();
  const artifact = appjobArtifactFor(type);

  let doc: AppJobLocal;
  try {
    doc = fromWireDocument(type, await client.getAppJobSource(type, upper)).doc;
  } catch (error) {
    if (error instanceof CliError && (error.details?.httpStatus === 404 || error.code === 'OBJECT_NOT_FOUND')) {
      throw new CliError('OBJECT_NOT_FOUND', `${type} ${upper} not found`, {
        object: upper,
        type,
        nextSteps: [
          `Verify the name/type: 'abap search ${upper}'.`,
          `Application job objects live in the Application Jobs group (ADT /sap/bc/adt/applicationjob/...).`,
        ],
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

  const filename = buildFilename(upper, type, undefined, '.json');
  const filePath = path.resolve(process.cwd(), dir, filename);
  await artifact.write(filePath, doc);
  return { object: upper, channel: 'adt', files: [toOutputPath(filePath)] };
}

/** Per-type pull handler factory (one row per application-job type in `routing.ts`). */
export function pullAppJobHandler(type: AppJobType): PullHandler {
  return async ({ objectName, opts }) => {
    const result = await runPullAppJob(type, objectName, { dir: opts.dir });
    return { object: result.object, channel: result.channel, files: result.files };
  };
}

/** Exported for tests: the ADT object type + label a pull addresses. */
export function appJobPullInfo(type: AppJobType): { objtype: string; label: string } {
  return { objtype: APPJOB_INFO[type].objtype, label: APPJOB_INFO[type].label };
}
