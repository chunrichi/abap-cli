/**
 * Spec 036 US2 / US5: TTYP pull flow.
 *
 * Coordinates:
 *   1. `detectChannel` — picks ADT (EHP7+) or ICF fallback (EHP5/6).
 *   2. Reads the wire body via the chosen transport.
 *   3. Maps wire → local AFF nested shape.
 *   4. Writes `*.ttyp.json` to `<rootDir>/<folder>/<lower>/<lower>.ttyp.json`.
 *   5. Writes the optional sidecar `*.type.abap` (DDL `define type ...: ...`).
 *
 * Spec 035 push semantics: pull never auto-creates; if the object is missing
 * on the ADT path we surface OBJECT_NOT_FOUND so the agent can route to
 * `create`.
 */
import * as path from 'node:path';
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { IcfClient } from '../../clients/icf-client.js';
import { CliError } from '../../output/json.js';
import { detectChannel } from './channel-detect.js';
import type { SystemProfile } from './channel-detect.js';
import {
  wireToLocal,
  writeTtypJson,
  buildTypeSource,
  validateTtypObject,
  type TtypLocal,
} from '../../formats/ttyp/json.js';
import { loadConfig, findWorkspaceConfig } from '../../config/project-config.js';
import { folderFor } from '../../formats/type-folder.js';

export interface PullTtypOptions {
  /** Optional profile override (default: active profile). */
  profile?: SystemProfile;
  /** Override the rootDir for file writes (defaults to workspace). */
  rootDir?: string;
  /** Skip the type.abap sidecar when true. */
  skipTypeAbap?: boolean;
  // Unused / forward-compat fields carried by the PullOptions shape.
  type?: string;
  package?: string;
  tr?: string;
  dir?: string;
  overwrite?: boolean;
  skipExisting?: boolean;
  includeTests?: boolean;
  includeAllParts?: boolean;
  limit?: string;
  page?: string;
  textpool?: boolean;
  remote?: string;
}

export interface PullTtypResult {
  object: string;
  channel: 'adt' | 'icf';
  fallbackReason?: 'ECC_EHP6_NO_ADT_TABLETYPE' | 'ECC_EHP6_NO_ADT_MESSAGECLASS';
  files: string[];
  doc: TtypLocal;
}

/** Resolve the workspace root (or the explicit override) into an absolute path.
 *  Accepts both `rootDir` (canonical PullTtypOptions shape) and `dir` (the
 *  shared PullOptions shape that comes in via the coordinator). */
async function resolveRoot(opts: { rootDir?: string; dir?: string }): Promise<string> {
  if (opts.rootDir) return path.resolve(opts.rootDir);
  if (opts.dir) return path.resolve(opts.dir);
  const ws = findWorkspaceConfig();
  if (!ws) {
    // No .abap.json → default to cwd. Tests / ad-hoc invocations pass rootDir.
    return process.cwd();
  }
  return path.dirname(ws);
}

/**
 * Channel-detect lives in `channel-detect.ts` but expects a `SystemProfile`
 * shape with `kernelRelease` / `ddlsSupported`; the workspace config carries
 * `systemVersion` instead. Adapter maps the two — placeholder until
 * `profile test` writes the canonical fields.
 */
async function profileFromWorkspace(opts: PullTtypOptions): Promise<SystemProfile> {
  if (opts.profile) return opts.profile;
  const cfg = await loadConfig();
  return { kernelRelease: cfg.systemVersion };
}

async function pullFromAdt(name: string): Promise<TtypLocal> {
  const client = await AdtClientWrapper.create();
  const xml = await client.getTtyp(name);
  return wireToLocal(name.toUpperCase(), xml);
}

async function pullFromIcf(name: string): Promise<TtypLocal> {
  const icf = await IcfClient.create();
  const resp = await icf.get(`/ddic/ttyp/${encodeURIComponent(name.toUpperCase())}`);
  if (resp.status !== 'success' || !resp.data) {
    const code = resp.error?.code === 'NOT_FOUND' ? 'OBJECT_NOT_FOUND' : 'DDIC_OBJECT_NOT_FOUND';
    throw new CliError(code as never, resp.error?.message ?? `TTYP ${name} not found`, {
      object: name.toUpperCase(),
      channel: 'icf',
    });
  }
  const data = resp.data as { main: TtypLocal; typeSource?: string };
  return data.main;
}

/** Public entry — single TTYP pull with channel-detect + dual-write output. */
export async function runPullTtyp(name: string, opts: PullTtypOptions = {}): Promise<PullTtypResult> {
  const profile = await profileFromWorkspace(opts);
  const decision = detectChannel(profile, 'ttyp');
  const upper = name.toUpperCase();
  const lower = name.toLowerCase();
  const root = await resolveRoot(opts);
  const folder = folderFor('TTYP');
  const dir = path.join(root, folder, lower);
  const jsonPath = path.join(dir, `${lower}.ttyp.json`);
  const abapPath = path.join(dir, `${lower}.type.abap`);

  let doc: TtypLocal;
  let fallbackReason: 'ECC_EHP6_NO_ADT_TABLETYPE' | undefined;
  if (decision.channel === 'adt') {
    doc = await pullFromAdt(upper);
  } else {
    fallbackReason = decision.fallbackReason as 'ECC_EHP6_NO_ADT_TABLETYPE';
    doc = await pullFromIcf(upper);
  }

  const errors = await validateTtypObject(doc);
  if (errors.length > 0) {
    throw new CliError('AFF_FIXTURE_INVALID', `Pulled TTYP ${upper} failed AFF schema validation: ${errors.join('; ')}`, {
      object: upper,
      details: errors,
    });
  }

  const written: string[] = [jsonPath];
  await writeTtypJson(jsonPath, doc);
  if (!opts.skipTypeAbap) {
    const source = buildTypeSource(lower, doc);
    await import('node:fs/promises').then((m) => m.writeFile(abapPath, source, 'utf8'));
    written.push(abapPath);
  }

  return {
    object: upper,
    channel: decision.channel,
    ...(fallbackReason ? { fallbackReason } : {}),
    files: written,
    doc,
  };
}