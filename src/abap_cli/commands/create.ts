import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs/promises';
import type { CreatableTypeIds } from 'abap-adt-api';
import { AdtClientWrapper } from '../clients/adt-client.js';
import { CliError, printError, printResult, jsonFromCommand } from '../output/json.js';
import { commonErrorsAfter } from '../output/help-text.js';
import { resolveObject, getObjectParts, type ResolvedObject, type ObjectPart } from '../sync/resolve.js';
import { resolveTransport } from '../sync/transport.js';
import { pushObject } from '../sync/push-flow.js';
import { buildFilename, objectDirName } from '../formats/file-resolver.js';
import { writeAbapFile, fileExists } from '../formats/abap-source.js';
import { defaultSkeleton, getTemplate } from '../formats/templates.js';

interface CreateTypeSpec {
  objtype: CreatableTypeIds;
}

// User-facing type → ADT objtype (abap-file-format compliant).
const TYPE_MAP: Record<string, CreateTypeSpec> = {
  CLAS: { objtype: 'CLAS/OC' },
  INTF: { objtype: 'INTF/OI' },
  PROG: { objtype: 'PROG/P' },
  FUGR: { objtype: 'FUGR/F' },
};

// DDIC objects are created via the ICF service (later phase, not implemented yet).
const DDIC_TYPES = new Set(['DOMA', 'DTEL', 'TABL', 'STRU', 'TTYP']);

interface CreateOptions {
  package: string;
  description: string;
  tr?: string;
  /** false when --no-activate is passed (commander negated boolean) */
  activate?: boolean;
  template?: string;
  /** false when --no-pull is passed (commander negated boolean) */
  pull?: boolean;
  checkOnly?: boolean;
  audit?: boolean;
}

export function registerCreateCommand(program: Command): void {
  program
    .command('create')
    .description('Create a new ABAP source object (CLAS, INTF, PROG, FUGR) and activate it')
    .addHelpText('after', commonErrorsAfter())
    .argument('<type>', 'Object type (CLAS, INTF, PROG, FUGR)')
    .argument('<name>', 'Object name')
    .requiredOption('--package <package>', 'Target SAP package')
    .requiredOption('--description <desc>', 'Object description')
    .option('--tr <transport>', 'Transport number')
    .option('--no-activate', 'Create the object but do not activate it')
    .option('--template <template>', 'Skeleton template (minimal, public-method, report, selection-screen, ...)')
    .option('--no-pull', 'Skip the create-then-pull local copy (default: pull after create)')
    .option('--check-only', 'Validate the proposed object without creating it')
    .option('--audit', 'Include the before-checksum (extra SAP round-trip, off by default)')
    .action(async (type, name, opts, cmd) => {
      const json = jsonFromCommand(cmd);
      try {
        await runCreate(type, name, opts, json);
      } catch (error: unknown) {
        printError(json, error);
      }
    });
}

async function runCreate(type: string, name: string, opts: CreateOptions, json: boolean): Promise<void> {
  const skipActivate = opts.activate === false;
  const spec = resolveType(type);
  const objectName = normalizeName(name);
  const client = await AdtClientWrapper.create();

  // --check-only: validate the proposed object without creating it (FR-021).
  if (opts.checkOnly) {
    const result = await client.validateNewObject({
      objtype: spec.objtype,
      objname: objectName,
      packagename: opts.package,
      description: opts.description,
    } as Parameters<AdtClientWrapper['validateNewObject']>[0]);
    printResult(
      json,
      { object: objectName, type: type.toUpperCase(), checkOnly: true, valid: result.success, issues: result.success ? [] : [result.SHORT_TEXT] },
      `Validation ${result.success ? 'passed' : 'failed'} for ${objectName} (no object created).`,
    );
    return;
  }

  const transport = await resolveTransport(client, opts.tr, client.getConfig().transport);

  // Refuse to overwrite: create is a "new object" operation.
  await assertNotExists(client, objectName);

  try {
    await client.createObject({
      objtype: spec.objtype,
      name: objectName,
      parentName: opts.package,
      description: opts.description,
      parentPath: `/sap/bc/adt/packages/${encodeURIComponent(opts.package)}`,
      transport,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError('CREATE_FAILED', `Failed to create ${type.toUpperCase()} ${objectName}: ${message}`, {
      object: objectName,
      type: type.toUpperCase(),
    });
  }

  // Locate the freshly created object and its main source part for skeleton write.
  const object = await resolveObject(client, objectName, type);
  const parts = await getObjectPartsForCreate(client, object, type.toUpperCase());
  const mainPart = parts.find((p) => p.subtype === 'main') ?? parts[0];
  if (!mainPart) {
    throw new CliError('SAP_ERROR', `No source part found for created object ${objectName}`, { object: objectName });
  }

  const templateName = opts.template;
  const template = templateName ? getTemplate(type, templateName) : undefined;
  if (templateName && !template) {
    throw new CliError('INVALID_ARGUMENT', `Unknown template '${templateName}' for type ${type.toUpperCase()}`, {
      nextSteps: [`List available templates: abap create ${type.toUpperCase()} <name> --help`],
    });
  }
  const skeleton = template ? template.skeleton(objectName) : defaultSkeleton(type, objectName);

  // --audit: capture the before-checksum (roadmap §1.2, off by default).
  let checksum: string | undefined;
  if (opts.audit) {
    const before = await client.getObjectSource(mainPart.sourceUrl);
    checksum = String(before.length);
  }

  await pushObject(
    client,
    { name: object.name, type: object.type, objectUrl: object.objectUrl },
    [{ subtype: mainPart.subtype, sourceUrl: mainPart.sourceUrl, content: skeleton }],
    { transport, checkOnly: false, activate: skipActivate ? false : true },
  );

  // Create-then-pull default: write the local file so the agent has it (FR-021).
  let localFile: string | undefined;
  if (opts.pull !== false) {
    const content = await client.getObjectSource(mainPart.sourceUrl);
    const filename = buildFilename(object.name, object.type, mainPart.subtype, '.abap');
    const relPath = path.join('src', objectDirName(object.name), filename);
    await writeAbapFile(path.resolve(process.cwd(), relPath), content);
    localFile = relPath;
  }

  printResult(
    json,
    {
      object: objectName,
      type: type.toUpperCase(),
      package: opts.package,
      description: opts.description,
      transport,
      activated: skipActivate ? false : true,
      template: templateName,
      localFile,
      checksum,
    },
    `Created ${type.toUpperCase()} ${objectName} in ${opts.package}${skipActivate ? ' (not activated)' : ''} (${transport})`,
  );
}

function resolveType(type: string): CreateTypeSpec {
  const t = type.toUpperCase();
  if (DDIC_TYPES.has(t)) {
    throw new CliError(
      'DDIC_NOT_SUPPORTED',
      `Object type ${t} is a DDIC object; not supported in this phase (ICF service not implemented yet)`,
      { type: t },
    );
  }
  const spec = TYPE_MAP[t];
  if (!spec) {
    throw new CliError(
      'TYPE_NOT_SUPPORTED',
      `Object type ${t} is not supported. Supported types: ${Object.keys(TYPE_MAP).join(', ')}`,
      { type: t, supported: Object.keys(TYPE_MAP) },
    );
  }
  return spec;
}

function normalizeName(name: string): string {
  return name.trim().toUpperCase();
}

async function assertNotExists(client: AdtClientWrapper, objectName: string): Promise<void> {
  try {
    await resolveObject(client, objectName);
  } catch (error: unknown) {
    if (error instanceof CliError && error.code === 'OBJECT_NOT_FOUND') return;
    if (error instanceof CliError && error.code === 'AMBIGUOUS_OBJECT') {
      throw new CliError('OBJECT_EXISTS', `Object ${objectName} already exists`, { object: objectName });
    }
    throw error;
  }
  throw new CliError('OBJECT_EXISTS', `Object ${objectName} already exists`, { object: objectName });
}

/**
 * Get the source parts of a freshly created object. A new class may not be
 * readable via objectStructure yet on real SAP ("wrong input data"); for the
 * simple source objects (CLAS/INTF/PROG) the main source URL is a stable
 * `<objectUrl>/source/main` pattern, so fall back to it after a short retry.
 * FUGR needs objectStructure (different include layout) and is ready immediately.
 */
async function getObjectPartsForCreate(
  client: AdtClientWrapper,
  object: ResolvedObject,
  type: string,
): Promise<ObjectPart[]> {
  try {
    return await getObjectParts(client, object, 3, 400);
  } catch (error: unknown) {
    if (type === 'FUGR') throw error;
    return [{ subtype: 'main', sourceUrl: `${object.objectUrl.replace(/\/$/, '')}/source/main` }];
  }
}
