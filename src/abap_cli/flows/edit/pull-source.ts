/**
 * Pull CLAS / INTF / PROG / FUGR (and any other ADT REST-routable object)
 * via the per-type `PullStrategy`.
 *
 * Pulls one object's selected parts into local files; the coordinator
 * (pull.ts) invokes this for both single-object and package-pull flows.
 */
import * as path from 'path';
import * as fs from 'fs/promises';
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { objectDirName } from '../../formats/file-resolver.js';
import { folderFor } from '../../formats/type-folder.js';
import { fileExists, writeAbapFile } from '../../formats/abap-source.js';
import { strategyFor } from '../../formats/pull-strategy.js';
import { CliError } from '../../output/json.js';
import { toOutputPath } from '../../core/path-output.js';
import type { PullEntry, PullResult } from './pull-shared.js';

export async function pullObject(
  client: AdtClientWrapper,
  object: { name: string; type: string; objectUrl: string },
  opts: { dir: string; overwrite?: boolean; skipExisting?: boolean; includeTests?: boolean; includeAllParts?: boolean },
): Promise<{ entries: PullEntry[]; written: string[]; skipped: string[]; failed: string[] }> {
  const files = await strategyFor(object.type).files({ client, object, opts });

  const entries: PullEntry[] = [];
  const written: string[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];

  // abap-file-format layout: one directory per object under <typeFolder>/<opts.dir>.
  const objectDir = objectDirName(object.name);
  const typeFolder = folderFor(object.type);

  for (const file of files) {
    await writeOne(await file.content(), file.filename);
  }
  return { entries, written, skipped, failed };

  /** Write one file with exists/skip/overwrite conflict handling. */
  async function writeOne(content: string, filename: string): Promise<void> {
    const filePath = path.join(opts.dir, typeFolder, objectDir, filename);
    const absPath = path.resolve(process.cwd(), filePath);
    if (await fileExists(absPath)) {
      const existing = await fs.readFile(absPath, 'utf-8');
      if (existing === content) {
        entries.push({ object: object.name, type: object.type, status: 'skipped', detail: 'already matches' });
        skipped.push(filePath);
        return;
      }
      if (opts.skipExisting) {
        entries.push({ object: object.name, type: object.type, status: 'skipped', detail: 'local file differs; --skip-existing' });
        skipped.push(filePath);
        return;
      }
      if (!opts.overwrite) {
        const outPath = toOutputPath(filePath);
        throw new CliError(
          'OVERWRITE_REQUIRED',
          `Local file ${outPath} differs from SAP; refusing to overwrite.`,
          {
            details: { file: outPath, object: object.name },
            nextSteps: [
              'Re-run with --overwrite to replace the local file.',
              'Or re-run with --skip-existing to keep the local file unchanged.',
            ],
            example: `abap pull ${object.name} --overwrite`,
          },
        );
      }
    }
    await writeAbapFile(absPath, content);
    const outPath = toOutputPath(filePath);
    entries.push({ object: object.name, type: object.type, status: 'written', files: [outPath] });
    written.push(outPath);
  }
}

export function humanSummary(
  object: { name: string; type: string },
  result: { written: string[]; skipped: string[] },
): string {
  const lines = [`Pulled ${object.name} (${object.type}):`];
  for (const f of result.written) lines.push(`  ${f}`);
  if (result.skipped.length > 0) {
    lines.push(`Skipped ${result.skipped.length} file(s):`);
    for (const f of result.skipped) lines.push(`  ${f}`);
  }
  return lines.join('\n');
}