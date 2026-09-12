import * as path from 'node:path';
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { CliError, printResult, printSchema, type OutputMode } from '../../output/json.js';
import { resolveObject, getObjectParts, type ResolvedObject } from '../../core/resolve.js';
import type { ObjectPart } from '../../formats/object-parts.js';
import { resolveTransport } from '../../core/transport.js';
import { pushObject } from './push-object.js';
import { requireWriteConfirmation } from '../../core/confirmation.js';
import { buildFilename, objectDirName } from '../../formats/file-resolver.js';
import { writeAbapFile } from '../../formats/abap-source.js';
import { defaultSkeleton, getTemplate } from '../../formats/templates.js';
import type { CreatableTypeIds } from 'abap-adt-api';
import {
  createObjtypeFor,
  isDdicSupportedType,
  isHttpSupportedType,
  isTranSupportedType,
  allSupportedTypes,
  createHandlerFor,
  requiresFileFor,
} from '../../types/registry.js';
import { runCreateFugrFunc } from './create-fugr-func.js';
import { createSchema } from './create-schema.js';
import { toOutputPath } from '../../core/path-output.js';
import { normalizeName, validateObjectName } from './object-name.js';
// Side-effect imports: each per-type module self-registers its create handler.
// Decision 2A — module-load side effect (no explicit wiring table).
import './create-ddic.js';
import './create-http.js';
import './create-tran.js';
import './create-ttyp.js';
import './create-msag.js';
import './create-ddls.js';
import './create-cds-extension.js';
import './create-srvd.js';

/** ADT objtype for source objects (e.g. 'CLAS/OC'); undefined for DDIC/HTTP/TRAN. */
export interface CreateTypeSpec {
  objtype: CreatableTypeIds;
}

export interface CreateOptions {
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
  schema?: boolean;
  yes?: boolean;
  /** 014: DDIC abap-file-format JSON input path. */
  file?: string;
  /** With type FUGR: create a function module (FUGR/FF) inside the existing function group <name>. */
  func?: string;
}

export interface CreateLocalOptions {
  template?: string;
  dir: string;
}

export async function runCreate(type: string | undefined, name: string | undefined, opts: CreateOptions, mode: OutputMode): Promise<void> {
  if (opts.schema) {
    printSchema(createSchema(type));
    return;
  }
  if (!type) {
    throw new CliError('USAGE', "Missing required argument 'type'", {
      example: 'abap create CLAS ZCL_MY_CLASS --package ZPKG --description "desc"',
    });
  }
  if (!name) {
    throw new CliError('USAGE', "Missing required argument 'name'", {
      example: 'abap create CLAS ZCL_MY_CLASS --package ZPKG --description "desc"',
    });
  }
  if (!opts.package) {
    throw new CliError('USAGE', "Missing required option '--package <package>'", {
      example: 'abap create CLAS ZCL_MY_CLASS --package ZPKG --description "desc"',
    });
  }
  // When --file is provided the description is supplied via the JSON file
  // (works for any DDIC type, including deferred ones like TTYP).
  if (!opts.description && !opts.file) {
    throw new CliError('USAGE', "Missing required option '--description <desc>'", {
      example: 'abap create CLAS ZCL_MY_CLASS --package ZPKG --description "desc"',
    });
  }
  const typeUpper = type.toUpperCase();
  const objectName = normalizeName(name);
  // Data-driven fail-fast (registry `requiresFile`): DDIC / HTTP / TRAN /
  // TTYP / MSAG / DDLS have no skeleton path, so refuse BEFORE the write
  // confirmation prompt rather than asking for a confirmation that can only
  // end in a USAGE error.
  if (requiresFileFor(typeUpper) && !opts.file) {
    throw new CliError('USAGE', `Type ${typeUpper} requires --file <path> with an abap-file-format JSON`, {
      example: `abap create ${typeUpper} ${objectName} --file src/${objectName.toLowerCase()}/${objectName.toLowerCase()}.${typeUpper.toLowerCase()}.json --package $TMP --yes`,
    });
  }
  requireWriteConfirmation(
    'abap create',
    { ...opts, supportsDryRun: true },
    `abap create ${type ?? '<type>'} ${name ?? '<name>'} --package ${opts.package} --yes`,
  );
  const skipActivate = opts.activate === false;
  // Local fail-fast (zero SAP round-trip) before routing: an oversized or
  // illegal name must not reach SAP as a misleading OBJECT_NOT_FOUND.
  validateObjectName(objectName);

  // Phase 3: type-specific create handlers (DDIC / HTTP / TRAN / TTYP / MSAG / DDLS)
  // are looked up in the registry populated by per-type modules at load time.
  const handler = createHandlerFor(typeUpper);
  if (handler) {
    await handler({ type: typeUpper, name: objectName, opts, mode });
    return;
  }

  // Function module (FUGR/FF) inside an existing function group: type FUGR,
  // <name> is the group, --func names the new module. Stays in the dispatcher
  // because it's a flag-driven sub-command, not a type-driven route.
  if (opts.func !== undefined) {
    if (typeUpper !== 'FUGR') {
      throw new CliError('INVALID_ARGUMENT', '--func <name> is only valid with type FUGR', {
        type: typeUpper,
        nextSteps: ['Use `abap create FUGR <group> --func <module>` to create a function module in an existing function group.'],
        example: `abap create FUGR ZFG_MY_GROUP --func ZFG_MY_GROUP_FF01 --package '$TMP' --description "..." --yes`,
      });
    }
    await runCreateFugrFunc(objectName, opts.func, opts, mode);
    return;
  }

  const spec = resolveType(type);
  const client = await AdtClientWrapper.create();

  // --check-only: validate the proposed object without creating it.
  if (opts.checkOnly) {
    const result = await client.validateNewObject({
      objtype: spec.objtype,
      objname: objectName,
      packagename: opts.package,
      description: opts.description,
    } as Parameters<AdtClientWrapper['validateNewObject']>[0]);
    printResult(mode,
      { object: objectName, type: type.toUpperCase(), checkOnly: true, valid: result.success, issues: result.success ? [] : [result.SHORT_TEXT] },
      `Validation ${result.success ? 'passed' : 'failed'} for ${objectName} (no object created).`,
    );
    return;
  }

  const transport = await resolveTransport(
    client,
    opts.tr,
    client.getConfig().transport,
    // $TMP is case-insensitive: shell expansion to "" + user-typed variants should all skip transport.
    { transportOptional: (opts.package ?? '$TMP').trim().toUpperCase() === '$TMP' },
  );

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

  // --audit: capture the before-checksum (off by default).
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

  // Create-then-pull default: write the local file so the agent has it.
  // 032: FUGR must go through pullObject so the standard abap-file-format
  // layout is written (sapl/l<group>top/.func.* + .fugr.json), not a stale
  // single `<group>.fugr.abap` file the spec never defined.
  let localFile: string | undefined;
  if (opts.pull !== false) {
    if (type.toUpperCase() === 'FUGR') {
      const { pullObject } = await import('./pull-source.js');
      const pulled = await pullObject(
        client,
        { name: object.name, type: object.type, objectUrl: object.objectUrl },
        { dir: 'src', overwrite: true, skipExisting: false },
      );
      const written = pulled.written[0];
      if (written) localFile = toOutputPath(written);
    } else {
      const content = await client.getObjectSource(mainPart.sourceUrl);
      const filename = buildFilename(object.name, object.type, mainPart.subtype, '.abap');
      const relPath = path.join('src', objectDirName(object.name), filename);
      await writeAbapFile(path.resolve(process.cwd(), relPath), content);
      // Normalize to POSIX for the JSON output boundary (P0 — Windows path contract).
      localFile = toOutputPath(relPath);
    }
  }

  printResult(mode,
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

/**
 * Resolve the ADT objtype for a `create local` draft.
 *
 * Only consulted by `runCreateLocal` (the real `create` dispatcher routes
 * DDIC / HTTP / TRAN / TTYP / MSAG / DDLS to registry handlers before this is
 * reached). `create local` therefore supports exactly the four source-object
 * types that have skeleton templates: CLAS / INTF / PROG / FUGR.
 *
 * Note: `details.supported` intentionally lists `allSupportedTypes()` (the full
 * registry) rather than the `create local` subset — it is the catalogue agents
 * use to discover which types exist at all.
 */
export function resolveType(type: string): CreateTypeSpec {
  const t = type.toUpperCase();
  const supported = allSupportedTypes();
  // HTTP service / Transaction code / TTYP / MSAG / DDLS are all creatable via
  // `create <type> <name> --file <path>`; none of them has a local skeleton.
  if (isHttpSupportedType(t)) {
    throw new CliError(
      'TYPE_NOT_SUPPORTED',
      `Object type ${t} is an HTTP service; only \`abap create ${t} <name> --file <path>\` is supported (ICF route, not \`create local\`).`,
      { type: t, supported },
    );
  }
  if (isTranSupportedType(t)) {
    throw new CliError(
      'TYPE_NOT_SUPPORTED',
      `Object type ${t} is a transaction code; only \`abap create ${t} <name> --file <path>\` is supported (ICF route, not \`create local\`).`,
      { type: t, supported },
    );
  }
  const objtype = createObjtypeFor(t);
  if (!objtype) {
    throw new CliError(
      'TYPE_NOT_SUPPORTED',
      `Object type ${t} has no local skeleton. \`create local\` supports CLAS / INTF / PROG / FUGR only; create ${t} in SAP with \`abap create ${t} <name> --file <path>\`, or pull an existing object and edit it.`,
      { type: t, supported },
    );
  }
  return { objtype: objtype as CreatableTypeIds };
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
