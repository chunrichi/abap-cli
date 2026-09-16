/**
 * PR5 (B1): NROB (number range object) push via the ICF `/ddic/nrob` route.
 *
 * Mirrors `push-enqu.ts`: existence check first (GET), then POST. NROB has
 * no abap-adt-api endpoint so the channel is hard-coded to `icf`.
 */
import { IcfClient } from '../../clients/icf-client.js';
import { CliError } from '../../output/json.js';
import type { ErrorCode } from '../../output/error-codes.js';
import { readNrobJson, localToWire, validateNrobObject } from '../../formats/nrob/json.js';

export interface RunPushNrobOptions {
  transport?: string;
}

export async function runPushNrob(
  file: string,
  opts: RunPushNrobOptions = {},
): Promise<{ channel: 'adt' | 'icf' }> {
  const local = await readNrobJson(file);
  const errors = await validateNrobObject(local);
  if (errors.length > 0) {
    throw new CliError('VALIDATION_ERROR', `Invalid NROB file: ${errors.join('; ')}`, {
      file,
      type: 'NROB',
      details: errors,
    });
  }

  const icf = await IcfClient.create();
  const head = await icf.getDdic<Record<string, unknown>>('nrob', local.interval.numberLengthDomain.toUpperCase());
  if (head.status !== 'success' || !head.data) {
    throw new CliError(
      'OBJECT_NOT_FOUND',
      `NROB ${local.interval.numberLengthDomain} not found in system`,
      {
        object: local.interval.numberLengthDomain,
        type: 'NROB',
        nextSteps: [
          `Create the number range object first: \`abap create NROB ${local.interval.numberLengthDomain} --file ${file} --package <pkg> --tr <tr> --yes\``,
        ],
      },
    );
  }

  const wire = localToWire(local);
  if (opts.transport) (wire as Record<string, unknown>).transportRequest = opts.transport;
  const resp = await icf.postDdic<unknown>('nrob', wire);
  if (resp.status !== 'success') {
    const code = (resp.error?.code ?? 'NROB_PUSH_FAILED') as ErrorCode;
    throw new CliError(code, resp.error?.message ?? `Failed to push NROB ${local.interval.numberLengthDomain}`, {
      object: local.interval.numberLengthDomain,
      type: 'NROB',
      details: resp.error?.details,
    });
  }
  return { channel: 'icf' };
}
