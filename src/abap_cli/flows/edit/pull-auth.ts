/**
 * Authorization-family `pull` flow (AUTH / SUSC / SUCU / SUSH / SUSO).
 *
 * GET `/auth/<sub>/<name>` → AFF-shaped wire document (the document fields plus
 * the read-side `name` / `package` metadata) → local `<token>.<sub>.json`. The
 * returned document is re-validated against the local schema so a server/client
 * drift surfaces as an explicit error instead of writing an invalid file.
 */
import * as path from 'node:path';
import { IcfClient } from '../../clients/icf-client.js';
import { CliError } from '../../output/json.js';
import type { ErrorCode } from '../../output/error-codes.js';
import { fileExists } from '../../formats/abap-source.js';
import type { AuthTypeSpec } from '../../formats/auth/spec.js';
import { normalizePullData, toOutputPath } from '../../core/path-output.js';
import type { PullOptions, PullResult } from './pull-shared.js';
import { rethrowAuthIcfError } from './auth-shared.js';

export async function runPullAuth<TLocal>(spec: AuthTypeSpec<TLocal>, objectName: string, opts: PullOptions): Promise<PullResult> {
  const name = spec.normalizeName(objectName);

  const icf = await IcfClient.create();
  let resp;
  try {
    resp = await icf.getAuth<Record<string, unknown>>(spec.route, name);
  } catch (error: unknown) {
    rethrowAuthIcfError(spec, error, { action: 'read', objectName: name });
  }
  if (resp.status !== 'success' || !resp.data) {
    throw new CliError((resp.error?.code ?? `${spec.type}_READ_FAILED`) as ErrorCode, resp.error?.message ?? `Failed to pull ${spec.type} ${name}`, {
      type: spec.type,
      object: name,
    });
  }

  const local = spec.artifact.fromWire(resp.data);
  const semanticErrors = spec.validateDocument?.(local) ?? [];
  if (semanticErrors.length > 0) {
    throw new CliError(`${spec.type}_READ_FAILED` as ErrorCode, `SAP returned a ${spec.type} document that failed semantic validation: ${semanticErrors.join('; ')}`, {
      type: spec.type,
      object: name,
      details: semanticErrors,
    });
  }
  const schemaErrors = await spec.artifact.validate(local);
  if (schemaErrors.length > 0) {
    throw new CliError(`${spec.type}_READ_FAILED` as ErrorCode, `SAP returned a ${spec.type} document that does not match ${spec.schemaFile}: ${schemaErrors.join('; ')}`, {
      type: spec.type,
      object: name,
      details: schemaErrors,
      nextSteps: ['This is a CLI/service version mismatch — re-deploy the bundled ICF service (`abap deploy`).'],
    });
  }

  const filename = `${spec.fileToken(name)}.${spec.route}.json`;
  const relPath = path.join(opts.dir, filename);
  const targetPath = path.resolve(process.cwd(), relPath);
  const outPath = toOutputPath(relPath);

  if ((await fileExists(targetPath)) && !opts.overwrite && !opts.skipExisting) {
    throw new CliError('OVERWRITE_REQUIRED', `${outPath} already exists; use --overwrite to replace it`, {
      file: outPath,
      nextSteps: ['Re-run with --overwrite to replace the existing file.'],
      example: `abap pull ${name} --type ${spec.type} --overwrite`,
    });
  }
  if ((await fileExists(targetPath)) && opts.skipExisting) {
    return {
      data: normalizePullData({
        object: name,
        type: spec.type,
        entries: [{ file: outPath, status: 'skipped' }],
        written: [],
        skipped: [outPath],
        failed: [],
      }),
      human: `Skipped ${spec.type} ${name} (file already exists: ${outPath})`,
    };
  }

  await spec.artifact.write(targetPath, local);
  return {
    data: normalizePullData({
      object: name,
      type: spec.type,
      entries: [{ file: outPath, status: 'written' }],
      written: [outPath],
      skipped: [],
      failed: [],
    }),
    human: `Pulled ${spec.type} ${name} to ${outPath}`,
  };
}