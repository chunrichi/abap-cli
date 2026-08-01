import { Command } from 'commander';
import type { CreatableTypeIds } from 'abap-adt-api';
import { AdtClientWrapper } from '../clients/adt-client.js';
import { CliError, printError, printResult } from '../output/json.js';
import { resolveObject, getObjectParts, type ResolvedObject, type ObjectPart } from '../sync/resolve.js';
import { resolveTransport } from '../sync/transport.js';
import { pushObject } from '../sync/push-flow.js';

interface CreateTypeSpec {
  objtype: CreatableTypeIds;
  skeleton: (name: string) => string;
}

// User-facing type → ADT objtype + default skeleton (abap-file-format compliant).
const TYPE_MAP: Record<string, CreateTypeSpec> = {
  CLAS: {
    objtype: 'CLAS/OC',
    skeleton: (n) =>
      `CLASS ${n} DEFINITION PUBLIC.\n  PUBLIC SECTION.\nENDCLASS.\nCLASS ${n} IMPLEMENTATION.\nENDCLASS.\n`,
  },
  INTF: {
    objtype: 'INTF/OI',
    skeleton: (n) => `INTERFACE ${n} PUBLIC.\nENDINTERFACE.\n`,
  },
  PROG: {
    objtype: 'PROG/P',
    skeleton: (n) => `REPORT ${n}.\n`,
  },
  FUGR: {
    // FUGR/F creates a new function group; FUGR/FF is a function module within a group.
    objtype: 'FUGR/F',
    skeleton: (n) => `FUNCTION-POOL ${n}.\n`,
  },
};

// DDIC objects are created via the ICF service (later phase, not implemented yet).
const DDIC_TYPES = new Set(['DOMA', 'DTEL', 'TABL', 'STRU', 'TTYP']);

export function registerCreateCommand(program: Command): void {
  program
    .command('create')
    .description('Create a new ABAP source object (CLAS, INTF, PROG, FUGR) and activate it')
    .argument('<type>', 'Object type (CLAS, INTF, PROG, FUGR)')
    .argument('<name>', 'Object name')
    .requiredOption('--package <package>', 'Target SAP package')
    .requiredOption('--description <desc>', 'Object description')
    .option('--tr <transport>', 'Transport number')
    .option('--no-activate', 'Create the object but do not activate it')
    .action(async (type, name, opts, cmd) => {
      const json = cmd.parent?.opts()?.json ?? false;
      try {
        await runCreate(type, name, opts, json);
      } catch (error: unknown) {
        printError(json, error);
      }
    });
}

interface CreateOptions {
  package: string;
  description: string;
  tr?: string;
  /** false when --no-activate is passed (commander negated boolean) */
  activate?: boolean;
}

async function runCreate(type: string, name: string, opts: CreateOptions, json: boolean): Promise<void> {
  // --no-activate sets opts.activate to false; it is true by default.
  const skipActivate = opts.activate === false;
  const spec = resolveType(type);
  const objectName = normalizeName(name);

  const client = await AdtClientWrapper.create();
  const transport = await resolveTransport(client, opts.tr, client.getConfig().transport);

  // Refuse to overwrite: create is a "new object" operation.
  await assertNotExists(client, objectName);

  await client.createObject({
    objtype: spec.objtype,
    name: objectName,
    parentName: opts.package,
    description: opts.description,
    parentPath: `/sap/bc/adt/packages/${encodeURIComponent(opts.package)}`,
    transport,
  });

  // Locate the freshly created object and its main source part for skeleton write.
  const object = await resolveObject(client, objectName, type);
  const parts = await getObjectPartsForCreate(client, object, type.toUpperCase());
  const mainPart = parts.find((p) => p.subtype === 'main') ?? parts[0];
  if (!mainPart) {
    throw new CliError('SAP_ERROR', `No source part found for created object ${objectName}`, { object: objectName });
  }

  // Write the skeleton then activate (or skip activation with --no-activate).
  await pushObject(
    client,
    { name: object.name, type: object.type, objectUrl: object.objectUrl },
    [{ subtype: mainPart.subtype, sourceUrl: mainPart.sourceUrl, content: spec.skeleton(objectName) }],
    { transport, checkOnly: false, activate: skipActivate ? false : true },
  );

  printResult(
    json,
    {
      object: objectName,
      type: type.toUpperCase(),
      package: opts.package,
      description: opts.description,
      transport,
      activated: skipActivate ? false : true,
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
    // Fall through — an exact match means the object already exists.
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
  attempts = 3,
  delayMs = 400,
): Promise<ObjectPart[]> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await getObjectParts(client, object);
    } catch (error: unknown) {
      lastError = error;
      if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  if (type === 'FUGR') throw lastError;
  return [{ subtype: 'main', sourceUrl: `${object.objectUrl.replace(/\/$/, '')}/source/main` }];
}
