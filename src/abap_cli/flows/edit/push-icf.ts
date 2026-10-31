/**
 * ICF-routed artifact push handlers.
 *
 * Everything here posts an abap-file-format `.json` document through the
 * self-built ICF service (`/sap/abap_cli`) — DDIC objects, HTTP service nodes
 * and transaction codes. The coordinator (`push.ts`) dispatches through
 * `routing.ts`; keeping the ICF payload/validation code here means the
 * coordinator stays a file-level orchestrator.
 */
import * as path from 'node:path';
import type { AdtClientWrapper } from '../../clients/adt-client.js';
import { IcfClient, type IcfResponse } from '../../clients/icf-client.js';
import { CliError } from '../../output/json.js';
import type { ErrorCode } from '../../output/error-codes.js';
import { resolveTransport } from '../../core/transport.js';
import { readDdicObjectForCreate } from '../../formats/ddic/io.js';
import { localToWire } from '../../formats/ddic/wire.js';
import { validateDdicObject, validateTabtPayload } from '../../formats/ddic/validate.js';
import { type DdicObject, type DdicSupportedType, type DdicWirePayload } from '../../formats/ddic/types.js';
import {
  httpArtifact,
  localToWire as httpLocalToWire,
  validateHttpObject,
  type HttpObjectLocal,
} from '../../formats/http/json.js';
import {
  tranArtifact,
  localToWire as tranLocalToWire,
  validateTranObject,
  type TranObjectLocal,
} from '../../formats/transport/json.js';
import { resolveFile } from '../../formats/file-resolver.js';
import { toRelativeOutputPath } from '../../core/path-output.js';
import type { JsonPushTarget, PushFileOptions, PushOneResult } from './push-types.js';

/** Push a .json file via the self-built ICF service.
 *  DDIC types (DOMA/DTEL/TABL/STRU) → POST /ddic/<type>.
 *  HTTP service                     → POST /http/<name>.
 */
export async function pushDdicFile(
  client: AdtClientWrapper,
  resolved: JsonPushTarget,
  file: string,
  opts: PushFileOptions,
  type: DdicSupportedType,
): Promise<PushOneResult> {
  // DDIC abap-file-format JSON, read + validated by the shared helper. For
  // TABL/STRU the helper honors sibling `.tabl.ddic` / `.tabl.settings.json`
  // and maps a malformed DDL to TABL_DDL_INVALID. The caller
  // (`pushOne`) already rejected --check-only and handled --dry-run.
  const { local, wire } = await readValidatedDdic(file, type, resolved.objectName);

  // Transport: --tr > config > file's recorded request > ($TMP → none) > user's open request.
  const packageName = (wire.package ?? '').toUpperCase();
  let transport = opts.tr ?? client.getConfig().transport ?? local.transportRequest ?? '';
  if (!transport && packageName !== '$TMP') {
    transport = await resolveTransport(client, opts.tr, client.getConfig().transport);
  }
  wire.transportRequest = transport || undefined;

  const icf = await IcfClient.create();
  // push updates existing objects only — never let the ICF upsert create one.
  await requirePushTargetExists(
    'DDIC_OBJECT_NOT_FOUND',
    () => icf.getDdic(type.toLowerCase(), resolved.objectName),
    { name: resolved.objectName, type },
    file,
  );
  const resp = await icf.postDdic<{ name: string; type: string; action: 'created' | 'updated' }>(type.toLowerCase(), wire);
  if (resp.status !== 'success' || !resp.data) {
    const code = (resp.error?.code ?? 'DDIC_CREATE_FAILED') as ErrorCode;
    throw new CliError(code, resp.error?.message ?? `Failed to push ${type} ${resolved.objectName}`, {
      object: resolved.objectName,
      type,
      details: resp.error?.details,
      nextSteps: [
        'Verify the file conforms to the abap-file-format JSON schema.',
        'Re-run after fixing the cause above.',
      ],
    });
  }
  return { transport, status: 'written' };
}

/** Result of a local ICF-file validation: the parsed local doc (+ wire for DDIC). */
interface ValidatedDdicFile {
  /** The abap-file-format local shape (settings live under `generalInformation`). */
  local: DdicObject;
  /** Wire payload built by `localToWire` (carries `package` / `transportRequest`). */
  wire: DdicWirePayload;
}

/**
 * Read + validate a DDIC `.json` file. Shared by the real push path and the
 * `--atomic` phase-1 validator, so both agree on error codes:
 *   - malformed TABL/STRU DDL sidecar            → TABL_DDL_INVALID
 *   - other read failures                        → INVALID_ARGUMENT
 *   - schema validation errors                   → VALIDATION_ERROR
 *   - invalid TABT settings (TABL/STRU only)     → TABT_VALIDATION_FAILED
 */
async function readValidatedDdic(
  file: string,
  type: DdicSupportedType,
  objectName: string,
): Promise<ValidatedDdicFile> {
  const outFile = toRelativeOutputPath(file);
  const usesDdlSidecar = type === 'TABL' || type === 'STRU';
  let local: DdicObject;
  try {
    // abap-file-format three-piece: TABL/STRU honor sibling .tabl.ddic /
    // .tabl.settings.json when present. Falls back to the legacy single JSON
    // for DOMA/DTEL (or when no sidecar exists). readTablArtifact throws on
    // malformed DDL — mapped to TABL_DDL_INVALID below.
    local = await readDdicObjectForCreate(path.resolve(process.cwd(), file), type);
  } catch (error: unknown) {
    const m = error instanceof Error ? error.message : String(error);
    const isTablDdlError = usesDdlSidecar && /Invalid Table and Structure DDL/i.test(m);
    const code: ErrorCode = isTablDdlError ? 'TABL_DDL_INVALID' : 'INVALID_ARGUMENT';
    throw new CliError(code, `Cannot read ${type} file ${outFile}: ${m}`, {
      file: outFile,
      type,
      object: objectName,
      nextSteps: isTablDdlError
        ? [
            `Inspect the .${type.toLowerCase()}.ddic sidecar: it must start with \`define table|structure ${objectName} {\` and end with \`}\`.`,
            `For TABL/STRU, see the abap-file-format three-piece layout (.${type.toLowerCase()}.json + .${type.toLowerCase()}.ddic + .${type.toLowerCase()}.settings.json).`,
          ]
        : ['Verify the file exists, is readable, and contains valid JSON.'],
    });
  }

  const errors = validateDdicObject(local, type);
  if (errors.length > 0) {
    throw new CliError('VALIDATION_ERROR', `Invalid ${type} definition in ${outFile}: ${errors.join('; ')}`, {
      file: outFile,
      type,
      object: objectName,
      details: errors,
    });
  }

  const wire = localToWire(type, local);

  // TABT schema validation — gate the wire payload against tabt-v1.json
  // enum values so the CLI rejects invalid buffering/state/storageType before
  // posting to SAP (where apply_ddic_table_settings would raise
  // DDIC_FIELD_UNSUPPORTED instead).
  if (usesDdlSidecar) {
    const settingsWire = (local as Record<string, unknown>).generalInformation;
    if (settingsWire) {
      const tabtErrors = validateTabtPayload(settingsWire);
      if (tabtErrors) {
        throw new CliError('TABT_VALIDATION_FAILED', `Invalid TABT settings in ${outFile}: ${tabtErrors.join('; ')}`, {
          file: outFile,
          type,
          object: objectName,
          details: { schemaFile: 'tabt-v1.json', errors: tabtErrors },
          nextSteps: [
            'Inspect the .tabl.settings.json (or .tabl.json embedded generalInformation).',
            `Run \`abap pull ${objectName} --type ${type}\` to refresh the file with current SAP-side values.`,
          ],
        });
      }
    }
  }

  return { local, wire };
}

/** `--atomic` phase-1 wrapper: validate only, discard the parsed payload. */
export async function validateDdicFile(file: string, type: string): Promise<void> {
  // objectName is only used to enrich error messages; --atomic re-resolves it
  // from the file, so pass the resolved name through when available.
  await readValidatedDdic(file, type as DdicSupportedType, resolveFile(file).objectName);
}

/**
 * Read + validate a HTTP service `.json` file (shared by the push path and the
 * `--atomic` phase-1 validator).
 */
async function readValidatedHttp(file: string, objectName: string) {
  const outFile = toRelativeOutputPath(file);
  let local: HttpObjectLocal;
  try {
    local = await httpArtifact.read(path.resolve(process.cwd(), file));
  } catch (error: unknown) {
    const m = error instanceof Error ? error.message : String(error);
    throw new CliError('INVALID_ARGUMENT', `Cannot read HTTP service file ${outFile}: ${m}`, { file: outFile });
  }
  const errors = validateHttpObject(local);
  if (errors.length > 0) {
    throw new CliError('VALIDATION_ERROR', `Invalid HTTP service definition in ${outFile}: ${errors.join('; ')}`, {
      file: outFile,
      type: 'HTTP',
      object: objectName,
      details: errors,
    });
  }
  return local;
}

export async function validateHttpFile(file: string): Promise<void> {
  await readValidatedHttp(file, resolveFile(file).objectName);
}

/**
 * Read + validate a Transaction `.json` file (shared by the push path and the
 * `--atomic` phase-1 validator).
 */
async function readValidatedTran(file: string, objectName: string) {
  const outFile = toRelativeOutputPath(file);
  let local: TranObjectLocal;
  try {
    local = await tranArtifact.read(path.resolve(process.cwd(), file));
  } catch (error: unknown) {
    const m = error instanceof Error ? error.message : String(error);
    throw new CliError('INVALID_ARGUMENT', `Cannot read Transaction file ${outFile}: ${m}`, { file: outFile });
  }
  const errors = validateTranObject(local as Parameters<typeof validateTranObject>[0]);
  if (errors.length > 0) {
    throw new CliError('VALIDATION_ERROR', `Invalid TRAN definition in ${outFile}: ${errors.join('; ')}`, {
      file: outFile,
      type: 'TRAN',
      object: objectName,
      details: errors,
    });
  }
  return local;
}

export async function validateTranFile(file: string): Promise<void> {
  await readValidatedTran(file, resolveFile(file).objectName);
}

/**
 * Push a HTTP service .json file via ICF POST /http/<name>.
 * The SAP-side handler creates/updates a SICF node with the given handler class + URL.
 *
 * exception: HTTP push KEEPS create-on-push — the SAP-side handler
 * creates/updates the SICF node, so no existence probe here (unlike DDIC/TRAN).
 * `abap create HTTP` requires `--file`; push remains the create path when the
 * JSON was authored by hand or produced by `abap pull`.
 */
export async function pushHttpFile(
  client: AdtClientWrapper,
  resolved: JsonPushTarget,
  file: string,
  opts: PushFileOptions,
): Promise<PushOneResult> {
  const local = await readValidatedHttp(file, resolved.objectName);

  const wire = httpLocalToWire(local);
  // Transport: --tr > config > file's recorded request > ($TMP → none) > user's open request.
  const packageName = (wire.package ?? '').toUpperCase();
  let transport = opts.tr ?? client.getConfig().transport ?? local.transportRequest ?? '';
  if (!transport && packageName !== '$TMP') {
    transport = await resolveTransport(client, opts.tr, client.getConfig().transport);
  }
  wire.transportRequest = transport || undefined;

  const icf = await IcfClient.create();
  const resp = await icf.postHttp<{ name: string; type: string; action: 'created' | 'updated' }>(resolved.objectName, wire);
  if (resp.status !== 'success' || !resp.data) {
    const code = (resp.error?.code ?? 'HTTP_CREATE_FAILED') as ErrorCode;
    throw new CliError(code, resp.error?.message ?? `Failed to push HTTP service ${resolved.objectName}`, {
      object: resolved.objectName,
      type: 'HTTP',
      details: resp.error?.details,
      nextSteps: [
        'Verify the file conforms to the abap-file-format HTTP service JSON schema.',
        'Re-run after fixing the cause above.',
      ],
    });
  }
  return { transport, status: 'written' };
}

/**
 * Push a Transaction (.tran.json) file via ICF POST /tran/<code>.
 * The SAP-side handler routes to RPY_TRANSACTION_INSERT (or BDC for OO) and
 * runs corr_insert + TADIR when a transport is given.
 */
export async function pushTranFile(
  client: AdtClientWrapper,
  resolved: JsonPushTarget,
  file: string,
  opts: PushFileOptions,
): Promise<PushOneResult> {
  const local = await readValidatedTran(file, resolved.objectName);

  const wire = tranLocalToWire(local as Parameters<typeof tranLocalToWire>[0]);
  const packageName = (wire.package ?? '').toUpperCase();
  let transport = opts.tr ?? client.getConfig().transport ?? local.transportRequest ?? '';
  if (!transport && packageName !== '$TMP') {
    transport = await resolveTransport(client, opts.tr, client.getConfig().transport);
  }
  wire.transportRequest = transport || undefined;

  const icf = await IcfClient.create();
  // push updates existing objects only; a missing tcode goes through `create TRAN`.
  await requirePushTargetExists(
    'TRAN_OBJECT_NOT_FOUND',
    () => icf.getTran(resolved.objectName),
    { name: resolved.objectName, type: 'TRAN' },
    file,
  );
  const resp = await icf.postTran<{ name: string; type: string; action: 'created' | 'updated' }>(resolved.objectName, wire);
  if (resp.status !== 'success' || !resp.data) {
    const code = (resp.error?.code ?? 'TRAN_CREATE_FAILED') as ErrorCode;
    throw new CliError(code, resp.error?.message ?? `Failed to push TRAN ${resolved.objectName}`, {
      object: resolved.objectName,
      type: 'TRAN',
      details: resp.error?.details,
      nextSteps: [
        'Verify the file conforms to the abap-file-format Transaction JSON schema.',
        'Re-run after fixing the cause above.',
      ],
    });
  }
  return { transport, status: 'written' };
}

/**
 * push updates existing objects only. Probe DDIC/TRAN targets over the
 * same ICF GET pull uses, so a missing object surfaces as OBJECT_NOT_FOUND
 * (with a `create` pointer) instead of the ICF POST silently creating one.
 * HTTP is exempt — pushing a `.http.json` creates/updates the SICF node, so a
 * user can author the JSON by hand and `abap push` it without a prior create.
 */
async function requirePushTargetExists(
  notFoundCode: 'DDIC_OBJECT_NOT_FOUND' | 'TRAN_OBJECT_NOT_FOUND',
  probe: () => Promise<IcfResponse<unknown>>,
  object: { name: string; type: string },
  file: string,
): Promise<void> {
  const resp = await probe();
  if (resp.status === 'success' && resp.data) return;
  const outFile = toRelativeOutputPath(file);
  if (resp.error?.code === notFoundCode) {
    throw new CliError('OBJECT_NOT_FOUND', `${object.type} ${object.name} does not exist; push updates existing objects only`, {
      object: object.name,
      type: object.type,
      file: outFile,
      nextSteps: [
        `Create it first: abap create ${object.type} ${object.name} --file ${outFile} --package <package> --description "<desc>"`,
        'Then push again to update the object.',
      ],
      example: `abap push ${outFile}`,
    });
  }
  const rawCode = (resp.error?.code ?? 'SAP_ERROR') as ErrorCode;
  throw new CliError(rawCode, resp.error?.message ?? `Failed to check whether ${object.type} ${object.name} exists`, {
    object: object.name,
    type: object.type,
    file: outFile,
    nextSteps: ['Re-run after fixing the cause above.'],
  });
}
