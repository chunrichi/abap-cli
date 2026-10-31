/**
 * DEVC (package) pull flow.
 *
 * The package wire format is a single ADT resource
 * (`GET /sap/bc/adt/packages/<name>`, `application/vnd.sap.adt.packages.v2+xml`)
 * with no source include, so pull writes exactly one AFF document:
 * `<dir>/<name>.devc.json`. Field mapping lives in `formats/devc/json.ts`.
 */
import * as path from 'node:path';
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { buildFilename } from '../../formats/file-resolver.js';
import { wireToLocal } from '../../formats/devc/json.js';
import { normalizePullData } from '../../core/path-output.js';
import { normalizeName } from './object-name.js';
import { writePullFile } from './pull-source.js';
import type { PullEntry, PullOptions, PullResult } from './pull-shared.js';
import type { PullHandler } from './routing.js';

export async function runPullDevc(objectName: string, opts: PullOptions): Promise<PullResult> {
  const name = normalizeName(objectName);
  const client = await AdtClientWrapper.create();
  const xml = await client.getPackage(name);
  const doc = wireToLocal(xml);
  const content = JSON.stringify(doc, null, 2) + '\n';

  const relPath = path.join(opts.dir, buildFilename(name, 'DEVC', undefined, '.json'));
  const written = await writePullFile({
    filePath: relPath,
    content,
    overwrite: opts.overwrite,
    skipExisting: opts.skipExisting,
    object: { name, type: 'DEVC' },
  });

  const entry: PullEntry = {
    object: name,
    type: 'DEVC',
    status: written.status,
    files: [written.outPath],
    ...(written.detail ? { detail: written.detail } : {}),
  };
  return {
    data: normalizePullData({
      object: name,
      type: 'DEVC',
      entries: [entry],
      written: written.status === 'written' ? 1 : 0,
      skipped: written.status === 'skipped' ? 1 : 0,
      failed: 0,
      channel: 'adt',
    }),
    human:
      `Pulled DEVC ${name} via adt; ` +
      (written.status === 'written' ? `wrote ${written.outPath}` : `skipped ${written.outPath} (${written.detail ?? 'already matches'})`),
  };
}

export const pullDevcHandler: PullHandler = async ({ objectName, opts }) => runPullDevc(objectName, opts);
