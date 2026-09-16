/**
 * PR5 (B1): NROB (number range object) push.
 *
 * Dual-channel: ADT primary (S/4HANA exposes NROB at
 * `/sap/bc/adt/numberranges/objects`), ICF fallback (ECC EHP5/6 → bundled
 * `/ddic/nrob`). Channel picked by `channel-detect` from the active profile.
 *
 * Mirrors `push-msag` / `push-ttyp`: on the ADT path we lock + PUT + unlock
 * (the object lock is mandatory for SAP to accept the PUT); on the ICF path
 * the bundled handler owns the lock protocol and we just POST the AFF JSON.
 */
import * as path from 'node:path';
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { IcfClient } from '../../clients/icf-client.js';
import { CliError } from '../../output/json.js';
import type { ErrorCode } from '../../output/error-codes.js';
import { readNrobJson, localToWire, validateNrobObject } from '../../formats/nrob/json.js';
import { detectChannel, loadChannelProfile, type SystemProfile } from './channel-detect.js';

export interface RunPushNrobOptions {
  transport?: string;
  profile?: SystemProfile;
}

export interface PushNrobResult {
  object: string;
  channel: 'adt' | 'icf';
  fallbackReason?: 'ECC_EHP6_NO_ADT_NROB';
  action: 'updated';
}

async function loadProfile(opts: RunPushNrobOptions): Promise<SystemProfile> {
  if (opts.profile) return opts.profile;
  return await loadChannelProfile();
}

function nameFromFile(file: string): string {
  return path.basename(file).split('.')[0]!.toUpperCase();
}

async function pushAdt(name: string, json: string, transport: string | undefined): Promise<void> {
  const client = await AdtClientWrapper.create();
  try {
    await client.readNrobSource(name);
  } catch {
    throw new CliError(
      'OBJECT_NOT_FOUND',
      `NROB ${name} does not exist; use 'abap create NROB ${name} --file <json>'`,
      {
        object: name,
        nextSteps: [`Re-run with 'abap create NROB ${name} --file <json> --package $TMP --yes'.`],
      },
    );
  }
  const url = `/sap/bc/adt/numberranges/objects/${encodeURIComponent(name)}`;
  const lock = await client.lock(url);
  const handle = lock.LOCK_HANDLE;
  try {
    await client.updateNrobSource(name, json, handle, transport);
  } finally {
    await client.unLock(url, handle).catch(() => undefined);
  }
}

async function pushIcf(name: string, wire: Record<string, unknown>, transport: string | undefined): Promise<void> {
  const icf = await IcfClient.create();
  const head = await icf.getDdic<Record<string, unknown>>('nrob', name);
  if (head.status !== 'success' || !head.data) {
    throw new CliError(
      'OBJECT_NOT_FOUND',
      `NROB ${name} not found in system`,
      {
        object: name,
        type: 'NROB',
        nextSteps: [
          `Create the number range object first: \`abap create NROB ${name} --file <json> --package <pkg> --tr <tr> --yes\``,
        ],
      },
    );
  }
  const resp = await icf.postDdic<unknown>('nrob', { ...wire, ...(transport ? { transport } : {}) });
  if (resp.status !== 'success') {
    const code = (resp.error?.code ?? 'NROB_PUSH_FAILED') as ErrorCode;
    throw new CliError(code, resp.error?.message ?? `Failed to push NROB ${name}`, {
      object: name,
      type: 'NROB',
      details: resp.error?.details,
    });
  }
}

export async function runPushNrob(
  file: string,
  opts: RunPushNrobOptions = {},
): Promise<PushNrobResult> {
  const abs = path.resolve(process.cwd(), file);
  const local = await readNrobJson(abs);
  const errors = await validateNrobObject(local);
  if (errors.length > 0) {
    throw new CliError('AFF_FIXTURE_INVALID', `Invalid NROB file: ${errors.join('; ')}`, {
      file,
      type: 'NROB',
      details: errors,
    });
  }

  // The CLI binds the object name to the filename (`<name>.nrob.json`), so
  // the wire's `numberLengthDomain` should agree with the file basename. If
  // not, fail fast — silent mismatch means a misnamed fixture and would push
  // a half-correct document.
  const name = nameFromFile(file);
  if (local.interval.numberLengthDomain.toUpperCase() !== name) {
    throw new CliError(
      'VALIDATION_ERROR',
      `NROB filename basename (${name}) does not match interval.numberLengthDomain (${local.interval.numberLengthDomain}); rename the file so they agree`,
      {
        file,
        type: 'NROB',
        details: { fileName: name, numberLengthDomain: local.interval.numberLengthDomain },
      },
    );
  }

  const profile = await loadProfile(opts);
  const decision = detectChannel(profile, 'nrob');
  const wire = localToWire(local);
  if (decision.channel === 'adt') {
    await pushAdt(name, JSON.stringify(wire), opts.transport);
    return { object: name, channel: 'adt', action: 'updated' };
  }

  await pushIcf(name, wire, opts.transport);
  return {
    object: name,
    channel: 'icf',
    fallbackReason: decision.fallbackReason as 'ECC_EHP6_NO_ADT_NROB',
    action: 'updated',
  };
}