/**
 * `abap create local <type> <name>` — write a skeleton draft to disk without
 * contacting SAP. Stays purely local; the user can `abap push` it later.
 */
import * as path from 'node:path';
import { CliError, printResult, type OutputMode } from '../../output/json.js';
import { buildFilename } from '../../formats/file-resolver.js';
import { writeAbapFile, fileExists } from '../../formats/abap-source.js';
import { defaultSkeleton, getTemplate, listTemplates } from '../../formats/templates.js';
import { toOutputPath } from '../../core/path-output.js';
import { resolveType } from './create.js';
import type { CreateLocalOptions } from './create.js';
import { normalizeName, validateObjectName } from './object-name.js';

/**
 * Types that have a real local skeleton template. `create local` used to fall
 * through to a generic REPORT skeleton for any type with a `createObjtype`,
 * so SRVD / DCLS / DDLX / DDLA silently produced `<name>.<type>.abap` files
 * that were neither valid AFF drafts nor pushable. Those four are creatable
 * in SAP (from an AFF JSON) but have no offline skeleton.
 */
const LOCAL_SKELETON_TYPES = new Set(['CLAS', 'INTF', 'PROG', 'FUGR']);

export async function runCreateLocal(type: string, name: string, opts: CreateLocalOptions, mode: OutputMode): Promise<void> {
  const objectName = normalizeName(name);
  validateObjectName(objectName); // fail fast before writing any draft
  const typeUpper = type.toUpperCase();
  if (!LOCAL_SKELETON_TYPES.has(typeUpper)) {
    // resolveType has the tailored TYPE_NOT_SUPPORTED message for types with
    // no create route at all (DDIC / HTTP / TRAN / …); for the CDS/RAP
    // companions it returns normally, so reject them explicitly here.
    resolveType(type);
    throw new CliError(
      'TYPE_NOT_SUPPORTED',
      `Object type ${typeUpper} has no local skeleton. \`create local\` supports CLAS / INTF / PROG / FUGR only; create ${typeUpper} in SAP with \`abap create ${typeUpper} <name> --file <path>\`, or pull an existing object and edit it.`,
      { type: typeUpper, supported: [...LOCAL_SKELETON_TYPES] },
    );
  }
  resolveType(type); // validates the four skeleton types before any write

  const templateName = opts.template;
  const template = templateName ? getTemplate(typeUpper, templateName) : undefined;
  if (templateName && !template) {
    throw new CliError('INVALID_ARGUMENT', `Unknown template '${templateName}' for type ${typeUpper}`, {
      nextSteps: [`Available templates: ${listTemplates(typeUpper).map((t) => t.name).join(', ')}`],
    });
  }
  const content = template ? template.skeleton(objectName) : defaultSkeleton(typeUpper, objectName);

  const filename = buildFilename(objectName, typeUpper, 'main', '.abap');
  const relPath = path.join(opts.dir, filename);
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
