/**
 * Spec 036 US4: DDLS (CDS view) pull.
 *
 * Three-piece output:
 *   <rootDir>/ddls/<lower>/<lower>.ddls.json   ← AFF nested metadata
 *   <rootDir>/ddls/<lower>/<lower>.ddls.acds   ← CDS source string (plain)
 *
 * Channel-detect runs first; ECC throws DDLS_NOT_SUPPORTED_ON_ECC.
 */
import * as path from 'node:path';
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { CliError } from '../../output/json.js';
import { detectChannel } from './channel-detect.js';
import type { SystemProfile } from './channel-detect.js';
import { wireToLocal, writeDdlsJson, validateDdlsObject, type DdlsLocal } from '../../formats/ddls/json.js';
import { loadConfig, findWorkspaceConfig } from '../../config/project-config.js';
import { folderFor } from '../../formats/type-folder.js';
import * as fs from 'node:fs/promises';

export interface PullDdlsOptions { profile?: SystemProfile; rootDir?: string; type?: string; package?: string; tr?: string; dir?: string; overwrite?: boolean; skipExisting?: boolean; includeTests?: boolean; includeAllParts?: boolean; limit?: string; page?: string; textpool?: boolean; remote?: string }
export interface PullDdlsResult {
  object: string;
  channel: 'adt';
  files: string[];
  doc: DdlsLocal;
  source: string;
}

async function loadProfile(opts: PullDdlsOptions): Promise<SystemProfile> {
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

export async function runPullDdls(name: string, opts: PullDdlsOptions = {}): Promise<PullDdlsResult> {
  const profile = await loadProfile(opts);
  // channel-detect throws DDLS_NOT_SUPPORTED_ON_ECC for old kernels; we do
  // NOT swallow the error here — let it propagate as the spec demands.
  const decision = detectChannel(profile, 'ddls');
  if (decision.channel !== 'adt') {
    throw new CliError('DDLS_NOT_SUPPORTED_ON_ECC', `DDLS on this system is not supported (kernel ${profile.kernelRelease ?? 'unknown'})`, { object: name.toUpperCase() });
  }
  const upper = name.toLowerCase(); // DDLS names are typically lowercase in DDL convention
  const lower = upper;
  const root = await resolveRoot(opts);
  const folder = folderFor('DDLS');
  const dir = path.join(root, folder, lower);
  const jsonPath = path.join(dir, `${lower}.ddls.json`);
  const acdsPath = path.join(dir, `${lower}.ddls.acds`);

  const client = await AdtClientWrapper.create();
  const { xml, source } = await client.getDdls(upper);
  const { doc } = wireToLocal(xml);
  // The wire payload's ddlSourceString carries the body — prefer it; fall back
  // to a heuristic search of the full XML if the source element is empty.
  const finalSource = source || xml;

  const errors = await validateDdlsObject(doc);
  if (errors.length > 0) {
    throw new CliError('AFF_FIXTURE_INVALID', `Pulled DDLS ${upper} failed schema: ${errors.join('; ')}`, {
      object: upper,
      details: errors,
    });
  }
  await writeDdlsJson(jsonPath, doc);
  await fs.writeFile(acdsPath, finalSource, 'utf8');
  return {
    object: upper,
    channel: 'adt',
    files: [jsonPath, acdsPath],
    doc,
    source: finalSource,
  };
}