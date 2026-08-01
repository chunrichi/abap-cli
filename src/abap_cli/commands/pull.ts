import { Command } from 'commander';
import * as path from 'path';
import { AdtClientWrapper } from '../clients/adt-client.js';
import { buildFilename } from '../formats/file-resolver.js';
import { fileExists, writeAbapFile } from '../formats/abap-source.js';
import { CliError, printError, printResult } from '../output/json.js';
import { resolveObject, getObjectParts } from '../sync/resolve.js';

export function registerPullCommand(program: Command): void {
  program
    .command('pull')
    .description('Download ABAP objects from SAP to local files')
    .argument('[object-name]', 'Object name to download (e.g., ZCL_MY_CLASS)')
    .option('--type <type>', 'Object type (CLAS, PROG, INTF, etc.)')
    .option('--package <package>', 'Download all objects in a package (not implemented in this phase)')
    .option('--dir <path>', 'Output directory', 'src/')
    .action(async (objectName: string, opts, cmd) => {
      const json = cmd.parent?.opts()?.json ?? false;
      try {
        await runPull(objectName, opts, json);
      } catch (error: unknown) {
        printError(json, error);
      }
    });
}

async function runPull(objectName: string, opts: { type?: string; package?: string; dir: string }, json: boolean): Promise<void> {
  if (opts.package) {
    throw new CliError('NOT_IMPLEMENTED', '--package batch pull is not implemented in this phase');
  }
  if (!objectName) {
    throw new CliError('USAGE', 'Specify an object name (e.g., ZCL_MY_CLASS)');
  }

  const client = await AdtClientWrapper.create();
  const object = await resolveObject(client, objectName, opts.type);
  const parts = await getObjectParts(client, object);

  const files: string[] = [];
  const overwritten: string[] = [];
  for (const part of parts) {
    const content = await client.getObjectSource(part.sourceUrl);
    const filename = buildFilename(object.name, object.type, part.subtype, '.abap');
    const filePath = path.join(opts.dir, filename);
    if (await fileExists(filePath)) overwritten.push(filePath);
    await writeAbapFile(filePath, content);
    files.push(filePath);
  }

  printResult(json, { object: object.name, type: object.type, files, overwritten }, humanSummary(object, files, overwritten));
}

function humanSummary(
  object: { name: string; type: string },
  files: string[],
  overwritten: string[],
): string {
  const lines = [`Pulled ${object.name} (${object.type}) to ${files.length} file(s):`];
  for (const f of files) lines.push(`  ${f}`);
  if (overwritten.length > 0) lines.push(`Overwrote ${overwritten.length} existing file(s)`);
  return lines.join('\n');
}
