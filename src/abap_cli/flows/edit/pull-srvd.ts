/**
 * T3.1 — SRVD (service definition) pull.
 *
 * Output:
 *   <rootDir>/srvd/<lower>/<lower>.srvd.json   ← AFF metadata
 *                                                 (generalInformation.sourceOrigin + sourceType)
 *   <rootDir>/srvd/<lower>/<lower>.srvd.acds   ← DDL-like service body
 *                                                 (define service …)
 *
 * Reuses the shared `pullObject` flow in `pull-source.ts` via the
 * `sourceObjectStrategy()` (SRVD lives in SOURCE_OBJECT_TYPES). The
 * dedicated module exists so the CLI / external callers can call a
 * typed `runPullSrvd` entry point without going through the generic
 * `runPull` dispatcher.
 */
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { pullObject } from './pull-source.js';
import { folderFor } from '../../formats/type-folder.js';

export interface PullSrvdOptions {
  profile?: { kernelRelease?: string };
  rootDir?: string;
  type?: string;
  package?: string;
  tr?: string;
  dir?: string;
  overwrite?: boolean;
  skipExisting?: boolean;
  includeTests?: boolean;
  includeAllParts?: boolean;
  limit?: string;
  page?: string;
  textpool?: boolean;
  remote?: string;
}

export interface PullSrvdResult {
  object: string;
  files: string[];
}

export async function runPullSrvd(name: string, opts: PullSrvdOptions = {}): Promise<PullSrvdResult> {
  const lower = name.toLowerCase();
  const client = await AdtClientWrapper.create();
  // Reuse the shared pull path — `strategyFor('SRVD')` returns the
  // sourceObjectStrategy configured for `.acds` + `renderSourceMetadata`
  // (which projects sourceOrigin/sourceType under `generalInformation`
  // per srvd-v1.json). AFF pre-validation runs inside `writePullFile`.
  const object = {
    name: name.toUpperCase(),
    type: 'SRVD',
    objectUrl: `/sap/bc/adt/srvd/srvds/${lower}`,
  };
  const result = await pullObject(client, object, {
    ...(opts.dir ? { dir: opts.dir } : { dir: opts.rootDir ?? process.cwd() }),
    overwrite: opts.overwrite,
    skipExisting: opts.skipExisting,
  });
  // Cross-check: every file should land under <root>/srvd/<lower>/.
  const expectedFolder = folderFor('SRVD');
  for (const f of result.written) {
    if (!f.includes(`/${expectedFolder}/${lower}/`)) {
      throw new Error(`SRVD file landed outside the expected folder: ${f}`);
    }
  }
  return {
    object: object.name,
    files: result.written,
  };
}
