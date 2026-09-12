/**
 * `abap create local <type> <name>` — write a skeleton draft to disk without
 * contacting SAP. Stays purely local; the user can `abap push` it later.
 */
import * as path from 'node:path';
import { CliError, printResult, type OutputMode } from '../../output/json.js';
import { buildFilename, objectDirName } from '../../formats/file-resolver.js';
import { folderFor } from '../../formats/type-folder.js';
import { writeAbapFile, fileExists } from '../../formats/abap-source.js';
import { defaultSkeleton, getTemplate, listTemplates } from '../../formats/templates.js';
import { toOutputPath } from '../../core/path-output.js';
import { resolveType } from './create.js';
import type { CreateLocalOptions } from './create.js';
import { normalizeName, validateObjectName } from './object-name.js';

export async function runCreateLocal(type: string, name: string, opts: CreateLocalOptions, mode: OutputMode): Promise<void> {
  const objectName = normalizeName(name);
  validateObjectName(objectName); // fail fast before writing any draft
  resolveType(type); // throws TYPE_NOT_SUPPORTED / DDIC_NOT_SUPPORTED before any write
  const typeUpper = type.toUpperCase();

  const templateName = opts.template;
  const template = templateName ? getTemplate(typeUpper, templateName) : undefined;
  if (templateName && !template) {
    throw new CliError('INVALID_ARGUMENT', `Unknown template '${templateName}' for type ${typeUpper}`, {
      nextSteps: [`Available templates: ${listTemplates(typeUpper).map((t) => t.name).join(', ')}`],
    });
  }
  const content = template ? template.skeleton(objectName) : defaultSkeleton(typeUpper, objectName);

  const filename = buildFilename(objectName, typeUpper, 'main', '.abap');
  const relPath = path.join(opts.dir, folderFor(typeUpper), objectDirName(objectName), filename);
  const targetPath = path.resolve(process.cwd(), relPath);

  if (await fileExists(targetPath)) {
    const outPath = toOutputPath(relPath);
    throw new CliError('FILE_EXISTS', `${outPath} already exists. Delete it first or use another name`, { file: outPath });
  }

  await writeAbapFile(targetPath, content);

  const outPath = toOutputPath(relPath);
  printResult(mode,
    { object: objectName, type: typeUpper, template: templateName ?? null, file: outPath, experimental: true },
    `Created local draft ${typeUpper} ${objectName} at ${outPath} (experimental, not in SAP)`,
  );
}
