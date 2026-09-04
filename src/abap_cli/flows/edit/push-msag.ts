/**
 * Spec 036 US3 + spec 035: MSAG push.
 */
import * as path from 'node:path';
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { IcfClient } from '../../clients/icf-client.js';
import { CliError } from '../../output/json.js';
import { detectChannel } from './channel-detect.js';
import type { SystemProfile } from './channel-detect.js';
import { readMsagJson, localToWire, validateMsagObject } from '../../formats/msag/json.js';
import { loadConfig } from '../../config/project-config.js';

export interface PushMsagOptions { profile?: SystemProfile; transport?: string }
export interface PushMsagResult {
  object: string;
  channel: 'adt' | 'icf';
  fallbackReason?: 'ECC_EHP6_NO_ADT_MESSAGECLASS';
  action: 'updated';
}

async function loadProfile(opts: PushMsagOptions): Promise<SystemProfile> {
  if (opts.profile) return opts.profile;
  const cfg = await loadConfig();
  return { kernelRelease: cfg.systemVersion };
}

function nameFromFile(file: string): string {
  return path.basename(file).split('.')[0]!.toUpperCase();
}

async function pushAdt(name: string, xml: string, transport: string | undefined): Promise<void> {
  const client = await AdtClientWrapper.create();
  try {
    await client.getMsag(name);
  } catch {
    throw new CliError('OBJECT_NOT_FOUND', `MSAG ${name} does not exist; use 'abap create MSAG ${name} --file <json>'`, {
      object: name,
      nextSteps: ["Re-run with 'abap create MSAG <name> --file <json> --package $TMP'."],
    });
  }
  const url = `/sap/bc/adt/messageclass/${name}`;
  const lock = await client.lock(url);
  const handle = lock.LOCK_HANDLE;
  try {
    await client.updateMsag(name, xml, handle, transport);
  } finally {
    await client.unLock(url, handle).catch(() => undefined);
  }
}

async function pushIcf(name: string, doc: object, transport: string | undefined): Promise<void> {
  const icf = await IcfClient.create();
  const resp = await icf.put(`/ddic/msag/${encodeURIComponent(name)}`, { main: doc, ...(transport ? { transport } : {}) });
  if (resp.status !== 'success') {
    // Pass the ICF handler's own code through (LOCK_FAILED, VALIDATION_ERROR, …).
    const code = resp.error?.code ?? 'DDIC_CREATE_FAILED';
    throw new CliError(code as never, resp.error?.message ?? 'ICF MSAG push failed', {
      object: name,
      channel: 'icf',
      details: resp.error?.details,
    });
  }
}

export async function runPushMsag(file: string, opts: PushMsagOptions = {}): Promise<PushMsagResult> {
  const profile = await loadProfile(opts);
  const decision = detectChannel(profile, 'msag');
  const name = nameFromFile(file);
  const doc = await readMsagJson(path.resolve(process.cwd(), file));
  const errors = await validateMsagObject(doc);
  if (errors.length > 0) {
    throw new CliError('AFF_FIXTURE_INVALID', `MSAG file ${file} failed schema validation: ${errors.join('; ')}`, {
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
  return {
    object: name,
    channel: decision.channel,
    ...(decision.channel === 'icf' ? { fallbackReason: decision.fallbackReason as 'ECC_EHP6_NO_ADT_MESSAGECLASS' } : {}),
    action: 'updated',
  };
}