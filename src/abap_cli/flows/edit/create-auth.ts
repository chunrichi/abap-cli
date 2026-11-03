/**
 * Authorization-family `create` flow (AUTH / SUSC / SUCU / SUSH / SUSO).
 *
 * Read `--file` → validate against the type's AFF-shaped JSON schema + semantic
 * rules → POST `/auth/<sub>/<name>`. The package travels as a query parameter
 * and decides the transport rule (`$` local = transport-free, otherwise
 * `--tr` is required). There is no separate activation step, so `--no-activate`
 * is rejected instead of silently ignored.
 */
import * as path from 'node:path';
import { IcfClient, type AuthQuery } from '../../clients/icf-client.js';
import { CliError, printResult, type OutputMode } from '../../output/json.js';
import type { ErrorCode } from '../../output/error-codes.js';
import { toOutputPath } from '../../core/path-output.js';
import { isLocalPackageName } from '../../core/transport.js';
import type { AuthTypeSpec } from '../../formats/auth/spec.js';
import type { CreateOptions } from './create.js';
import { assertAuthFileSuffix, authTransportFor, rethrowAuthIcfError } from './auth-shared.js';

/** Write envelope the family routes answer for POST/PUT/DELETE. */
interface AuthWriteResponse {
  name?: string;
  type?: string;
  action?: string;
  package?: string;
  activated?: boolean;
  /** SUSO only: whether SAP_ALL/SAP_NEW were regenerated after the write. */
  profilesRegenerated?: boolean;
}

export async function runCreateAuth<TLocal>(
  spec: AuthTypeSpec<TLocal>,
  objectName: string,
  opts: CreateOptions,
  mode: OutputMode,
): Promise<void> {
  const name = spec.normalizeName(objectName);
  if (!opts.file) {
    throw new CliError('VALIDATION_ERROR', `Type ${spec.type} requires --file <path> with a ${spec.schemaFile}-shaped JSON document`, {
      type: spec.type,
      object: name,
      nextSteps: [`See \`abap create --schema ${spec.type}\` for the contract and a minimal example.`],
    });
  }
  if (opts.activate === false) {
    throw new CliError('VALIDATION_ERROR', `${spec.type} writes save the object in one step; --no-activate is not supported`, {
      type: spec.type,
      object: name,
      nextSteps: ['Drop --no-activate: the object is active as soon as the write succeeds.'],
    });
  }
  if (opts.description) {
    throw new CliError('VALIDATION_ERROR', `${spec.type} takes its description from the document header; remove --description`, {
      type: spec.type,
      object: name,
      nextSteps: ['Edit `header.description` in the JSON document instead.'],
    });
  }
  if (opts.regenerateProfiles && spec.type !== 'SUSO') {
    throw new CliError('VALIDATION_ERROR', '--regenerate-profiles is only valid for SUSO', {
      type: spec.type,
      object: name,
      nextSteps: ['The SAP_ALL/SAP_NEW regeneration exists only for authorization objects.'],
    });
  }

  const displayPath = toOutputPath(opts.file);
  const filePath = path.resolve(process.cwd(), opts.file);
  assertAuthFileSuffix(spec, filePath, displayPath);

  let local: TLocal;
  try {
    local = await spec.artifact.load(filePath);
  } catch (error: unknown) {
    if (error instanceof CliError) throw error;
    throw new CliError('FILE_PARSE_ERROR', `Cannot read ${spec.type} file: ${error instanceof Error ? error.message : String(error)}`, {
      type: spec.type,
      file: displayPath,
      object: name,
    });
  }

  const documentName = spec.objectNameFromDocument?.(local);
  if (documentName && documentName !== name) {
    throw new CliError(`${spec.type}_NAME_INVALID` as ErrorCode, `object name in ${displayPath} ("${documentName}") does not match the command argument "${name}"`, {
      type: spec.type,
      object: name,
      file: displayPath,
      nextSteps: ['Change the document name fields, or pass the matching name to `abap create`.'],
    });
  }
  const semanticErrors = spec.validateDocument?.(local) ?? [];
  if (semanticErrors.length > 0) {
    throw new CliError(`${spec.type}_INVALID_PAYLOAD` as ErrorCode, `${spec.type} document failed semantic validation: ${semanticErrors.join('; ')}`, {
      type: spec.type,
      object: name,
      file: displayPath,
      details: semanticErrors,
    });
  }

  const targetPackage = opts.package.trim().toUpperCase();
  const transport = authTransportFor(spec, targetPackage, opts.tr, 'create');
  const wire = spec.artifact.toWire(local);
  const query: AuthQuery = {
    package: targetPackage,
    ...(transport ? { transportRequest: transport } : {}),
    ...(opts.regenerateProfiles ? { regenerateProfiles: true } : {}),
  };

  const icf = await IcfClient.create();
  let resp;
  try {
    resp = await icf.postAuth<AuthWriteResponse>(spec.route, name, wire, query);
  } catch (error: unknown) {
    rethrowAuthIcfError(spec, error, { action: 'create', objectName: name, file: displayPath });
  }
  if (resp.status !== 'success' || !resp.data) {
    throw new CliError((resp.error?.code ?? `${spec.type}_WRITE_FAILED`) as ErrorCode, resp.error?.message ?? `Failed to create ${spec.type} ${name}`, {
      type: spec.type,
      object: name,
      details: resp.error?.details,
    });
  }

  const createdPackage = resp.data.package ?? targetPackage;
  printResult(
    mode,
    {
      object: resp.data.name ?? name,
      type: spec.type,
      action: 'created',
      package: createdPackage,
      ...(resp.data.profilesRegenerated !== undefined ? { profilesRegenerated: resp.data.profilesRegenerated } : {}),
      file: displayPath,
    },
    `Created ${spec.type} ${name} via ICF${isLocalPackageName(createdPackage) ? ' (local package)' : ''}`,
  );
}
