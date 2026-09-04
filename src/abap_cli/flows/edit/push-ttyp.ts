/**
 * Spec 036 US2 + spec 035: TTYP push flow.
 *
 * Pushes a `*.ttyp.json` document back to SAP. Flow:
 *   1. detectChannel() picks ADT or ICF.
 *   2. Validate the local doc against `ttyp-v1.json` (handcrafted).
 *   3. ADT: PUT `/sap/bc/adt/ddic/tabletypes/<name>` (lock-first).
 *      ICF: POST `/sap/zabap_vibe/ddic/ttyp/<name>`.
 *   4. Spec 035: missing object → OBJECT_NOT_FOUND; user must re-run as create.
 */
import * as path from 'node:path';
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { IcfClient } from '../../clients/icf-client.js';
import { CliError } from '../../output/json.js';
import { detectChannel } from './channel-detect.js';
import type { SystemProfile } from './channel-detect.js';
import {
  readTtypJson,
  localToWire,
  validateTtypObject,
} from '../../formats/ttyp/json.js';
import { loadConfig } from '../../config/project-config.js';

export interface PushTtypOptions {
  profile?: SystemProfile;
  transport?: string;
}

export interface PushTtypResult {
  object: string;
  channel: 'adt' | 'icf';
  fallbackReason?: 'ECC_EHP6_NO_ADT_TABLETYPE';
  action: 'updated' | 'created';
}

async function loadProfile(opts: PushTtypOptions): Promise<SystemProfile> {
  if (opts.profile) return opts.profile;
  const cfg = await loadConfig();
  return { kernelRelease: cfg.systemVersion };
}

function deriveNameFromPath(file: string): string {
  const base = path.basename(file);
  // filename shape: <name>.ttyp.json
  return base.split('.')[0]!.toUpperCase();
}

async function pushAdt(name: string, xml: string, transport: string | undefined): Promise<void> {
  const client = await AdtClientWrapper.create();
  // 035: detect existence first; missing → OBJECT_NOT_FOUND.
  try {
    await client.getTtyp(name);
  } catch {
    throw new CliError('OBJECT_NOT_FOUND', `TTYP ${name} does not exist; use 'abap create TTYP ${name} --file <json>' instead`, {
      object: name,
      nextSteps: ["Re-run with 'abap create TTYP <name> --file <json> --package $TMP'."],
    });
  }
  const url = `/sap/bc/adt/ddic/tabletypes/${name}`;
  const lock = await client.lock(url);
  const handle = lock.LOCK_HANDLE;
  try {
    await client.updateTtyp(name, xml, handle, transport);
  } finally {
    await client.unLock(url, handle).catch(() => undefined);
  }
}

async function pushIcf(name: string, doc: object, transport: string | undefined): Promise<void> {
  const icf = await IcfClient.create();
  const resp = await icf.put(`/ddic/ttyp/${encodeURIComponent(name)}`, { main: doc, ...(transport ? { transport } : {}) });
  if (resp.status !== 'success') {
    // The ICF handler already speaks our error vocabulary (LOCK_FAILED,
    // VALIDATION_ERROR, …); pass its code through instead of flattening it.
    const code = resp.error?.code ?? 'DDIC_CREATE_FAILED';
    throw new CliError(code as never, resp.error?.message ?? 'ICF TTYP push failed', {
      object: name,
      channel: 'icf',
      details: resp.error?.details,
    });
  }
}

export async function runPushTtyp(file: string, opts: PushTtypOptions = {}): Promise<PushTtypResult> {
  const profile = await loadProfile(opts);
  const decision = detectChannel(profile, 'ttyp');
  const name = deriveNameFromPath(file);

  const doc = await readTtypJson(path.resolve(process.cwd(), file));
  const errors = await validateTtypObject(doc);
  if (errors.length > 0) {
    throw new CliError('AFF_FIXTURE_INVALID', `TTYP file ${file} failed schema validation: ${errors.join('; ')}`, {
      file,
      details: errors,
    });
  }
  const wire = localToWire(doc);
  if (decision.channel === 'adt') {
    await pushAdt(name, wire, opts.transport);
  } else {
    await pushIcf(name, doc, opts.transport);
  }
  // Surface folder/transport for the human summary even though we don't write.
  return {
    object: name,
    channel: decision.channel,
    ...(decision.channel === 'icf' ? { fallbackReason: decision.fallbackReason as 'ECC_EHP6_NO_ADT_TABLETYPE' } : {}),
    action: 'updated',
  };
}