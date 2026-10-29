/**
 * T3.3 — BDEF (behavior definition) pull.
 *
 * Output:
 *   <rootDir>/bdef/<lower>/<lower>.bdef.json   ← AFF metadata
 *   <rootDir>/bdef/<lower>/<lower>.bdef.abdl   ← ABAP Behavior Language body
 *
 * BDEF objects live in `sourceObjectStrategy()` via the
 * `sourceExtensionForObjectType('BDEF') → '.abdl'` extension map.
 * Metadata is schema-validated against `bdef-v1.json` inside
 * `writePullFile` (T2.6 `affTypeFromFilename` now returns 'BDEF' for
 * `*.bdef.json`).
 */
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { pullObject } from './pull-source.js';
import { folderFor } from '../../formats/type-folder.js';
import { registerPullHandler } from '../../types/registry.js';

export interface PullBdefOptions {
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

export interface PullBdefResult {
  object: string;
  files: string[];
}

export async function runPullBdef(name: string, opts: PullBdefOptions = {}): Promise<PullBdefResult> {
  const lower = name.toLowerCase();
  const client = await AdtClientWrapper.create();
  const object = {
    name: name.toUpperCase(),
    type: 'BDEF',
    objectUrl: `/sap/bc/adt/bdef/bdefs/${lower}`,
  };
  const result = await pullObject(client, object, {
    ...(opts.dir ? { dir: opts.dir } : { dir: opts.rootDir ?? process.cwd() }),
    overwrite: opts.overwrite,
    skipExisting: opts.skipExisting,
  });
  const expectedFolder = folderFor('BDEF');
  for (const f of result.written) {
    if (!f.includes(`/${expectedFolder}/${lower}/`)) {
      throw new Error(`BDEF file landed outside the expected folder: ${f}`);
    }
  }
  return {
    object: object.name,
    files: result.written,
  };
}

// Module-load side effect: register BDEF in the pull handler table. Decision 2A.
registerPullHandler('BDEF', async ({ objectName, opts }) => {
  const r = await runPullBdef(objectName, opts as Parameters<typeof runPullBdef>[1]);
  return { object: r.object, files: r.files, channel: 'adt' as const };
});
