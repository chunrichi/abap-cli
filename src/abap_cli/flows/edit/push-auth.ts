/**
 * Authorization-family `push` flow (AUTH / SUSC / SUCU / SUSH / SUSO).
 *
 * Load + validate the local AFF-shaped document → probe the object
 * (`GET /auth/<sub>/<name>`) so push stays update-only and yields the existing
 * package → PUT `/auth/<sub>/<name>` with the package / transport query. The
 * object name comes from the file name token (AFF layout), so composite TADIR
 * names must encode through the type's `nameFromToken`.
 */
import * as path from 'node:path';
import type { AdtClientWrapper } from '../../clients/adt-client.js';
import { IcfClient, type AuthQuery } from '../../clients/icf-client.js';
import { CliError } from '../../output/json.js';
import type { ErrorCode } from '../../output/error-codes.js';
import { toRelativeOutputPath } from '../../core/path-output.js';
import { resolveFile } from '../../formats/file-resolver.js';
import type { AuthTypeSpec } from '../../formats/auth/spec.js';
import type { JsonPushTarget, PushFileOptions, PushOneResult } from './push-types.js';
import { assertAuthFileSuffix, authTransportFor, readSidePackage, rethrowAuthIcfError } from './auth-shared.js';

interface AuthWriteResponse {
  name?: string;
  type?: string;
  action?: string;
  package?: string;
  activated?: boolean;
  profilesRegenerated?: boolean;
}

/** Read + validate one family document (shared with the `--atomic` phase-1 gate). */
export async function readValidatedAuthFile<TLocal>(spec: AuthTypeSpec<TLocal>, file: string, objectName: string): Promise<TLocal> {
  const outFile = toRelativeOutputPath(file);
  const filePath = path.resolve(process.cwd(), file);
  assertAuthFileSuffix(spec, filePath, outFile);
  try {
    const local = await spec.artifact.load(filePath);
    const semanticErrors = spec.validateDocument?.(local) ?? [];
    if (semanticErrors.length > 0) {
      throw new CliError(`${spec.type}_INVALID_PAYLOAD` as ErrorCode, `${spec.type} document failed semantic validation: ${semanticErrors.join('; ')}`, {
        type: spec.type,
        object: objectName,
        file: outFile,
        details: semanticErrors,
      });
    }
    return local;
  } catch (error: unknown) {
    if (error instanceof CliError) throw error;
    throw new CliError('INVALID_ARGUMENT', `Cannot read ${spec.type} file ${outFile}: ${error instanceof Error ? error.message : String(error)}`, {
      type: spec.type,
      object: objectName,
      file: outFile,
      nextSteps: [`Verify the file exists and is a valid ${spec.schemaFile} JSON document.`],
    });
  }
}

/** `--atomic` phase-1 wrapper: validate only, discard the parsed payload. */
export async function validateAuthFile<TLocal>(spec: AuthTypeSpec<TLocal>, file: string): Promise<void> {
  await readValidatedAuthFile(spec, file, spec.nameFromToken(resolveFile(file).objectName, path.basename(file)));
}

export async function runPushAuth<TLocal>(
  spec: AuthTypeSpec<TLocal>,
  _client: AdtClientWrapper,
  resolved: JsonPushTarget,
  file: string,
  opts: PushFileOptions,
): Promise<PushOneResult> {
  const displayPath = toRelativeOutputPath(file);
  const name = spec.nameFromToken(resolved.objectName, path.basename(file));
  if (opts.activate === false) {
    throw new CliError('VALIDATION_ERROR', `${spec.type} writes save the object in one step; --no-activate is not supported`, {
      type: spec.type,
      object: name,
      file: displayPath,
      nextSteps: ['Drop --no-activate: the object is active as soon as the write succeeds.'],
    });
  }
  if (opts.regenerateProfiles && spec.type !== 'SUSO') {
    throw new CliError('VALIDATION_ERROR', '--regenerate-profiles is only valid for SUSO', {
      type: spec.type,
      object: name,
      file: displayPath,
    });
  }

  const local = await readValidatedAuthFile(spec, file, name);
  const documentName = spec.objectNameFromDocument?.(local);
  if (documentName && documentName !== name) {
    throw new CliError(`${spec.type}_NAME_INVALID` as ErrorCode, `object name in ${displayPath} ("${documentName}") does not match the file name "${name}"`, {
      type: spec.type,
      object: name,
      file: displayPath,
      nextSteps: ['Rename the file so its token encodes the document object name, or fix the document.'],
    });
  }

  const icf = await IcfClient.create();
  // push updates existing objects only; the read also yields the package that
  // decides the transport rule.
  let head;
  try {
    head = await icf.getAuth<Record<string, unknown>>(spec.route, name);
  } catch (error: unknown) {
    rethrowAuthIcfError(spec, error, { action: 'update', objectName: name, file: displayPath });
  }
  const packageName = readSidePackage(head.data);
  const transport = authTransportFor(spec, packageName, opts.tr, 'update');
  const wire = spec.artifact.toWire(local);
  const query: AuthQuery = {
    ...(packageName ? { package: packageName } : {}),
    ...(transport ? { transportRequest: transport } : {}),
    ...(opts.regenerateProfiles ? { regenerateProfiles: true } : {}),
  };

  let resp;
  try {
    resp = await icf.putAuth<AuthWriteResponse>(spec.route, name, wire, query);
  } catch (error: unknown) {
    rethrowAuthIcfError(spec, error, { action: 'update', objectName: name, file: displayPath });
  }
  if (resp.status !== 'success' || !resp.data) {
    throw new CliError((resp.error?.code ?? `${spec.type}_WRITE_FAILED`) as ErrorCode, resp.error?.message ?? `Failed to push ${spec.type} ${name}`, {
      type: spec.type,
      object: name,
      file: displayPath,
      details: resp.error?.details,
      nextSteps: ['Fix the cause above and re-run.'],
    });
  }
  return { transport: transport ?? '', status: 'written' };
}
