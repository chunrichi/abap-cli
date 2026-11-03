/**
 * Shared helpers for the authorization-family flows (AUTH / SUSC / SUCU /
 * SUSH / SUSO).
 *
 * The five types share one lifecycle: the object is one JSON document served by
 * the bundled ICF service under `/auth/<sub>/<name>`. Package and transport
 * travel as query parameters because the documents carry neither; `$`-prefixed
 * local packages are transport-free and everything else needs an explicit
 * `--tr`, matching the other ICF write paths (VIEW / SHLP / XSLT / JOBD).
 */
import { CliError } from '../../output/json.js';
import type { ErrorCode } from '../../output/error-codes.js';
import { isLocalPackageName } from '../../core/transport.js';
import { authFileSuffix, type AuthTypeSpec } from '../../formats/auth/spec.js';

export type AuthAction = 'create' | 'update' | 'delete';

/** Normalize and validate the transport rule for one family write/delete. */
export function authTransportFor<TLocal>(
  spec: AuthTypeSpec<TLocal>,
  packageName: string | undefined,
  tr: string | undefined,
  action: AuthAction,
): string | undefined {
  if (isLocalPackageName(packageName)) {
    // Local objects are transport-free: a stray --tr must not reach SAP.
    return undefined;
  }
  const request = (tr ?? '').trim().toUpperCase();
  if (!request) {
    throw new CliError(`${spec.type}_TRANSPORT_REQUIRED` as ErrorCode, `${spec.type} ${action} in package ${packageName ?? '?'} requires --tr <request>`, {
      type: spec.type,
      details: { packageName },
      nextSteps: [
        'Pass --tr <request> to record the change in a transportable request.',
        `Or move the object to a local package (e.g. $TMP) for scratch work.`,
      ],
      example: `abap ${action === 'delete' ? 'delete' : action === 'create' ? 'create' : 'push'} --tr NDK900123`,
    });
  }
  return request;
}

/** Error context used to decorate ICF failures with file/object information. */
export interface AuthIcfContext {
  action: AuthAction | 'read';
  objectName: string;
  file?: string;
}

/**
 * Re-throw an ICF client failure as the family flow's actionable error.
 *
 * `IcfClient` already turns the service's error envelope into a `CliError` with
 * the SAP code; the only translation the flows need is the per-type
 * `*_NOT_FOUND` → `OBJECT_NOT_FOUND` mapping (so the exit code stays the
 * generic not-found one) and a hint to create the object first when a push or
 * delete targets a missing object.
 */
export function rethrowAuthIcfError<TLocal>(spec: AuthTypeSpec<TLocal>, error: unknown, ctx: AuthIcfContext): never {
  if (error instanceof CliError) {
    if (error.code === `${spec.type}_NOT_FOUND`) {
      throw new CliError('OBJECT_NOT_FOUND', `${spec.type} ${ctx.objectName} does not exist`, {
        object: ctx.objectName,
        type: spec.type,
        ...(ctx.file ? { file: ctx.file } : {}),
        nextSteps:
          ctx.action === 'update'
            ? [`Create it first: abap create ${spec.type} ${ctx.objectName} --file <path> --package <package> --yes`, 'Then push again to update it.']
            : [`Verify the object exists in the target system (TADIR object ${spec.tadirObject}).`],
      });
    }
    throw error;
  }
  throw new CliError('SAP_ERROR', `${spec.type} ${ctx.action} failed: ${error instanceof Error ? error.message : String(error)}`, {
    object: ctx.objectName,
    type: spec.type,
  });
}

/** Validate that a local file name carries the family's type suffix. */
export function assertAuthFileSuffix<TLocal>(spec: AuthTypeSpec<TLocal>, filePath: string, displayPath: string): void {
  const suffix = authFileSuffix(spec.route);
  if (!filePath.toLowerCase().endsWith(suffix)) {
    throw new CliError('VALIDATION_ERROR', `${spec.type} document must use the ${suffix} suffix: ${displayPath}`, {
      type: spec.type,
      file: displayPath,
      nextSteps: [`Rename the file so it ends with ${suffix} (e.g. ${spec.fileToken('ZEXAMPLE')}${suffix}).`],
    });
  }
}

/** The `package` read-side field the GET envelope adds on top of the document. */
export function readSidePackage(data: unknown): string {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return '';
  const value = (data as Record<string, unknown>).package;
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}
