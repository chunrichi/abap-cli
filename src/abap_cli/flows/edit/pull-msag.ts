/**
 * Spec 036 US3: MSAG (message class) pull.
 *
 * Flow:
 *   1. channel-detect → ADT (EHP7+) or ICF (EHP5/6).
 *   2. Wire → local AFF mapping.
 *   3. Schema-validate against `msag-v1.json`.
 *   4. Write `src/msag/<lower>/<lower>.msag.json`.
 */
import * as path from 'node:path';
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { IcfClient } from '../../clients/icf-client.js';
import { CliError } from '../../output/json.js';
import { detectChannel } from './channel-detect.js';
import type { SystemProfile } from './channel-detect.js';
import { wireToLocal, writeMsagJson, validateMsagObject, type MsagLocal } from '../../formats/msag/json.js';
import { loadConfig, findWorkspaceConfig } from '../../config/project-config.js';
import { folderFor } from '../../formats/type-folder.js';

export interface PullMsagOptions { profile?: SystemProfile; rootDir?: string; type?: string; package?: string; tr?: string; dir?: string; overwrite?: boolean; skipExisting?: boolean; includeTests?: boolean; includeAllParts?: boolean; limit?: string; page?: string; textpool?: boolean; remote?: string }
export interface PullMsagResult {
  object: string;
  channel: 'adt' | 'icf';
  fallbackReason?: 'ECC_EHP6_NO_ADT_MESSAGECLASS';
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
  const folder = folderFor('MSAG');
  const dir = path.join(root, folder, lower);
  const jsonPath = path.join(dir, `${lower}.msag.json`);

  let doc: MsagLocal;
  let fallbackReason: 'ECC_EHP6_NO_ADT_MESSAGECLASS' | undefined;
  if (decision.channel === 'adt') {
    doc = await pullAdt(upper);
  } else {
    fallbackReason = decision.fallbackReason as 'ECC_EHP6_NO_ADT_MESSAGECLASS';
    doc = await pullIcf(upper);
  }

  const errors = await validateMsagObject(doc);
  if (errors.length > 0) {
    throw new CliError('AFF_FIXTURE_INVALID', `Pulled MSAG ${upper} failed schema: ${errors.join('; ')}`, {
      object: upper,
      details: errors,
    });
  }
  await writeMsagJson(jsonPath, doc);
  return {
    object: upper,
    channel: decision.channel,
    ...(fallbackReason ? { fallbackReason } : {}),
    files: [jsonPath],
    doc,
  };
}