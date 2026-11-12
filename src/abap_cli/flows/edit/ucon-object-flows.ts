/**
 * Shared ICF flows for the UCON object types: UCON RFC service (SRFC),
 * OAuth 2.0 profile (OA2P) and UCON HTTP service (UCON_HTTP).
 *
 * All three types are TADIR objects served by the bundled ICF service with the
 * same shape: a single `<name>.<type>.json` local-extension document, create/update
 * through `POST /<type>/<name>`, read through `GET`, delete through `DELETE`,
 * and package / transport rules identical to the ICF DDIC types (local
 * `$`-prefixed packages are transport-free, everything else needs `--tr`).
 * The per-type differences live in the `UconFlowSpec` bound at the bottom
 * (`SRFC_FLOW` / `OA2P_FLOW` / `UCON_HTTP_FLOW`), so the four operations stay
 * one implementation.
 */
import * as path from 'node:path';
import type { AdtClientWrapper } from '../../clients/adt-client.js';
import { IcfClient, type IcfResponse } from '../../clients/icf-client.js';
import { CliError, printResult, type OutputMode } from '../../output/json.js';
import type { ErrorCode } from '../../output/error-codes.js';
import { isLocalPackageName, transportForPackage } from '../../core/transport.js';
import { buildFilename, resolveFile } from '../../formats/file-resolver.js';
import { fileExists } from '../../formats/abap-source.js';
import { toOutputPath, toRelativeOutputPath, normalizePullData } from '../../core/path-output.js';
import type { WireArtifact } from '../../formats/artifact.js';
import { resolveArtifactPushTransport } from './push-artifact-transport.js';
import type { CreateOptions } from './create.js';
import type { PullOptions, PullResult } from './pull-shared.js';
import type { JsonPushTarget, PushFileOptions, PushOneResult } from './push-types.js';
import type { DeleteOptions, DeleteResult } from './delete.js';
import { assertUconFileNameMatches, validateUconName } from './ucon-shared.js';
import { srfcArtifact, type SrfcLocal, type SrfcWire } from '../../formats/srfc/json.js';
import { oa2pArtifact, type Oa2pLocal, type Oa2pWire } from '../../formats/oa2p/json.js';
import { uconHttpArtifact, type UconHttpLocal, type UconHttpWire } from '../../formats/ucon-http/json.js';

/** Error codes the flows surface for one UCON type. */
export interface UconErrorCodes {
  /** ICF route reports the object does not exist (404). */
  notFound: string;
  /** Read through the ICF route failed (SAP_ERROR). */
  readFailed: string;
  /** Create/update through the ICF route failed (SAP_ERROR). */
  writeFailed: string;
  /** Delete through the ICF route failed (SAP_ERROR). */
  deleteFailed: string;
  /** Transport request missing for a transportable package (VALIDATION_ERROR). */
  transportRequired: string;
}

/** Everything one UCON object type contributes to the shared flows. */
export interface UconFlowSpec<TLocal extends { formatVersion: string }, TWire extends TLocal> {
  /** User-facing type code (SRFC / OA2P / UCON_HTTP). */
  type: 'SRFC' | 'OA2P' | 'UCON_HTTP';
  /** Human label used in messages ("UCON RFC service" / "OAuth2 profile"). */
  label: string;
  /** SAP-side object key length (both are CHAR 30). */
  maxNameLength: number;
  /** Local file suffix after the object token, e.g. `srfc.json`. */
  fileSuffix: string;
  /** ICF route prefix, e.g. `/srfc`. */
  endpoint: string;
  /** Local ↔ wire mapping + schema validation. */
  artifact: WireArtifact<TLocal, TWire>;
  /** Whether `--description` overrides the local document (SRFC / UCON_HTTP). */
  descriptionApplicable: boolean;
  /** Tables the write touches, shown in the `--check-only` plan. */
  writes: string[];
  /** `abap create` invocation shown in name / usage errors. */
  createExample: string;
  codes: UconErrorCodes;
}

/** Wire fields the shared flows add on top of the artifact-produced document. */
interface TransportFields {
  name?: string;
  package?: string;
  transportRequest?: string;
}

type UconWire<TWire> = TWire & TransportFields;

function routePath(spec: UconFlowSpec<never, never> | UconFlowSpec<any, any>, name: string): string {
  return `${spec.endpoint}/${encodeURIComponent(name)}`;
}

function nameSpec(spec: UconFlowSpec<any, any>) {
  return { type: spec.type, label: spec.label, maxLength: spec.maxNameLength, example: spec.createExample };
}

/**
 * Map an unsuccessful ICF response to a CliError. The 404 envelope of the
 * type's route becomes the generic OBJECT_NOT_FOUND contract used by every
 * other flow (with a type-specific next step).
 */
function objectNotFound(
  spec: UconFlowSpec<any, any>,
  action: 'read' | 'write' | 'delete',
  name: string,
  opts: { file?: string; details?: unknown[] } = {},
): CliError {
  const file = opts.file;
  const nextSteps =
    action === 'read'
      ? [`Verify the ${spec.label} exists in the target system.`, 'Run `abap search <name>` to confirm the object name.']
      : [`Verify the ${spec.label} exists in the target system.`];
  return new CliError('OBJECT_NOT_FOUND', `${spec.label} ${name} does not exist${action === 'read' ? '' : ' any more'}`, {
    object: name,
    type: spec.type,
    ...(file ? { file } : {}),
    details: opts.details,
    nextSteps,
  });
}

function icfFailure(
  spec: UconFlowSpec<any, any>,
  resp: IcfResponse<unknown>,
  action: 'read' | 'write' | 'delete',
  name: string,
  opts: { file?: string } = {},
): CliError {
  const file = opts.file;
  if (resp.error?.code === spec.codes.notFound) {
    return objectNotFound(spec, action, name, { ...(file ? { file } : {}), details: resp.error?.details });
  }
  const fallback =
    action === 'read' ? spec.codes.readFailed : action === 'delete' ? spec.codes.deleteFailed : spec.codes.writeFailed;
  return new CliError((resp.error?.code ?? fallback) as ErrorCode, resp.error?.message ?? `Failed to ${action} ${spec.label} ${name}`, {
    object: name,
    type: spec.type,
    ...(file ? { file } : {}),
    details: resp.error?.details,
    nextSteps: ['Fix the cause above and re-run.'],
  });
}

/**
 * The ICF client throws 4xx envelopes (`normalizeError`) instead of returning
 * them with `status:'error'`, so the flows translate the type's not-found code
 * here. Other envelope codes keep flowing through verbatim; the `icfFailure`
 * path still covers responses the client returns as an envelope.
 */
async function callIcf<T>(
  call: Promise<IcfResponse<T>>,
  spec: UconFlowSpec<any, any>,
  action: 'read' | 'write' | 'delete',
  name: string,
  opts: { file?: string } = {},
): Promise<IcfResponse<T>> {
  try {
    return await call;
  } catch (error) {
    if (error instanceof CliError && error.code === spec.codes.notFound) {
      throw objectNotFound(spec, action, name, opts);
    }
    throw error;
  }
}

/** Push is update-only: a missing target gets the create-first hint. */
function pushMissingError(spec: UconFlowSpec<any, any>, name: string, outFile: string): CliError {
  return new CliError('OBJECT_NOT_FOUND', `${spec.label} ${name} does not exist; push updates existing objects only`, {
    object: name,
    type: spec.type,
    file: outFile,
    nextSteps: [
      `Create it first: abap create ${spec.type} ${name} --file ${outFile} --package '<package>' --yes`,
      'Then push again to update the object.',
    ],
    example: `abap push ${outFile}`,
  });
}

/** Attach the write-time transport fields without losing the artifact wire shape. */
function wireWithTransport<TWire extends { formatVersion: string }>(wire: TWire, name: string): UconWire<TWire> {
  const typed = wire as UconWire<TWire>;
  typed.name = name;
  return typed;
}

/**
 * Read + validate a local `<name>.<type>.json` document.
 *
 * @throws CliError INVALID_ARGUMENT for unreadable files, VALIDATION_ERROR for
 *   schema/semantic errors.
 */
async function readValidatedUcon<TLocal extends { formatVersion: string }, TWire extends TLocal>(
  spec: UconFlowSpec<TLocal, TWire>,
  file: string,
  objectName: string,
): Promise<TLocal> {
  const outFile = toRelativeOutputPath(file);
  const filePath = path.resolve(process.cwd(), file);
  if (!filePath.toLowerCase().endsWith(`.${spec.fileSuffix}`)) {
    throw new CliError('VALIDATION_ERROR', `${spec.label} document must use the .${spec.fileSuffix} suffix: ${outFile}`, {
      file: outFile,
      type: spec.type,
      object: objectName,
    });
  }
  assertUconFileNameMatches(objectName, filePath, { type: spec.type, label: spec.label, suffix: spec.fileSuffix }, outFile);
  try {
    return await spec.artifact.load(filePath);
  } catch (error: unknown) {
    if (error instanceof CliError) throw error;
    throw new CliError(
      'INVALID_ARGUMENT',
      `Cannot read ${spec.label} file ${outFile}: ${error instanceof Error ? error.message : String(error)}`,
      {
        file: outFile,
        type: spec.type,
        object: objectName,
        nextSteps: [`Verify the file exists and is a valid ${spec.fileSuffix} JSON document.`],
      },
    );
  }
}

/**
 * Create one UCON object from a local document.
 *
 * `--check-only` validates the document and the name locally and prints the
 * plan without any SAP call.
 */
export async function runCreateUcon<TLocal extends { formatVersion: string }, TWire extends TLocal>(
  spec: UconFlowSpec<TLocal, TWire>,
  objectName: string,
  opts: CreateOptions,
  mode: OutputMode,
): Promise<void> {
  const name = validateUconName(objectName, nameSpec(spec));

  if (opts.activate === false) {
    throw new CliError(
      'VALIDATION_ERROR',
      `${spec.label} has no separate activation step; --no-activate is not supported`,
      {
        object: name,
        type: spec.type,
        nextSteps: ['Drop --no-activate: the object is in effect as soon as the write succeeds.'],
      },
    );
  }

  if (!opts.file) {
    throw new CliError('USAGE', `${spec.type} create requires --file <path> with a ${spec.fileSuffix} JSON`, {
      object: name,
      type: spec.type,
      nextSteps: [`See \`abap create --schema ${spec.type}\` for the contract and a minimal example.`],
      example: spec.createExample,
    });
  }

  let local = await readValidatedUcon(spec, opts.file, name);
  const targetPackage = (opts.package ?? '$TMP').trim().toUpperCase();

  // `--description` overrides the document's description only for types that
  // carry one; SRFC stores a short text, OA2P has no description field.
  if (opts.description !== undefined && opts.description.trim() !== '') {
    if (!spec.descriptionApplicable) {
      throw new CliError('TYPE_NOT_SUPPORTED', `${spec.type} profiles have no description field; drop --description`, {
        object: name,
        type: spec.type,
        details: { action: 'create' },
        nextSteps: [`Edit the ${spec.fileSuffix} document instead: this type has no description field.`],
        example: spec.createExample,
      });
    }
    local = { ...(local as object), description: opts.description.trim() } as unknown as TLocal;
    const overrideErrors = await spec.artifact.validate(local);
    if (overrideErrors.length > 0) {
      throw new CliError('VALIDATION_ERROR', `Invalid --description for ${spec.label} ${name}: ${overrideErrors.join('; ')}`, {
        object: name,
        type: spec.type,
        file: toOutputPath(opts.file),
        details: overrideErrors,
      });
    }
  }

  if (!isLocalPackageName(targetPackage) && !opts.tr) {
    throw new CliError(
      'VALIDATION_ERROR',
      `transportRequest is required when package is not a local package (got ${targetPackage})`,
      {
        object: name,
        type: spec.type,
        nextSteps: ['Re-run with --tr <REQUEST>.', 'Or use a local package ($TMP) for local objects.'],
        example: spec.createExample,
      },
    );
  }

  if (opts.checkOnly) {
    printResult(
      mode,
      {
        object: name,
        type: spec.type,
        checkOnly: true,
        valid: true,
        issues: [],
        file: toOutputPath(opts.file),
        plan: {
          action: 'POST',
          path: `/sap/abap_cli${routePath(spec, name)}`,
          package: targetPackage,
          writes: ['TADIR', ...spec.writes],
        },
      },
      `${spec.label} ${name} document is valid (no object created).`,
    );
    return;
  }

  const wire = wireWithTransport(spec.artifact.toWire(local), name);
  wire.package = targetPackage;
  const transportRequest = transportForPackage(targetPackage, opts.tr);
  if (transportRequest) wire.transportRequest = transportRequest;

  const icf = await IcfClient.create();
  const resp = await callIcf(
    icf.post<{ name: string; type: string; action: 'created' | 'updated'; package?: string }>(routePath(spec, name), wire),
    spec,
    'write',
    name,
    { file: toOutputPath(opts.file) },
  );
  if (resp.status !== 'success' || !resp.data) {
    throw icfFailure(spec, resp, 'write', name, { file: toOutputPath(opts.file) });
  }

  const action = resp.data.action === 'updated' ? 'updated' : 'created';
  printResult(
    mode,
    {
      object: resp.data.name ?? name,
      type: spec.type,
      action,
      channel: 'icf',
      package: resp.data.package ?? targetPackage,
      file: toOutputPath(opts.file),
    },
    `Created ${spec.label} ${resp.data.name ?? name} via ICF (${action === 'created' ? 'new' : 'overwritten'})`,
  );
}

/** Pull one UCON object into the local `<name>.<type>.json` document. */
export async function runPullUcon<TLocal extends { formatVersion: string }, TWire extends TLocal>(
  spec: UconFlowSpec<TLocal, TWire>,
  objectName: string,
  opts: PullOptions,
): Promise<PullResult> {
  const name = validateUconName(objectName, nameSpec(spec));
  const icf = await IcfClient.create();
  const resp = await callIcf(icf.get<TWire>(routePath(spec, name)), spec, 'read', name);
  if (resp.status !== 'success' || !resp.data) {
    throw icfFailure(spec, resp, 'read', name);
  }

  const local = spec.artifact.fromWire(resp.data);
  const filename = buildFilename(name, spec.type, 'main', '.json');
  const relPath = path.join(opts.dir, filename);
  const targetPath = path.resolve(process.cwd(), relPath);

  if ((await fileExists(targetPath)) && !opts.overwrite && !opts.skipExisting) {
    const outPath = toOutputPath(relPath);
    throw new CliError('OVERWRITE_REQUIRED', `${outPath} already exists; use --overwrite to replace it`, {
      file: outPath,
      nextSteps: ['Re-run with --overwrite to replace the existing file.'],
      example: `abap pull ${name} --type ${spec.type} --overwrite`,
    });
  }
  if ((await fileExists(targetPath)) && opts.skipExisting) {
    const outPath = toOutputPath(relPath);
    return {
      data: normalizePullData({
        object: name,
        type: spec.type,
        entries: [{ file: outPath, status: 'skipped' }],
        written: [],
        skipped: [outPath],
        failed: [],
      }),
      human: `Skipped ${spec.label} ${name} (file already exists: ${outPath})`,
    };
  }

  await spec.artifact.write(targetPath, local);
  const outPath = toOutputPath(relPath);
  return {
    data: normalizePullData({
      object: name,
      type: spec.type,
      entries: [{ file: outPath, status: 'written' }],
      written: [outPath],
      skipped: [],
      failed: [],
    }),
    human: `Pulled ${spec.label} ${name} to ${outPath}`,
  };
}

/** `--atomic` phase-1 wrapper: validate the local document only. */
export async function validateUconFile<TLocal extends { formatVersion: string }, TWire extends TLocal>(
  spec: UconFlowSpec<TLocal, TWire>,
  file: string,
): Promise<void> {
  const name = validateUconName(resolveFile(file).objectName, nameSpec(spec));
  await readValidatedUcon(spec, file, name);
}

/** Push (update-only) one local UCON document through the ICF service. */
export async function pushUconFile<TLocal extends { formatVersion: string }, TWire extends TLocal>(
  spec: UconFlowSpec<TLocal, TWire>,
  client: AdtClientWrapper,
  resolved: JsonPushTarget,
  file: string,
  opts: PushFileOptions,
): Promise<PushOneResult> {
  const name = validateUconName(resolved.objectName, nameSpec(spec));
  if (opts.activate === false) {
    throw new CliError(
      'VALIDATION_ERROR',
      `${spec.label} has no separate activation step; --no-activate is not supported`,
      {
        object: name,
        type: spec.type,
        nextSteps: ['Drop --no-activate: the object is in effect as soon as the write succeeds.'],
      },
    );
  }
  const local = await readValidatedUcon(spec, file, name);
  const outFile = toRelativeOutputPath(file);

  const icf = await IcfClient.create();
  // push updates existing objects only; `create` is the creating path.
  let head: IcfResponse<TWire>;
  try {
    head = await icf.get<TWire>(routePath(spec, name));
  } catch (error) {
    if (error instanceof CliError && error.code === spec.codes.notFound) {
      throw pushMissingError(spec, name, outFile);
    }
    throw error;
  }
  if (head.status !== 'success' || !head.data) {
    if (head.error?.code === spec.codes.notFound) {
      throw pushMissingError(spec, name, outFile);
    }
    throw icfFailure(spec, head, 'read', name, { file: outFile });
  }

  // The target's package decides the local-ness / transport rule; a pulled
  // local document carries no package, so take it from the ICF GET payload.
  const { packageName, transport } = await resolveArtifactPushTransport(
    client,
    {
      objectName: name,
      objectType: spec.type,
      filePackage: (head.data as { package?: string }).package,
    },
    opts.tr,
  );
  const wire = wireWithTransport(spec.artifact.toWire(local), name);
  if (packageName !== undefined && packageName !== '') wire.package = packageName;
  wire.transportRequest = transport || undefined;

  const resp = await callIcf(
    icf.post<{ name: string; action: 'created' | 'updated' }>(routePath(spec, name), wire),
    spec,
    'write',
    name,
    { file: outFile },
  );
  if (resp.status !== 'success' || !resp.data) {
    throw icfFailure(spec, resp, 'write', name, { file: outFile });
  }
  return { transport, status: 'written' };
}

/**
 * Delete one UCON object.
 *
 * The ICF GET probe reads the package: local `$`-prefixed objects need no
 * transport request, everything else requires `--tr` (recorded by the SAP side
 * in TADIR / CTS).
 */
export async function runDeleteUcon<TLocal extends { formatVersion: string }, TWire extends TLocal>(
  spec: UconFlowSpec<TLocal, TWire>,
  objectName: string,
  opts: DeleteOptions,
): Promise<DeleteResult> {
  const name = validateUconName(objectName, nameSpec(spec));

  const icf = await IcfClient.create();
  const probe = await callIcf(icf.get<{ package?: string }>(routePath(spec, name)), spec, 'read', name);
  if (probe.status !== 'success' || !probe.data) {
    throw icfFailure(spec, probe, 'read', name);
  }
  const packageName = probe.data.package;
  if (!isLocalPackageName(packageName) && !opts.tr) {
    throw new CliError('MISSING_TRANSPORT', `${spec.label} ${name} is in package ${packageName ?? '?'}; --tr is required`, {
      details: { object: name, type: spec.type, packageName },
      nextSteps: [
        'Pass --tr <request> to record the deletion in a transportable change.',
        'Or recreate the object in a local package ($TMP) if it is local scratch work.',
      ],
      example: `abap delete ${name} --type ${spec.type} --tr <REQUEST> --yes`,
    });
  }

  const resp = await callIcf(
    icf.deleteIcfRoute<{ name: string; action: string }>(
      routePath(spec, name),
      opts.tr ? { transportRequest: opts.tr } : {},
    ),
    spec,
    'delete',
    name,
  );
  if (resp.status !== 'success' || !resp.data) {
    throw icfFailure(spec, resp, 'delete', name);
  }

  return {
    data: {
      object: name,
      type: spec.type,
      ...(packageName ? { packageName } : {}),
      deleted: true,
      ...(opts.tr ? { transport: opts.tr } : {}),
      lockReleased: true,
    },
    human: `Deleted ${spec.label} ${name}` + (opts.tr ? ` (transport ${opts.tr})` : ''),
  };
}

// ----- per-type bindings -----

/** UCON RFC service (SRFC) binding of the shared flows. */
export const SRFC_FLOW: UconFlowSpec<SrfcLocal, SrfcWire> = {
  type: 'SRFC',
  label: 'UCON RFC service',
  maxNameLength: 30,
  fileSuffix: 'srfc.json',
  endpoint: '/srfc',
  artifact: srfcArtifact,
  descriptionApplicable: true,
  writes: ['UCONRFCSERVHEAD/UCONRFCSERVTEXT'],
  createExample: "abap create SRFC ZMY_RFC_SERVICE --file src/zmy_rfc_service.srfc.json --package '$TMP' --yes",
  codes: {
    notFound: 'SRFC_OBJECT_NOT_FOUND',
    readFailed: 'SRFC_READ_FAILED',
    writeFailed: 'SRFC_WRITE_FAILED',
    deleteFailed: 'SRFC_DELETE_FAILED',
    transportRequired: 'SRFC_TRANSPORT_REQUIRED',
  },
};

/** OAuth 2.0 client profile (OA2P) binding of the shared flows. */
export const OA2P_FLOW: UconFlowSpec<Oa2pLocal, Oa2pWire> = {
  type: 'OA2P',
  label: 'OAuth2 profile',
  maxNameLength: 30,
  fileSuffix: 'oa2p.json',
  endpoint: '/oa2p',
  artifact: oa2pArtifact,
  descriptionApplicable: false,
  writes: ['OA2C_PROFILES/OA2P_SCOPES'],
  createExample: "abap create OA2P ZMY_OAUTH_PROFILE --file src/zmy_oauth_profile.oa2p.json --package '$TMP' --yes",
  codes: {
    notFound: 'OA2P_OBJECT_NOT_FOUND',
    readFailed: 'OA2P_READ_FAILED',
    writeFailed: 'OA2P_WRITE_FAILED',
    deleteFailed: 'OA2P_DELETE_FAILED',
    transportRequired: 'OA2P_TRANSPORT_REQUIRED',
  },
};

/** UCON HTTP service (UCON_HTTP) binding of the shared flows. */
export const UCON_HTTP_FLOW: UconFlowSpec<UconHttpLocal, UconHttpWire> = {
  type: 'UCON_HTTP',
  label: 'UCON HTTP service',
  maxNameLength: 30,
  fileSuffix: 'ucon_http.json',
  endpoint: '/ucon_http',
  artifact: uconHttpArtifact,
  descriptionApplicable: true,
  writes: ['UCONHTTPSERVHEAD/UCONHTTPSERVTEXT/UCONHTTPSERVHANDL'],
  createExample: "abap create UCON_HTTP ZMY_HTTP_SERVICE --file src/zmy_http_service.ucon_http.json --package '$TMP' --yes",
  codes: {
    notFound: 'UCON_HTTP_OBJECT_NOT_FOUND',
    readFailed: 'UCON_HTTP_READ_FAILED',
    writeFailed: 'UCON_HTTP_WRITE_FAILED',
    deleteFailed: 'UCON_HTTP_DELETE_FAILED',
    transportRequired: 'UCON_HTTP_TRANSPORT_REQUIRED',
  },
};
