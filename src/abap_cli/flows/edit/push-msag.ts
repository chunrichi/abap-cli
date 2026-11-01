/**
 * MSAG (message class) push — dual-channel (ADT preferred, ICF fallback on ECC
 * or when the ADT endpoint is not routed on this kernel).
 *
 * ADT writes the message texts through a locked PUT (see `msag-adt.ts`); the
 * ICF fallback POST/PUT is upsert-shaped and takes the local AFF document.
 */
import * as path from 'node:path';
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { IcfClient } from '../../clients/icf-client.js';
import { CliError } from '../../output/json.js';
import { resolveFile } from '../../formats/file-resolver.js';
import { detectChannel, isAdtEndpointUnavailable } from './channel-detect.js';
import type { AdtFallbackReason, SystemProfile } from './channel-detect.js';
import { writeMsagContent } from './msag-adt.js';
import { msagArtifact, localToWire } from '../../formats/msag/json.js';
import { loadConfig } from '../../config/project-config.js';

export interface PushMsagOptions { profile?: SystemProfile; transport?: string }
export interface PushMsagResult {
  object: string;
  channel: 'adt' | 'icf';
  fallbackReason?: 'ECC_EHP6_NO_ADT_MESSAGECLASS' | AdtFallbackReason;
  action: 'updated';
}

async function loadProfile(opts: PushMsagOptions): Promise<SystemProfile> {
  if (opts.profile) return opts.profile;
  const cfg = await loadConfig();
  return { kernelRelease: cfg.systemVersion };
}

function nameFromFile(file: string): string {
  // filename shape: <name>.msag.json — AFF namespace token `(ns)name` → `/NS/NAME`.
  return resolveFile(file).objectName;
}

async function pushAdt(name: string, xml: string, transport: string | undefined): Promise<void> {
  const client = await AdtClientWrapper.create();
  try {
    await client.getMsag(name);
  } catch (error) {
    // A missing ADT endpoint is not "object does not exist" — let the caller
    // fall back to ICF instead of masking the routing failure.
    if (isAdtEndpointUnavailable(error)) throw error;
    throw new CliError('OBJECT_NOT_FOUND', `MSAG ${name} does not exist; use 'abap create MSAG ${name} --file <json>'`, {
      object: name,
      nextSteps: ["Re-run with 'abap create MSAG <name> --file <json> --package $TMP'."],
    });
  }
  await writeMsagContent(client, name, xml, transport);
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
  const doc = await msagArtifact.read(path.resolve(process.cwd(), file));
  const errors = await msagArtifact.validate(doc);
  if (errors.length > 0) {
    throw new CliError('AFF_FIXTURE_INVALID', `MSAG file ${file} failed schema validation: ${errors.join('; ')}`, {
      file,
      details: errors,
    });
  }
  const wire = localToWire(doc, name);
  let channel: 'adt' | 'icf' = decision.channel;
  let fallbackReason: PushMsagResult['fallbackReason'];
  if (decision.channel === 'adt') {
    try {
      await pushAdt(name, wire, opts.transport);
    } catch (error) {
      if (!isAdtEndpointUnavailable(error)) throw error;
      channel = 'icf';
      fallbackReason = 'ADT_ENDPOINT_UNAVAILABLE';
      await pushIcf(name, doc, opts.transport);
    }
  } else {
    fallbackReason = decision.fallbackReason as 'ECC_EHP6_NO_ADT_MESSAGECLASS';
    await pushIcf(name, doc, opts.transport);
  }
  return {
    object: name,
    channel,
    ...(fallbackReason ? { fallbackReason } : {}),
    action: 'updated',
  };
}
