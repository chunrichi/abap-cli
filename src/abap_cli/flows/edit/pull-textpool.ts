/**
 * Pull textpool `.properties` files (texts / selections / headings) for an object
 * via the mixed-mode route (ADT or ICF, decided by the recorded profile).
 *
 * Q1: route is decided once per profile, no runtime fallback. See
 * `clients/textpool-router.ts`.
 */
import * as path from 'path';
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { IcfClient } from '../../clients/icf-client.js';
import { objectDirName } from '../../formats/file-resolver.js';
import { folderFor } from '../../formats/type-folder.js';
import { fileExists, writeAbapFile } from '../../formats/abap-source.js';
import { serializeTextpoolProperties, type TextElementCategory } from '../../formats/textpool/properties.js';
import { routeTextpool } from '../../clients/textpool-router.js';
import { CliError } from '../../output/json.js';
import type { ErrorCode } from '../../output/error-codes.js';
import { toOutputPath, normalizePullData } from '../../core/path-output.js';
import type { PullEntry, PullOptions, PullResult } from './pull-shared.js';

export async function runPullTextpool(objectName: string, type: string | undefined, opts: PullOptions): Promise<PullResult> {
  const objType = (type ?? 'PROG').toUpperCase();
  const { systemName } = await loadProjectConfig();
  const route = routeTextpool(systemName, 'read');

  const categories: TextElementCategory[] = ['symbols', 'selections', 'headings'];
  const entries: PullEntry[] = [];
  const written: string[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];

  const client = await AdtClientWrapper.create();
  const icf = await IcfClient.create();

  for (const adtCat of categories) {
    const fileCat: 'texts' | 'selections' | 'headings' = adtCat === 'symbols' ? 'texts' : adtCat;
    const filename = `${objectName.toLowerCase()}.${objType.toLowerCase()}.${fileCat}.en.properties`;
    const relPath = path.join(opts.dir, folderFor(objType), objectDirName(objectName), filename);
    const targetPath = path.resolve(process.cwd(), relPath);

    if (await fileExists(targetPath) && !opts.overwrite && !opts.skipExisting) {
      const outPath = toOutputPath(relPath);
      throw new CliError('OVERWRITE_REQUIRED', `${outPath} already exists; use --overwrite to replace it`, {
        file: outPath,
        nextSteps: ['Re-run with --overwrite to replace the existing file.'],
        example: `abap pull ${objectName} --textpool --overwrite`,
      });
    }
    if (await fileExists(targetPath) && opts.skipExisting) {
      const outPath = toOutputPath(relPath);
      entries.push({ object: objectName, type: objType, status: 'skipped', files: [outPath] });
      skipped.push(outPath);
      continue;
    }

    let content: string;
    if (route === 'adt') {
      const res = await client.getTextElements(objType, objectName, adtCat);
      content = serializeTextpoolProperties(fileCat, res.textElements ?? []);
    } else {
      const resp = await icf.getTextpool<{ elements?: Array<{ id: string; text: string }> }>(fileCat, objectName, objType);
      if (resp.status !== 'success' || !resp.data) {
        const code = resp.error?.code === 'TEXTPOOL_OBJECT_NOT_FOUND' ? 'OBJECT_NOT_FOUND' : (resp.error?.code as ErrorCode | undefined) ?? 'SAP_ERROR';
        const outPath = toOutputPath(relPath);
        entries.push({ object: objectName, type: objType, status: 'failed', code, detail: resp.error?.message, files: [outPath] });
        failed.push(outPath);
        continue;
      }
      content = serializeTextpoolProperties(
        fileCat,
        (resp.data.elements ?? []).map((e) => ({ id: e.id, text: e.text })),
      );
    }

    await writeAbapFile(targetPath, content);
    const outPath = toOutputPath(relPath);
    entries.push({ object: objectName, type: objType, status: 'written', files: [outPath] });
    written.push(outPath);
  }

  return {
    data: normalizePullData({ object: objectName, type: objType, route, entries, written, skipped, failed }),
    human: `Pulled textpool for ${objType} ${objectName} (route: ${route})`,
  };
}

/** Load the active system name for route decisions. */
async function loadProjectConfig(): Promise<{ systemName: string }> {
  const { loadConfig } = await import('../../config/project-config.js');
  const cfg = await loadConfig();
  return { systemName: cfg.systemName };
}