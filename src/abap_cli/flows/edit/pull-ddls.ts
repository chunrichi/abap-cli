/**
 * DDLS (CDS view) pull.
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
import { ddlsArtifact, wireToLocal, type DdlsLocal } from '../../formats/ddls/json.js';
import { affObjectToken } from '../../formats/file-resolver.js';
import { loadConfig, findWorkspaceConfig } from '../../config/project-config.js';
import type { PullHandler } from './routing.js';
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
  const token = affObjectToken(name);
  const jsonPath = path.join(root, `${token}.ddls.json`);
  const acdsPath = path.join(root, `${token}.ddls.acds`);

  const client = await AdtClientWrapper.create();
  let meta: { xml: string; source: string };
  try {
    meta = await client.getDdls(upper);
  } catch (error) {
    // The ADT resource answers 404 for a missing DDL source; map it onto the
    // channel-independent not-found contract (`abap pull` docs).
    if (error instanceof CliError && (error.details?.httpStatus === 404 || error.code === 'OBJECT_NOT_FOUND')) {
      throw new CliError('OBJECT_NOT_FOUND', `DDLS ${upper} not found`, { object: upper });
    }
    throw error;
  }
  const { xml, source } = meta;
  const { doc } = wireToLocal(xml, source);
  // The source is a separate `source/main` resource; keep the metadata XML as
  // the last-resort body so a failed secondary fetch never writes an empty file.
  const finalSource = source || xml;

  const errors = await ddlsArtifact.validate(doc);
  if (errors.length > 0) {
    throw new CliError('AFF_FIXTURE_INVALID', `Pulled DDLS ${upper} failed schema: ${errors.join('; ')}`, {
      object: upper,
      details: errors,
    });
  }
  await ddlsArtifact.write(jsonPath, doc);
  await fs.writeFile(acdsPath, finalSource, 'utf8');
  return {
    object: upper,
    channel: 'adt',
    files: [jsonPath, acdsPath],
    doc,
    source: finalSource,
  };
}

export const pullDdlsHandler: PullHandler = async ({ objectName, opts }) => {
  const r = await runPullDdls(objectName, opts as Parameters<typeof runPullDdls>[1]);
  return { object: r.object, files: r.files, channel: r.channel };
};