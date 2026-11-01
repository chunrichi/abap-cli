/**
 * MSAG (message class) pull.
 *
 * Flow:
 *   1. channel-detect → ADT (EHP7+) or ICF (EHP5/6); a modern kernel whose
 *      ADT endpoint is not routed falls back to ICF at runtime.
 *   2. ADT EMF XML → local AFF mapping.
 *   3. Schema-validate against `msag-v1.json`.
 *   4. Write `src/<lower>.msag.json`.
 */
import * as path from 'node:path';
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { IcfClient } from '../../clients/icf-client.js';
import { CliError } from '../../output/json.js';
import { detectChannel, isAdtEndpointUnavailable } from './channel-detect.js';
import type { AdtFallbackReason, SystemProfile } from './channel-detect.js';
import { msagArtifact, wireToLocal, type MsagLocal } from '../../formats/msag/json.js';
import { affObjectToken } from '../../formats/file-resolver.js';
import { loadConfig, findWorkspaceConfig } from '../../config/project-config.js';
import type { PullHandler } from './routing.js';

export interface PullMsagOptions { profile?: SystemProfile; rootDir?: string; type?: string; package?: string; tr?: string; dir?: string; overwrite?: boolean; skipExisting?: boolean; includeTests?: boolean; includeAllParts?: boolean; limit?: string; page?: string; textpool?: boolean; remote?: string }
export interface PullMsagResult {
  object: string;
  channel: 'adt' | 'icf';
  fallbackReason?: 'ECC_EHP6_NO_ADT_MESSAGECLASS' | AdtFallbackReason;
  files: string[];
  doc: MsagLocal;
}

async function loadProfile(opts: PullMsagOptions): Promise<SystemProfile> {
  if (opts.profile) return opts.profile;
  const cfg = await loadConfig();
  return { kernelRelease: cfg.systemVersion };
}

async function resolveRoot(opts: { rootDir?: string; dir?: string }): Promise<string> {
  if (opts.rootDir) return path.resolve(opts.rootDir);
  if (opts.dir) return path.resolve(opts.dir);
  const ws = findWorkspaceConfig();
  return ws ? path.dirname(ws) : process.cwd();
}

async function pullAdt(name: string): Promise<MsagLocal> {
  const client = await AdtClientWrapper.create();
  const xml = await client.getMsag(name);
  return wireToLocal(xml);
}

async function pullIcf(name: string): Promise<MsagLocal> {
  const icf = await IcfClient.create();
  const resp = await icf.get(`/ddic/msag/${encodeURIComponent(name)}`);
  if (resp.status !== 'success' || !resp.data) {
    throw new CliError(
      (resp.error?.code === 'NOT_FOUND' ? 'OBJECT_NOT_FOUND' : 'DDIC_OBJECT_NOT_FOUND') as never,
      resp.error?.message ?? `MSAG ${name} not found`,
      { object: name.toUpperCase() },
    );
  }
  return (resp.data as { main: MsagLocal }).main;
}

export async function runPullMsag(name: string, opts: PullMsagOptions = {}): Promise<PullMsagResult> {
  const profile = await loadProfile(opts);
  const decision = detectChannel(profile, 'msag');
  const upper = name.toUpperCase();
  const lower = name.toLowerCase();
  const root = await resolveRoot(opts);
  const jsonPath = path.join(root, `${affObjectToken(name)}.msag.json`);

  let doc: MsagLocal;
  let channel: 'adt' | 'icf' = decision.channel;
  let fallbackReason: PullMsagResult['fallbackReason'];
  if (decision.channel === 'adt') {
    try {
      doc = await pullAdt(upper);
    } catch (error) {
      if (isAdtEndpointUnavailable(error)) {
        channel = 'icf';
        fallbackReason = 'ADT_ENDPOINT_UNAVAILABLE';
        doc = await pullIcf(upper);
      } else if (error instanceof CliError && (error.details?.httpStatus === 404 || error.code === 'OBJECT_NOT_FOUND')) {
        // The ADT resource answers 404 for a missing message class; map it onto
        // the channel-independent not-found contract (`abap pull` docs).
        throw new CliError('OBJECT_NOT_FOUND', `MSAG ${upper} not found`, { object: upper });
      } else {
        throw error;
      }
    }
  } else {
    fallbackReason = decision.fallbackReason as 'ECC_EHP6_NO_ADT_MESSAGECLASS';
    doc = await pullIcf(upper);
  }

  const errors = await msagArtifact.validate(doc);
  if (errors.length > 0) {
    throw new CliError('AFF_FIXTURE_INVALID', `Pulled MSAG ${upper} failed schema: ${errors.join('; ')}`, {
      object: upper,
      details: errors,
    });
  }
  await msagArtifact.write(jsonPath, doc);
  return {
    object: upper,
    channel,
    ...(fallbackReason ? { fallbackReason } : {}),
    files: [jsonPath],
    doc,
  };
}

export const pullMsagHandler: PullHandler = async ({ objectName, opts }) => {
  const r = await runPullMsag(objectName, opts as Parameters<typeof runPullMsag>[1]);
  return { object: r.object, files: r.files, channel: r.channel, ...(r.fallbackReason ? { fallbackReason: r.fallbackReason } : {}) };
};