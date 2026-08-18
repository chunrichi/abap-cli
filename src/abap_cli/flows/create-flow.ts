import * as path from 'path';
import * as fs from 'fs/promises';
import { AdtClientWrapper } from '../clients/adt-client.js';
import { IcfClient } from '../clients/icf-client.js';
import { CliError, printResult, printSchema } from '../output/json.js';
import type { ErrorCode } from '../output/error-codes.js';
import { resolveObject, getObjectParts, type ResolvedObject } from '../core/resolve.js';
import type { ObjectPart } from '../formats/object-parts.js';
import { resolveTransport } from '../core/transport.js';
import { pushObject } from './push-object.js';
import { buildFilename, objectDirName } from '../formats/file-resolver.js';
import { folderFor } from '../formats/type-folder.js';
import { writeAbapFile, fileExists } from '../formats/abap-source.js';
import { defaultSkeleton, getTemplate, listTemplates } from '../formats/templates.js';
import { readDdicJson, localToWire, validateDdicObject, type DdicSupportedType } from '../dictionary/ddic-json.js';
import { readHttpJson, localToWire as httpLocalToWire, validateHttpObject } from '../dictionary/http-json.js';
import { TYPE_MAP, DDIC_TYPES, HTTP_TYPES, isDdicSupportedType, isHttpSupportedType, type CreateTypeSpec } from './create-types.js';
import { createSchema } from './create-schema.js';

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
  /** 014: DDIC abap-file-format JSON input path. */
  file?: string;
}

export interface CreateLocalOptions {
  template?: string;
  dir: string;
}

export async function runCreateLocal(type: string, name: string, opts: CreateLocalOptions, json: boolean): Promise<void> {
  const objectName = normalizeName(name);
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
    throw new CliError('FILE_EXISTS', `${relPath} already exists. Delete it first or use another name`, { file: relPath });
  }

  await writeAbapFile(targetPath, content);

  printResult(
    json,
    { object: objectName, type: typeUpper, template: templateName ?? null, file: relPath, experimental: true },
    `Created local draft ${typeUpper} ${objectName} at ${relPath} (experimental, not in SAP)`,
  );
}

/**
 * 014: create a DDIC object via the self-built ICF service.
 * Reads the abap-file-format JSON from `--file`, validates it, converts to wire
 * schema, and POSTs /ddic/<type>. Command-line --description overrides the file's
 * description. Other required fields (package, transport for non-$TMP) are validated
 * client-side before the round-trip.
 */
async function runCreateDdic(type: DdicSupportedType, objectName: string, opts: CreateOptions, json: boolean): Promise<void> {
  const filePath = path.resolve(process.cwd(), opts.file ?? '');
  let local: Awaited<ReturnType<typeof readDdicJson>>;
  try {
    local = await readDdicJson(filePath);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError('INVALID_ARGUMENT', `Cannot read DDIC file ${opts.file}: ${message}`, {
      file: opts.file,
      nextSteps: [
        'Verify the file exists and is valid JSON.',
        'See quickstart.md scenario 1 for the expected layout.',
      ],
    });
  }

  // FR-004: client-side validation (fast-fail, no SAP round-trip for invalid input).
  const errors = validateDdicObject(local, type);
  if (errors.length > 0) {
    throw new CliError('VALIDATION_ERROR', `Invalid ${type} definition in ${opts.file}: ${errors.join('; ')}`, {
      file: opts.file,
      type,
      object: objectName,
      details: errors,
      nextSteps: [
        'Fix the errors above and re-run.',
        'See data-model.md §1-4 for the per-type required fields.',
      ],
    });
  }

  // FR-004: non-$TMP package requires a transport request.
  if (opts.package !== '$TMP' && !opts.tr) {
    throw new CliError('VALIDATION_ERROR', 'transportRequest is required when package is not $TMP', {
      nextSteps: ['Re-run with --tr <REQUEST>', 'Or use --package $TMP for local objects.'],
      example: `abap create ${type} ${objectName} --file ${opts.file} --package ${opts.package} --tr <REQUEST> --description "..."`,
    });
  }

  // Convert to wire schema. CLI flags override file values when both are present.
  const wire = localToWire(type, local);
  if (opts.description) wire.description = opts.description;
  if (opts.package) wire.package = opts.package;
  if (opts.tr) wire.transportRequest = opts.tr;

  const icf = await IcfClient.create();
  const resp = await icf.postDdic<{ name: string; type: string; action: 'created' | 'updated' }>(type.toLowerCase(), wire);
  if (resp.status !== 'success' || !resp.data) {
    const code = (resp.error?.code ?? 'DDIC_CREATE_FAILED') as ErrorCode;
    throw new CliError(code, resp.error?.message ?? `Failed to create ${type} ${objectName}`, {
      object: objectName,
      type,
      details: resp.error?.details,
      nextSteps: [
        'Verify the file conforms to the abap-file-format JSON schema.',
        'Re-run after fixing the cause above.',
      ],
    });
  }

  printResult(
    json,
    {
      object: resp.data.name,
      type,
      action: resp.data.action,
      file: opts.file,
    },
    `Created ${type} ${resp.data.name} via ICF ${resp.data.action === 'created' ? '(new)' : '(overwritten)'}`,
  );
}

/**
 * 022: create an HTTP service via the self-built ICF service.
 * Reads the abap-file-format JSON from `--file`, validates it, converts to wire
 * schema, and POSTs /http/<name>. Command-line --description overrides the file's
 * description. Other required fields (package, transport for non-$TMP) are validated
 * client-side before the round-trip.
 */
async function runCreateHttp(type: 'HTTP', objectName: string, opts: CreateOptions, json: boolean): Promise<void> {
  const filePath = path.resolve(process.cwd(), opts.file ?? '');
  let local: Awaited<ReturnType<typeof readHttpJson>>;
  try {
    local = await readHttpJson(filePath);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError('INVALID_ARGUMENT', `Cannot read HTTP service file ${opts.file}: ${message}`, {
      file: opts.file,
      nextSteps: [
        'Verify the file exists and is valid JSON.',
        'See the abap-file-format HTTP schema (http-v1.json) for the expected layout.',
      ],
    });
  }

  // FR-004: client-side validation (fast-fail, no SAP round-trip for invalid input).
  const errors = validateHttpObject(local);
  if (errors.length > 0) {
    throw new CliError('VALIDATION_ERROR', `Invalid ${type} definition in ${opts.file}: ${errors.join('; ')}`, {
      file: opts.file,
      type,
      object: objectName,
      details: errors,
      nextSteps: [
        'Fix the errors above and re-run.',
        'See the abap-file-format HTTP schema (http-v1.json) for the per-field contract.',
      ],
    });
  }

  // FR-004: non-$TMP package requires a transport request.
  if (opts.package !== '$TMP' && !opts.tr) {
    throw new CliError('VALIDATION_ERROR', 'transportRequest is required when package is not $TMP', {
      nextSteps: ['Re-run with --tr <REQUEST>', 'Or use --package $TMP for local objects.'],
      example: `abap create ${type} ${objectName} --file ${opts.file} --package ${opts.package} --tr <REQUEST> --description "..."`,
    });
  }

  // Convert to wire schema. CLI flags override file values when both are present.
  const wire = httpLocalToWire(local);
  if (opts.description) wire.description = opts.description;
  if (opts.package) wire.package = opts.package;
  if (opts.tr) wire.transportRequest = opts.tr;

  const icf = await IcfClient.create();
  const resp = await icf.postHttp<{ name: string; type: string; action: 'created' | 'updated' }>(objectName, wire);
  if (resp.status !== 'success' || !resp.data) {
    const code = (resp.error?.code ?? 'HTTP_CREATE_FAILED') as ErrorCode;
    throw new CliError(code, resp.error?.message ?? `Failed to create ${type} ${objectName}`, {
      object: objectName,
      type,
      details: resp.error?.details,
      nextSteps: [
        'Verify the file conforms to the abap-file-format HTTP service JSON schema.',
        'Re-run after fixing the cause above.',
      ],
    });
  }

  printResult(
    json,
    {
      object: resp.data.name,
      type,
      action: resp.data.action,
      file: opts.file,
    },
    `Created ${type} ${resp.data.name} via ICF ${resp.data.action === 'created' ? '(new)' : '(overwritten)'}`,
  );
}

export async function runCreate(type: string | undefined, name: string | undefined, opts: CreateOptions, json: boolean): Promise<void> {
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
  // 014: when --file is provided the description is supplied via the JSON file
  // (works for any DDIC type, including deferred ones like TTYP).
  if (!opts.description && !opts.file) {
    throw new CliError('USAGE', "Missing required option '--description <desc>'", {
      example: 'abap create CLAS ZCL_MY_CLASS --package ZPKG --description "desc"',
    });
  }
  const skipActivate = opts.activate === false;
  const typeUpper = type.toUpperCase();
  const objectName = normalizeName(name);

  // 014: DDIC types route to the self-built ICF service (US1/2).
  if (isDdicSupportedType(typeUpper)) {
    if (!opts.file) {
      throw new CliError('USAGE', `DDIC type ${typeUpper} requires --file <path> with an abap-file-format JSON`, {
        example: `abap create ${typeUpper} ${objectName} --file src/${objectName.toLowerCase()}.${typeUpper.toLowerCase()}.json --package $TMP --description "..."`,
      });
    }
    await runCreateDdic(typeUpper, objectName, opts, json);
    return;
  }

  // 022: HTTP service routes to the self-built ICF service.
  if (isHttpSupportedType(typeUpper)) {
    if (!opts.file) {
      throw new CliError('USAGE', `HTTP service requires --file <path> with an abap-file-format JSON`, {
        example: `abap create HTTP ${objectName} --file src/${objectName.toLowerCase()}.http.json --package $TMP --description "..."`,
      });
    }
    await runCreateHttp(typeUpper, objectName, opts, json);
    return;
  }

  const spec = resolveType(type);
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

export function resolveType(type: string): CreateTypeSpec {
  const t = type.toUpperCase();
  if (DDIC_TYPES.has(t)) {
    throw new CliError(
      'DDIC_NOT_SUPPORTED',
      `Object type ${t} is a DDIC object; not supported in this phase (ICF service not implemented yet)`,
      { type: t },
    );
  }
  // 022: HTTP service is supported via ICF (handled upstream by runCreate → runCreateHttp).
  // resolveType is only consulted by runCreateLocal; HTTP local draft skeletons are not
  // generated here — keep the rejection semantics aligned with DDIC for `create local`.
  if (HTTP_TYPES.has(t)) {
    throw new CliError(
      'TYPE_NOT_SUPPORTED',
      `Object type ${t} is an HTTP service; only \`abap create ${t} <name> --file <path>\` is supported (ICF route, not \`create local\`).`,
      { type: t, supported: [...Object.keys(TYPE_MAP), ...DDIC_TYPES, ...HTTP_TYPES] },
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
