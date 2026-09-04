import * as path from 'path';
import * as fs from 'fs/promises';
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { IcfClient } from '../../clients/icf-client.js';
import { CliError, printResult, printSchema, type OutputMode } from '../../output/json.js';
import type { ErrorCode } from '../../output/error-codes.js';
import { resolveObject, getObjectParts, type ResolvedObject } from '../../core/resolve.js';
import type { ObjectPart } from '../../formats/object-parts.js';
import { resolveTransport } from '../../core/transport.js';
import { pushObject } from './push-object.js';
import { requireWriteConfirmation } from '../../core/confirmation.js';
import { buildFilename, objectDirName } from '../../formats/file-resolver.js';
import { folderFor } from '../../formats/type-folder.js';
import { writeAbapFile, fileExists } from '../../formats/abap-source.js';
import { defaultSkeleton, getTemplate, listTemplates } from '../../formats/templates.js';
import { readDdicJson, readDdicObjectForCreate, localToWire, validateDdicObject, getDdicFlatJsonExample, type DdicSupportedType, type DdicObject } from '../../formats/ddic/json.js';
import { readHttpJson, localToWire as httpLocalToWire, validateHttpObject } from '../../formats/http/json.js';
import { readTranJson, localToWire as tranLocalToWire, validateTranObject } from '../../formats/transport/json.js';
import type { CreatableTypeIds } from 'abap-adt-api';
import { createObjtypeFor, DDIC_TYPES, HTTP_TYPES, TRAN_TYPES, isDdicSupportedType, isHttpSupportedType, isTranSupportedType } from './create-types.js';
import { allSupportedTypes } from '../../types/registry.js';
import { runPullTtyp } from './pull-ttyp.js';
import { runPullMsag } from './pull-msag.js';
import { runPullDdls } from './pull-ddls.js';
import { detectChannel } from './channel-detect.js';
import { loadConfig } from '../../config/project-config.js';
import { readTtypJson, validateTtypObject, localToWire as ttypLocalToWire } from '../../formats/ttyp/json.js';
import { readMsagJson, validateMsagObject, localToWire as msagLocalToWire } from '../../formats/msag/json.js';
import { readDdlsJson, validateDdlsObject, localToWire as ddlsLocalToWire } from '../../formats/ddls/json.js';

/** ADT objtype for source objects (e.g. 'CLAS/OC'); undefined for DDIC/HTTP/TRAN. */
export interface CreateTypeSpec {
  objtype: CreatableTypeIds;
}
import { createSchema } from './create-schema.js';
import { toOutputPath } from '../../core/path-output.js';

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

export async function runCreateLocal(type: string, name: string, opts: CreateLocalOptions,mode: OutputMode): Promise<void> {
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

/**
 * Create a DDIC object via the self-built ICF service.
 * Reads the abap-file-format JSON from `--file`, validates it, converts to wire
 * schema, and POSTs /ddic/<type>. Command-line --description overrides the file's
 * description. Other required fields (package, transport for non-$TMP) are validated
 * client-side before the round-trip.
 *
 * For TABL/STRU, the file `--file` is the *abap-file-format* main JSON
 * (`<name>.tabl.json` / `<name>.stru.json`). When the same directory also has
 * the sibling `<name>.tabl.ddic` (DDL source of truth) and optionally
 * `<name>.tabl.settings.json`, those sidecars are read together and merged
 * into the wire payload — i.e. we honor the full abap-file-format three-piece
 * layout. When only the main JSON is present we fall back to the legacy
 * wire-flat single-file shape (top-level name/description/fields) for
 * backwards compatibility.
 */
async function runCreateDdic(type: DdicSupportedType, objectName: string, opts: CreateOptions,mode: OutputMode): Promise<void> {
  const filePath = path.resolve(process.cwd(), opts.file ?? '');
  let local: DdicObject;
  try {
    local = await readDdicObjectForCreate(filePath, type);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const outFile = toOutputPath(opts.file);
    // CliError already carries its own code/nextSteps; do not wrap.
    if (error instanceof CliError) throw error;
    // readTablArtifact throws on malformed DDL (e.g. missing `define table ... {`)
    // or when the three-piece layout is incomplete (main without ddic).
    const isTablDdlError = (type === 'TABL' || type === 'STRU')
      && (message.includes('Table and Structure DDL') || message.includes('Incomplete Table and Structure'));
    const code: ErrorCode = isTablDdlError ? 'TABL_DDL_INVALID' : 'INVALID_ARGUMENT';
    const nextSteps = isTablDdlError
      ? [
        'Inspect the .tabl.ddic / .stru.ddic sidecar: it must start with `define table|structure <name> {` and end with `}`.',
        'See the abap-file-format schema (tabl-v1.json / tabt-v1.json) for the supported DDL syntax.',
      ]
      : [
        'Verify the file exists and is valid JSON.',
        'For TABL/STRU, see the abap-file-format three-piece layout (`.tabl.json` + `.tabl.ddic` + `.tabl.settings.json`).',
      ];
    throw new CliError(code, `Cannot read DDIC file ${outFile}: ${message}`, {
      file: outFile,
      type,
      object: objectName,
      nextSteps,
    });
  }

  // Client-side validation (fast-fail, no SAP round-trip for invalid input).
  const errors = validateDdicObject(local, type);
  if (errors.length > 0) {
    const outFile = toOutputPath(opts.file);
    // The example makes the wire-flat layout unambiguous so first-time users
    // don't write the nested abap-file-format header/body layout.
    const example = getDdicFlatJsonExample(type);
    throw new CliError('VALIDATION_ERROR', `Invalid ${type} definition in ${outFile}: ${errors.join('; ')}`, {
      file: outFile,
      type,
      object: objectName,
      details: errors,
      nextSteps: [
        'Fix the errors above and re-run.',
        `Run \`abap create ${type} --schema\` for the per-type contract, or check the assets/tabl-templates/schemas/ JSON Schemas in the repo.`,
      ],
      example: `${example}\n# expected top-level fields: name, description, fields[]; description may also live under header.description`,
    });
  }

  // Non-$TMP package requires a transport request.
  // $TMP is case-insensitive — shells sometimes expand $TMP to "" and users retype it,
  // so accept $TMP / $tmp / $Tmp the same way extension.ts does.
  const targetPackage = (opts.package ?? '$TMP').trim().toUpperCase();
  if (targetPackage !== '$TMP' && !opts.tr) {
    throw new CliError('VALIDATION_ERROR', 'transportRequest is required when package is not $TMP', {
      nextSteps: ['Re-run with --tr <REQUEST>', 'Or use --package $TMP for local objects.'],
      example: `abap create ${type} ${objectName} --file ${toOutputPath(opts.file)} --package ${opts.package} --tr <REQUEST> --description "..."`,
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

  printResult(mode,
    {
      object: resp.data.name,
      type,
      action: resp.data.action,
      file: toOutputPath(opts.file),
    },
    `Created ${type} ${resp.data.name} via ICF ${resp.data.action === 'created' ? '(new)' : '(overwritten)'}`,
  );
}

/**
 * Create an HTTP service via the self-built ICF service.
 * Reads the abap-file-format JSON from `--file`, validates it, converts to wire
 * schema, and POSTs /http/<name>. Command-line --description overrides the file's
 * description. Other required fields (package, transport for non-$TMP) are validated
 * client-side before the round-trip.
 */
async function runCreateHttp(type: 'HTTP', objectName: string, opts: CreateOptions,mode: OutputMode): Promise<void> {
  const filePath = path.resolve(process.cwd(), opts.file ?? '');
  let local: Awaited<ReturnType<typeof readHttpJson>>;
  try {
    local = await readHttpJson(filePath);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const outFile = toOutputPath(opts.file);
    throw new CliError('INVALID_ARGUMENT', `Cannot read HTTP service file ${outFile}: ${message}`, {
      file: outFile,
      nextSteps: [
        'Verify the file exists and is valid JSON.',
        'See the abap-file-format HTTP schema (http-v1.json) for the expected layout.',
      ],
    });
  }

  // Client-side validation (fast-fail, no SAP round-trip for invalid input).
  const errors = validateHttpObject(local);
  if (errors.length > 0) {
    const outFile = toOutputPath(opts.file);
    throw new CliError('VALIDATION_ERROR', `Invalid ${type} definition in ${outFile}: ${errors.join('; ')}`, {
      file: outFile,
      type,
      object: objectName,
      details: errors,
      nextSteps: [
        'Fix the errors above and re-run.',
        'See the abap-file-format HTTP schema (http-v1.json) for the per-field contract.',
      ],
    });
  }

  // Nnsitive $TMP matching: extension.ts uses the same convention.
  const targetPackage = (opts.package ?? '$TMP').trim().toUpperCase();
  if (targetPackage !== '$TMP' && !opts.tr) {
    throw new CliError('VALIDATION_ERROR', 'transportRequest is required when package is not $TMP', {
      nextSteps: ['Re-run with --tr <REQUEST>', 'Or use --package $TMP for local objects.'],
      example: `abap create ${type} ${objectName} --file ${toOutputPath(opts.file)} --package ${opts.package} --tr <REQUEST> --description "..."`,
    });
  }

  // Convert to wire schema. CLI flags override file values when both are present.
  const wire = httpLocalToWire(local);
  if (opts.description) {
    wire.header = wire.header ?? {};
    wire.header.description = opts.description;
  }
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

  printResult(mode,
    {
      object: resp.data.name,
      type,
      action: resp.data.action,
      file: toOutputPath(opts.file),
    },
    `Created ${type} ${resp.data.name} via ICF ${resp.data.action === 'created' ? '(new)' : '(overwritten)'}`,
  );
}

/**
 * Create a transaction code (SE93) via the self-built ICF service.
 * Reads the abap-file-format JSON from `--file`, validates it, converts to wire
 * schema, and POSTs /tran/<code>. Command-line --description overrides the file's
 * description. Non-$TMP package requires --tr.
 */
async function runCreateTran(type: 'TRAN', objectName: string, opts: CreateOptions,mode: OutputMode): Promise<void> {
  const filePath = path.resolve(process.cwd(), opts.file ?? '');
  let local: Awaited<ReturnType<typeof readTranJson>>;
  try {
    local = await readTranJson(filePath);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const outFile = toOutputPath(opts.file);
    throw new CliError('INVALID_ARGUMENT', `Cannot read Transaction file ${outFile}: ${message}`, {
      file: outFile,
      nextSteps: [
        'Verify the file exists and is valid JSON.',
        'See the abap-file-format Transaction schema (tran-v1.json) for the expected layout.',
      ],
    });
  }

  const errors = validateTranObject(local);
  if (errors.length > 0) {
    const outFile = toOutputPath(opts.file);
    throw new CliError('VALIDATION_ERROR', `Invalid ${type} definition in ${outFile}: ${errors.join('; ')}`, {
      file: outFile,
      type,
      object: objectName,
      details: errors,
      nextSteps: [
        'Fix the errors above and re-run.',
        'See the abap-file-format Transaction schema (tran-v1.json) for the per-field contract.',
      ],
    });
  }

  const targetPackage = (opts.package ?? '$TMP').trim().toUpperCase();
  if (targetPackage !== '$TMP' && !opts.tr) {
    throw new CliError('VALIDATION_ERROR', 'transportRequest is required when package is not $TMP', {
      nextSteps: ['Re-run with --tr <REQUEST>', 'Or use --package $TMP for local objects.'],
      example: `abap create ${type} ${objectName} --file ${toOutputPath(opts.file)} --package ${opts.package} --tr <REQUEST> --description "..."`,
    });
  }

  const wire = tranLocalToWire(local);
  if (opts.description) wire.description = opts.description;
  if (opts.package) wire.package = opts.package;
  if (opts.tr) wire.transportRequest = opts.tr;

  const icf = await IcfClient.create();
  const resp = await icf.postTran<{ name: string; type: string; action: 'created' | 'updated' }>(objectName, wire);
  if (resp.status !== 'success' || !resp.data) {
    const code = (resp.error?.code ?? 'TRAN_CREATE_FAILED') as ErrorCode;
    throw new CliError(code, resp.error?.message ?? `Failed to create ${type} ${objectName}`, {
      object: objectName,
      type,
      details: resp.error?.details,
      nextSteps: [
        'Verify the file conforms to the abap-file-format Transaction JSON schema.',
        'Re-run after fixing the cause above.',
      ],
    });
  }

  printResult(mode,
    {
      object: resp.data.name,
      type,
      action: resp.data.action,
      file: toOutputPath(opts.file),
    },
    `Created ${type} ${resp.data.name} via ICF ${resp.data.action === 'created' ? '(new)' : '(overwritten)'}`,
  );
}

/**
 * Create a function module (FUGR/FF) inside an existing function group.
 * `abap create FUGR <group> --func <name>`: the group must already exist; the
 * module is POSTed to the ADT create endpoint
 * `/sap/bc/adt/functions/groups/<group>/fmodules` (abap-adt-api objectcreator
 * FUGR/FF), then activated unless --no-activate. Create-then-pull writes the
 * `<group>.fugr.<fm>.func.{abap,json}` pair with the same layout pull produces
 * for an existing module; existing local group files are never overwritten.
 */
async function runCreateFugrFunc(groupName: string, funcNameArg: string, opts: CreateOptions, mode: OutputMode): Promise<void> {
  const funcName = normalizeName(funcNameArg);
  validateObjectName(funcName);
  if (opts.checkOnly) {
    throw new CliError('INVALID_ARGUMENT', '--check-only is not supported with --func', {
      nextSteps: ['Create the function module directly (no validation endpoint for FUGR/FF in this phase).'],
      example: `abap create FUGR ${groupName} --func ${funcName} --package '${opts.package}' --description "..." --yes`,
    });
  }

  const client = await AdtClientWrapper.create();

  // FM creation has no parent auto-create: the function group must already exist.
  let group: ResolvedObject;
  try {
    group = await resolveObject(client, groupName, 'FUGR');
  } catch (error: unknown) {
    if (error instanceof CliError && error.code === 'OBJECT_NOT_FOUND') {
      throw new CliError('OBJECT_NOT_FOUND', `Function group ${groupName} not found — create it first`, {
        object: groupName,
        nextSteps: [`Create the group first: abap create FUGR ${groupName} --package <pkg> --description "..."`],
        example: `abap create FUGR ${groupName} --package '${opts.package}' --description "group for ${funcName}" --yes`,
      });
    }
    throw error;
  }
  const groupNameUp = group.name;
  const groupLow = groupNameUp.toLowerCase();
  const groupUrl = group.objectUrl.replace(/\/+$/, '');

  // Refuse to overwrite an existing module in this group.
  if (await fugrFuncExists(client, groupNameUp, funcName)) {
    throw new CliError('OBJECT_EXISTS', `Function module ${funcName} already exists in function group ${groupNameUp}`, {
      object: funcName,
      nextSteps: ['Choose a different --func name, or edit/push the existing module instead.'],
    });
  }

  const transport = await resolveTransport(
    client,
    opts.tr,
    client.getConfig().transport,
    // $TMP is case-insensitive (see runCreate).
    { transportOptional: (opts.package ?? '$TMP').trim().toUpperCase() === '$TMP' },
  );

  const fmUrl = `${groupUrl}/fmodules/${funcName.toLowerCase()}`;
  try {
    await client.createObject({
      objtype: 'FUGR/FF',
      name: funcName,
      parentName: groupNameUp,
      description: opts.description,
      parentPath: groupUrl,
      transport,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError('CREATE_FAILED', `Failed to create function module ${funcName} in ${groupNameUp}: ${message}`, {
      object: funcName,
      type: 'FUGR/FF',
    });
  }

  // Real SAP creates the module active in $TMP; activate explicitly so
  // --no-activate and non-$TMP packages behave like the other create paths.
  const skipActivate = opts.activate === false;
  if (!skipActivate) {
    try {
      await client.activate(fmUrl, 'FUGR/FF', funcName);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new CliError('ACTIVATION_FAILED', `Created ${funcName} but activation failed: ${message}`, {
        object: funcName,
        type: 'FUGR/FF',
        nextSteps: ['Re-run activation: abap activate <group> or activate the module in ADT/SE80.'],
      });
    }
  }

  // Create-then-pull: write the local .func pair. skipExisting keeps any
  // user-edited group files untouched; the new func files cannot exist yet.
  let localFile: string | undefined;
  if (opts.pull !== false) {
    const { pullObject } = await import('./pull-source.js');
    const pulled = await pullObject(
      client,
      { name: groupNameUp, type: 'FUGR/F', objectUrl: groupUrl },
      { dir: 'src', overwrite: false, skipExisting: true },
    );
    const funcAbapSuffix = `${groupLow}.fugr.${funcName.toLowerCase()}.func.abap`;
    const written = pulled.written.find((f) => f.endsWith(funcAbapSuffix));
    if (written) localFile = toOutputPath(written);
  }

  printResult(mode,
    {
      object: funcName,
      type: 'FUGR/FF',
      group: groupNameUp,
      package: opts.package,
      description: opts.description,
      transport,
      activated: skipActivate ? false : true,
      localFile,
    },
    `Created function module ${funcName} in function group ${groupNameUp}${skipActivate ? ' (not activated)' : ''} (${transport})`,
  );
}

/** Whether a function module already exists inside a specific function group. */
async function fugrFuncExists(client: AdtClientWrapper, group: string, funcName: string): Promise<boolean> {
  const results = await client.searchObject(`*${funcName}*`, '', 200);
  const groupLow = group.toLowerCase();
  return results.some(
    (r) =>
      r['adtcore:type']?.startsWith('FUGR/FF')
      && r['adtcore:name'] === funcName
      && String(r['adtcore:uri']).includes(`/functions/groups/${groupLow}/fmodules/`),
  );
}

/**
 * 036: TTYP / MSAG / DDLS create helpers.
 *
 * Each one reads the local abap-file-format JSON, validates against the
 * canonical schema, then routes through channel-detect (ADT preferred,
 * ICF fallback for TTYP/MSAG, hard-error for DDLS on ECC).
 *
 * These intentionally mirror the spec 014 `runCreateDdic` shape — same
 * `read → validate → POST → envelope` flow — but skip the legacy
 * wire-flat layout: TTYP/MSAG/DDLS only ship the AFF nested form.
 */

async function loadChannelProfile(): Promise<{ kernelRelease?: string }> {
  const cfg = await loadConfig();
  return { kernelRelease: cfg.systemVersion };
}

async function runCreateTtyp(name: string, opts: CreateOptions, mode: OutputMode): Promise<void> {
  const filePath = path.resolve(process.cwd(), opts.file!);
  let doc: Awaited<ReturnType<typeof readTtypJson>>;
  try {
    doc = await readTtypJson(filePath);
  } catch (error: unknown) {
    throw new CliError('FILE_PARSE_ERROR', `Cannot read TTYP file ${toOutputPath(opts.file)}: ${error instanceof Error ? error.message : String(error)}`, {
      file: toOutputPath(opts.file),
    });
  }
  const errors = await validateTtypObject(doc);
  if (errors.length > 0) {
    throw new CliError('VALIDATION_ERROR', `Invalid TTYP definition in ${toOutputPath(opts.file)}: ${errors.join('; ')}`, {
      file: toOutputPath(opts.file),
      details: errors,
    });
  }
  const profile = await loadChannelProfile();
  const decision = detectChannel(profile, 'ttyp');
  const wire = ttypLocalToWire(doc);
  if (decision.channel === 'adt') {
    const client = await AdtClientWrapper.create();
    await client.createTtyp(name, wire, opts.package, opts.tr);
    printResult(mode, { object: name, type: 'TTYP', action: 'created', channel: 'adt' }, `Created TTYP ${name} via ADT`);
  } else {
    const icf = await IcfClient.create();
    const resp = await icf.post(`/ddic/ttyp/${encodeURIComponent(name)}`, { main: doc, ...(opts.tr ? { transportRequest: opts.tr } : {}) });
    if (resp.status !== 'success') {
      throw new CliError('DDIC_CREATE_FAILED' as never, resp.error?.message ?? 'ICF TTYP create failed', { object: name, type: 'TTYP', details: resp.error?.details });
    }
    printResult(mode, { object: name, type: 'TTYP', action: 'created', channel: 'icf' }, `Created TTYP ${name} via ICF fallback`);
  }
}

async function runCreateMsag(name: string, opts: CreateOptions, mode: OutputMode): Promise<void> {
  const filePath = path.resolve(process.cwd(), opts.file!);
  let doc: Awaited<ReturnType<typeof readMsagJson>>;
  try {
    doc = await readMsagJson(filePath);
  } catch (error: unknown) {
    throw new CliError('FILE_PARSE_ERROR', `Cannot read MSAG file ${toOutputPath(opts.file)}: ${error instanceof Error ? error.message : String(error)}`, {
      file: toOutputPath(opts.file),
    });
  }
  const errors = await validateMsagObject(doc);
  if (errors.length > 0) {
    throw new CliError('VALIDATION_ERROR', `Invalid MSAG definition in ${toOutputPath(opts.file)}: ${errors.join('; ')}`, {
      file: toOutputPath(opts.file),
      details: errors,
    });
  }
  const profile = await loadChannelProfile();
  const decision = detectChannel(profile, 'msag');
  const wire = msagLocalToWire(doc);
  if (decision.channel === 'adt') {
    const client = await AdtClientWrapper.create();
    await client.createMsag(name, wire, opts.package, opts.tr);
    printResult(mode, { object: name, type: 'MSAG', action: 'created', channel: 'adt' }, `Created MSAG ${name} via ADT`);
  } else {
    const icf = await IcfClient.create();
    const resp = await icf.post(`/ddic/msag/${encodeURIComponent(name)}`, { main: doc, ...(opts.tr ? { transportRequest: opts.tr } : {}) });
    if (resp.status !== 'success') {
      throw new CliError('DDIC_CREATE_FAILED' as never, resp.error?.message ?? 'ICF MSAG create failed', { object: name, type: 'MSAG', details: resp.error?.details });
    }
    printResult(mode, { object: name, type: 'MSAG', action: 'created', channel: 'icf' }, `Created MSAG ${name} via ICF fallback`);
  }
}

async function runCreateDdls(name: string, opts: CreateOptions, mode: OutputMode): Promise<void> {
  const filePath = path.resolve(process.cwd(), opts.file!);
  let doc: Awaited<ReturnType<typeof readDdlsJson>>;
  try {
    doc = await readDdlsJson(filePath);
  } catch (error: unknown) {
    throw new CliError('FILE_PARSE_ERROR', `Cannot read DDLS file ${toOutputPath(opts.file)}: ${error instanceof Error ? error.message : String(error)}`, {
      file: toOutputPath(opts.file),
    });
    // unreachable but keeps the linter happy
    void doc;
  }
  const errors = await validateDdlsObject(doc);
  if (errors.length > 0) {
    throw new CliError('VALIDATION_ERROR', `Invalid DDLS definition in ${toOutputPath(opts.file)}: ${errors.join('; ')}`, {
      file: toOutputPath(opts.file),
      details: errors,
    });
  }
  const profile = await loadChannelProfile();
  // channel-detect throws DDLS_NOT_SUPPORTED_ON_ECC if the system is too old.
  const decision = detectChannel(profile, 'ddls');
  if (decision.channel !== 'adt') {
    // Defensive: channel-detect already throws — but TS can't infer that.
    throw new CliError('DDLS_NOT_SUPPORTED_ON_ECC', 'DDLS on ECC is not supported', { object: name, type: 'DDLS' });
  }
  // Read the companion .ddls.acds for the source string. Create flow
  // requires the user to ship both files (the JSON without the source is
  // meaningless).
  const basePath = filePath.replace(/\.ddls\.json$/, '');
  let source = '';
  try {
    source = await fs.readFile(`${basePath}.ddls.acds`, 'utf8');
  } catch {
    throw new CliError('VALIDATION_ERROR', `DDLS companion file missing: ${basePath}.ddls.acds`, {
      file: `${basePath}.ddls.acds`,
      nextSteps: ['Both files must be supplied on create — write the DDL next to the JSON.'],
    });
  }
  const wire = ddlsLocalToWire(doc, source);
  const client = await AdtClientWrapper.create();
  await client.createDdls(name, wire, opts.package, opts.tr);
  printResult(mode, { object: name, type: 'DDLS', action: 'created', channel: 'adt' }, `Created DDLS ${name} via ADT`);
}

export async function runCreate(type: string | undefined, name: string | undefined, opts: CreateOptions,mode: OutputMode): Promise<void> {
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
  // 036: TTYP / MSAG / DDLS use --file <path> as the only required input (description is part of the JSON).
  if (typeUpper === 'TTYP' || typeUpper === 'MSAG' || typeUpper === 'DDLS') {
    if (!opts.file) {
      throw new CliError('USAGE', `Type ${typeUpper} requires --file <path> with an abap-file-format JSON`, {
        example: `abap create ${typeUpper} ${objectName} --file src/${objectName.toLowerCase()}/${objectName.toLowerCase()}.${typeUpper.toLowerCase()}.json --package $TMP --yes`,
      });
    }
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

  // DDIC types route to the self-built ICF service.
  if (isDdicSupportedType(typeUpper)) {
    if (!opts.file) {
      throw new CliError('USAGE', `DDIC type ${typeUpper} requires --file <path> with an abap-file-format JSON`, {
        example: `abap create ${typeUpper} ${objectName} --file src/${objectName.toLowerCase()}.${typeUpper.toLowerCase()}.json --package $TMP --description "..."`,
      });
    }
    await runCreateDdic(typeUpper, objectName, opts, mode);
    return;
  }

  // HTTP service routes to the self-built ICF service.
  if (isHttpSupportedType(typeUpper)) {
    if (!opts.file) {
      // 032 US10 (T043/T044): HTTP create without --file writes a minimal
      // abap-file-format skeleton to `src/http/<name>/<name>.http.json` and
      // returns `status: local` (no SAP round-trip). The user can then edit
      // the skeleton and `abap push` it.
      const skeletonPath = path.join('src', 'http', objectName.toLowerCase(), `${objectName.toLowerCase()}.http.json`);
      const absSkeleton = path.resolve(process.cwd(), skeletonPath);
      try {
        await fs.access(absSkeleton);
        // File exists — refuse to overwrite without explicit consent (matches
        // 014 OVERWRITE_REQUIRED convention used by pull flows).
        throw new CliError('OVERWRITE_REQUIRED', `${skeletonPath} already exists; remove it first or pass --file to a different path`, {
          file: skeletonPath,
          nextSteps: [
            'Remove the existing skeleton and re-run.',
            'Or pass `--file <other-path>` to write a custom JSON file before the SAP round-trip.',
          ],
          example: `abap create HTTP ${objectName} --package $TMP --description "..."`,
        });
      } catch (probeError: unknown) {
        // fs.access throws ENOENT when file doesn't exist — that's the green
        // light to write the skeleton. Other errors (permission, etc.)
        // propagate.
        const code = (probeError as NodeJS.ErrnoException)?.code;
        if (code !== 'ENOENT') throw probeError;
      }
      // Write the minimal skeleton. `name` mirrors the pull layout so the
      // file validates and can be pushed right after editing url/handler.
      const skeleton = {
        name: objectName,
        formatVersion: '1',
        header: {
          description: opts.description ?? '',
          originalLanguage: 'en',
        },
        generalInformation: {
          handlerClass: '',
          url: '',
        },
      };
      await fs.mkdir(path.dirname(absSkeleton), { recursive: true });
      await fs.writeFile(absSkeleton, JSON.stringify(skeleton, null, 2) + '\n', 'utf-8');
      printResult(mode,
        {
          object: objectName,
          type: typeUpper,
          action: 'local',
          file: skeletonPath,
        },
        `Wrote HTTP service skeleton ${skeletonPath} (no SAP round-trip; edit then abap push)`,
      );
      return;
    }
    await runCreateHttp(typeUpper, objectName, opts, mode);
    return;
  }

  // Transaction code (SE93) routes to the self-built ICF service.
  if (isTranSupportedType(typeUpper)) {
    if (!opts.file) {
      throw new CliError('USAGE', `Transaction code requires --file <path> with an abap-file-format JSON`, {
        example: `abap create TRAN ${objectName} --file src/${objectName.toLowerCase()}.tran.json --package $TMP --description "..."`,
      });
    }
    await runCreateTran(typeUpper, objectName, opts, mode);
    return;
  }

  // 036-ttyp-msag-ddls: dual-channel DDIC + CDS via ADT (or ICF for TTYP/MSAG on ECC).
  if (typeUpper === 'TTYP') {
    await runCreateTtyp(objectName, opts, mode);
    return;
  }
  if (typeUpper === 'MSAG') {
    await runCreateMsag(objectName, opts, mode);
    return;
  }
  if (typeUpper === 'DDLS') {
    await runCreateDdls(objectName, opts, mode);
    return;
  }

  // Function module (FUGR/FF) inside an existing function group: type FUGR,
  // <name> is the group, --func names the new module.
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

export function resolveType(type: string): CreateTypeSpec {
  const t = type.toUpperCase();
  const supported = allSupportedTypes();
  if (isDdicSupportedType(t)) {
    throw new CliError(
      'DDIC_NOT_SUPPORTED',
      `Object type ${t} is a DDIC object; not supported in this phase (ICF service not implemented yet)`,
      { type: t },
    );
  }
  // HTTP service is supported via ICF (handled upstream by runCreate → runCreateHttp).
  // resolveType is only consulted by runCreateLocal; HTTP local draft skeletons are not
  // generated here — keep the rejection semantics aligned with DDIC for `create local`.
  if (isHttpSupportedType(t)) {
    throw new CliError(
      'TYPE_NOT_SUPPORTED',
      `Object type ${t} is an HTTP service; only \`abap create ${t} <name> --file <path>\` is supported (ICF route, not \`create local\`).`,
      { type: t, supported },
    );
  }
  // Transaction code is supported via ICF (handled upstream by runCreate → runCreateTran).
  // resolveType is only consulted by runCreateLocal — keep the same rejection semantics.
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
      `Object type ${t} is not supported. Supported types: ${supported.join(', ')}`,
      { type: t, supported },
    );
  }
  return { objtype: objtype as CreatableTypeIds };
}

function normalizeName(name: string): string {
  return name.trim().toUpperCase();
}

const OBJECT_NAME_MAX_LENGTH = 30;
/** Legal chars for a non-namespaced segment; matches what SAP accepts in $TMP. */
const OBJECT_NAME_SEGMENT = /^[A-Z0-9_]+$/;
/** Namespaced object names: /<NS up to 10>/<name>; total length ≤ 30 (incl. slashes). */
const NAMESPACED_OBJECT_NAME = /^\/[A-Z0-9_]{1,10}\/[A-Z0-9_]+$/;

/**
 * Local fail-fast object-name validation, mirroring DDIC's client-side name
 * checks (VALIDATION_ERROR / exit 7). Runs on the uppercased name before any
 * SAP round-trip. Deliberately does NOT enforce a Z/Y prefix: $TMP accepts
 * names like A123, so only truly illegal shapes are rejected.
 */
function validateObjectName(objectName: string): void {
  const namespaced = objectName.startsWith('/');
  let reason: string;
  if (!objectName) {
    reason = 'name is empty';
  } else if (objectName.length > OBJECT_NAME_MAX_LENGTH) {
    reason = `name is ${objectName.length} characters; SAP object names are at most ${OBJECT_NAME_MAX_LENGTH}`;
  } else if (namespaced ? !NAMESPACED_OBJECT_NAME.test(objectName) : !OBJECT_NAME_SEGMENT.test(objectName)) {
    reason = namespaced
      ? 'namespaced names must look like /<NS>/<NAME> with a namespace of up to 10 characters and only A-Z 0-9 _'
      : 'name may only contain A-Z, 0-9 and _ (no spaces or punctuation)';
  } else {
    return;
  }
  throw new CliError('VALIDATION_ERROR', `Invalid object name '${objectName}': ${reason}`, {
    object: objectName,
    details: [reason],
    nextSteps: [
      `Use at most ${OBJECT_NAME_MAX_LENGTH} characters from A-Z 0-9 _ (namespaced: /<NS>/<NAME>), e.g. ZCL_MY_CLASS.`,
    ],
  });
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
