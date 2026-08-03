import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs/promises';
import { AdtClientWrapper } from '../clients/adt-client.js';
import { buildFilename } from '../formats/file-resolver.js';
import { fileExists, writeAbapFile } from '../formats/abap-source.js';
import { CliError, printError, printResult, jsonFromCommand } from '../output/json.js';
import { commonErrorsAfter } from '../output/help-text.js';
import { resolveObject, getObjectParts } from '../sync/resolve.js';

export function registerPullCommand(program: Command): void {
  program
    .command('pull')
    .description('Download ABAP objects from SAP to local files')
    .addHelpText('after', commonErrorsAfter())
    .argument('[object-name]', 'Object name to download (e.g., ZCL_MY_CLASS)')
    .option('--type <type>', 'Object type (CLAS, PROG, INTF, etc.)')
    .option('--package <package>', 'Download all objects in a package (not implemented in this phase)')
    .option('--dir <path>', 'Output directory', 'src/')
    .option('--overwrite', 'Allow replacing a local file with different content')
    .option('--skip-existing', 'Skip files that already exist locally')
    .option('--include-tests', 'Include testclasses source part')
    .option('--include-all-parts', 'Include every source-code part')
    .action(async (objectName: string, opts, cmd) => {
      const json = jsonFromCommand(cmd);
      try {
        await runPull(objectName, opts, json);
      } catch (error: unknown) {
        printError(json, error);
      }
    });
}

interface PullEntry {
  object: string;
  type: string;
  status: 'written' | 'skipped' | 'failed';
  files?: string[];
  detail?: string;
  code?: string;
}

async function runPull(
  objectName: string,
  opts: {
    type?: string;
    package?: string;
    dir: string;
    overwrite?: boolean;
    skipExisting?: boolean;
    includeTests?: boolean;
    includeAllParts?: boolean;
  },
  json: boolean,
): Promise<void> {
  if (opts.package) {
    throw new CliError(
      'NOT_IMPLEMENTED',
      '--package batch pull is not implemented in this phase',
      {
        nextSteps: ['Single-object pull works today; batch is planned for a follow-up spec.'],
        example: 'abap pull ZCL_DEMO',
      },
    );
  }
  if (!objectName) {
    throw new CliError('USAGE', 'Specify an object name (e.g., ZCL_MY_CLASS)', {
      nextSteps: ['Run `abap search <query>` first if you do not know the exact name.'],
      example: 'abap pull ZCL_DEMO',
    });
  }

  const client = await AdtClientWrapper.create();
  const object = await resolveObject(client, objectName, opts.type);
  const allParts = await getObjectParts(client, object);

  // Filter parts per flags. By default omit testclasses.
  const parts = opts.includeAllParts
    ? allParts
    : allParts.filter((p) => opts.includeTests ? true : p.subtype !== 'testclasses');

  const entries: PullEntry[] = [];
  const written: string[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];
  for (const part of parts) {
    const content = await client.getObjectSource(part.sourceUrl);
    const filename = buildFilename(object.name, object.type, part.subtype, '.abap');
    const filePath = path.join(opts.dir, filename);

    if (await fileExists(filePath)) {
      const existing = await fs.readFile(filePath, 'utf-8');
      if (existing === content) {
        entries.push({ object: object.name, type: object.type, status: 'skipped', detail: 'already matches' });
        skipped.push(filePath);
        continue;
      }
      if (opts.skipExisting) {
        entries.push({ object: object.name, type: object.type, status: 'skipped', detail: 'local file differs; --skip-existing' });
        skipped.push(filePath);
        continue;
      }
      if (!opts.overwrite) {
        throw new CliError(
          'OVERWRITE_REQUIRED',
          `Local file ${filePath} differs from SAP; refusing to overwrite.`,
          {
            details: { file: filePath, object: object.name },
            nextSteps: [
              'Re-run with --overwrite to replace the local file.',
              'Or re-run with --skip-existing to keep the local file unchanged.',
            ],
            example: `abap pull ${object.name} --overwrite`,
          },
        );
      }
    }
    await writeAbapFile(filePath, content);
    entries.push({ object: object.name, type: object.type, status: 'written', files: [filePath] });
    written.push(filePath);
  }

  printResult(
    json,
    { object: object.name, type: object.type, entries, written, skipped, failed },
    humanSummary(object, written, skipped),
  );
}

function humanSummary(
  object: { name: string; type: string },
  written: string[],
  skipped: string[],
): string {
  const lines = [`Pulled ${object.name} (${object.type}):`];
  for (const f of written) lines.push(`  ${f}`);
  if (skipped.length > 0) {
    lines.push(`Skipped ${skipped.length} file(s):`);
    for (const f of skipped) lines.push(`  ${f}`);
  }
  return lines.join('\n');
}