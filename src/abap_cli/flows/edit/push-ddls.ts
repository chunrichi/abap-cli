/**
 * Spec 036 US4 + spec 035: DDLS push.
 *
 * Cross-validates the `.ddls.json` sourceType field against the .acds top
 * line (`define view entity ...` etc.). Mismatch → VALIDATION_ERROR.
 *
 * DDLS has no ICF fallback. ECC kernels raise `DDLS_NOT_SUPPORTED_ON_ECC`
 * from channel-detect.
 */
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { CliError } from '../../output/json.js';
import { detectChannel } from './channel-detect.js';
import type { SystemProfile } from './channel-detect.js';
import { readDdlsJson, localToWire, validateDdlsObject } from '../../formats/ddls/json.js';
import { parseAcds } from '../../formats/ddls/acds.js';
import { loadConfig } from '../../config/project-config.js';

export interface PushDdlsOptions { profile?: SystemProfile; transport?: string }
export interface PushDdlsResult {
  object: string;
  channel: 'adt';
  action: 'updated';
}

async function loadProfile(opts: PushDdlsOptions): Promise<SystemProfile> {
  if (opts.profile) return opts.profile;
  const cfg = await loadConfig();
  return { kernelRelease: cfg.systemVersion };
}

function nameFromFile(file: string): string {
  return path.basename(file).split('.')[0]!.toUpperCase();
}

export async function runPushDdls(file: string, opts: PushDdlsOptions = {}): Promise<PushDdlsResult> {
  const profile = await loadProfile(opts);
  // channel-detect throws DDLS_NOT_SUPPORTED_ON_ECC on bad kernels.
  const decision = detectChannel(profile, 'ddls');
  if (decision.channel !== 'adt') {
    throw new CliError('DDLS_NOT_SUPPORTED_ON_ECC', `DDLS on this system is not supported (kernel ${profile.kernelRelease ?? 'unknown'})`, { object: nameFromFile(file) });
  }
  const name = nameFromFile(file);
  const basePath = path.resolve(process.cwd(), file).replace(/\.ddls\.json$/, '');
  const acdsPath = `${basePath}.ddls.acds`;
  const doc = await readDdlsJson(path.resolve(process.cwd(), file));
  let source = '';
  try {
    source = await fs.readFile(acdsPath, 'utf8');
  } catch {
    throw new CliError('VALIDATION_ERROR', `DDLS companion file missing: ${acdsPath}`, {
      file: acdsPath,
      nextSteps: ['Run `abap pull <name> --type DDLS` to regenerate the three-piece layout.'],
    });
  }
  const shape = parseAcds(source);
  if (shape.sourceType !== doc.sourceType) {
    throw new CliError('VALIDATION_ERROR', `DDLS sourceType mismatch: json says "${doc.sourceType}" but .acds defines "${shape.sourceType}"`, {
      file,
      details: { jsonSourceType: doc.sourceType, acdsSourceType: shape.sourceType },
    });
  }
  const errors = await validateDdlsObject(doc);
  if (errors.length > 0) {
    throw new CliError('AFF_FIXTURE_INVALID', `DDLS file ${file} failed schema validation: ${errors.join('; ')}`, {
      file,
      details: errors,
    });
  }
  const wire = localToWire(doc, source);
  const client = await AdtClientWrapper.create();
  try {
    await client.getDdls(name);
  } catch {
    throw new CliError('OBJECT_NOT_FOUND', `DDLS ${name} does not exist; use 'abap create DDLS ${name} --file <json>'`, {
      object: name,
      nextSteps: [`Re-run with 'abap create DDLS <name> --file ${file} --package $TMP'.`],
    });
  }
  const url = `/sap/bc/adt/ddic/ddl/sources/${name}`;
  const lock = await client.lock(url);
  const handle = lock.LOCK_HANDLE;
  try {
    await client.updateDdls(name, wire, handle, opts.transport);
  } finally {
    await client.unLock(url, handle).catch(() => undefined);
  }
  return { object: name, channel: 'adt', action: 'updated' };
}