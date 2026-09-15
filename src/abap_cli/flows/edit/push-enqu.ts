/**
 * PR5 (B1): ENQU (lock object) push via the ICF `/ddic/enqu` route.
 *
 * Like the other DDIC types, `push --file` first probes the object via
 * `GET /ddic/enqu/<name>` to satisfy the "push is update, not create"
 * contract (`create` is the only path that accepts upsert semantics).
 * ENQU cannot be created on-the-fly by an unqualified push — use
 * `abap create ENQU` first.
 */
import { IcfClient } from '../../clients/icf-client.js';
import { CliError } from '../../output/json.js';
import type { ErrorCode } from '../../output/error-codes.js';
import { readEnquJson, localToWire, validateEnquObject } from '../../formats/enqu/json.js';
import { resolveFile } from '../../formats/file-resolver.js';

export interface RunPushEnquOptions {
  transport?: string;
}

/**
 * Push a single ENQU .json file via the ICF service.
 *
 * Existence is checked first via `GET /ddic/enqu/<name>`; if the object is
 * not on the system, surface a clear `OBJECT_NOT_FOUND` with the create
 * command in `nextSteps`. The ICF POST on this code path is the "update
 * existing" branch — SAP's BAPI for ENQU is upsert-shaped but we deliberately
 * disallow the silent create to keep `push` aligned with the
 * "update-only" contract documented in `wiki/commands/push.md`.
 */
export async function runPushEnqu(
  file: string,
  opts: RunPushEnquOptions = {},
): Promise<{ channel: 'adt' | 'icf' }> {
  const local = await readEnquJson(file);
  const errors = await validateEnquObject(local);
  if (errors.length > 0) {
    throw new CliError('VALIDATION_ERROR', `Invalid ENQU file: ${errors.join('; ')}`, {
      file,
      type: 'ENQU',
      details: errors,
    });
  }

  // The lock object name comes from the file name (`<name>.enqu.json`), not
  // from `primaryTable.name` — that is the table being locked, a different
  // object entirely (lock object EAABVAR_ID locks table AAB_VAR_ID).
  const objectName = resolveFile(file).objectName;

  const icf = await IcfClient.create();
  // Existence check first.
  const head = await icf.getDdic<Record<string, unknown>>('enqu', objectName);
  if (head.status !== 'success' || !head.data) {
    const code: ErrorCode = 'OBJECT_NOT_FOUND';
    throw new CliError(
      code,
      `ENQU ${objectName} not found in system`,
      {
        object: objectName,
        type: 'ENQU',
        nextSteps: [
          `Create the lock object first: \`abap create ENQU ${objectName} --file ${file} --package <pkg> --tr <tr> --yes\``,
        ],
      },
    );
  }

  const wire = localToWire(local);
  (wire as Record<string, unknown>).name = objectName;
  if (opts.transport) (wire as Record<string, unknown>).transportRequest = opts.transport;
  const resp = await icf.postDdic<unknown>('enqu', wire);
  if (resp.status !== 'success') {
    const code = (resp.error?.code ?? 'ENQU_PUSH_FAILED') as ErrorCode;
    throw new CliError(code, resp.error?.message ?? `Failed to push ENQU ${objectName}`, {
      object: local.primaryTable.name,
      type: 'ENQU',
      details: resp.error?.details,
    });
  }
  return { channel: 'icf' };
}
