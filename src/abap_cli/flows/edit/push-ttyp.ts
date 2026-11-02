/**
 * TTYP push flow — dual-channel (ADT preferred, ICF fallback on ECC or when the
 * ADT endpoint is not routed on this kernel).
 *
 * Flow:
 *   1. detectChannel() picks ADT or ICF.
 *   2. Validate the local doc against `ttyp-v1.json` (handcrafted).
 *   3. ADT: existence check, then lock → PUT (vendor media type) → unlock →
 *      activate (`ttyp-adt.ts`).
 *   4. ICF: PUT `/sap/abap_cli/ddic/ttyp/<name>`.
 * Missing object → OBJECT_NOT_FOUND; the user must re-run as create.
 */
import * as path from 'node:path';
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { IcfClient } from '../../clients/icf-client.js';
import { CliError } from '../../output/json.js';
import { resolveFile } from '../../formats/file-resolver.js';
import { detectChannel, isAdtEndpointUnavailable } from './channel-detect.js';
import type { AdtFallbackReason, SystemProfile } from './channel-detect.js';
import { writeTtypContent } from './ttyp-adt.js';
import { ttypArtifact, localToWire } from '../../formats/ttyp/json.js';
import { loadConfig } from '../../config/project-config.js';

export interface PushTtypOptions {
  profile?: SystemProfile;
  transport?: string;
}

export interface PushTtypResult {
  object: string;
  channel: 'adt' | 'icf';
  fallbackReason?: 'ECC_EHP6_NO_ADT_TABLETYPE' | AdtFallbackReason;
  action: 'updated' | 'created';
}

async function loadProfile(opts: PushTtypOptions): Promise<SystemProfile> {
  if (opts.profile) return opts.profile;
  const cfg = await loadConfig();
  return { kernelRelease: cfg.systemVersion };
}

function deriveNameFromPath(file: string): string {
  // filename shape: <name>.ttyp.json — resolveFile restores the AFF
  // namespace token `(ns)name` back to `/NS/NAME`.
  return resolveFile(file).objectName;
}

async function pushAdt(
  client: AdtClientWrapper,
  name: string,
  body: string,
  transport: string | undefined,
): Promise<void> {
  // detect existence first; a missing object is a create, not an update.
  try {
    await client.getTtyp(name);
  } catch (error) {
    // A missing ADT endpoint is not "object does not exist" — let the caller
    // fall back to ICF instead of masking the routing failure.
    if (isAdtEndpointUnavailable(error)) throw error;
    if (error instanceof CliError && (error.details?.httpStatus === 404 || error.code === 'OBJECT_NOT_FOUND')) {
      throw new CliError('OBJECT_NOT_FOUND', `TTYP ${name} does not exist; use 'abap create TTYP ${name} --file <json>' instead`, {
        object: name,
        nextSteps: ["Re-run with 'abap create TTYP <name> --file <json> --package $TMP'."],
      });
    }
    throw error;
  }
  await writeTtypContent(client, name, body, transport);
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

  const doc = await ttypArtifact.read(path.resolve(process.cwd(), file));
  const errors = await ttypArtifact.validate(doc);
  if (errors.length > 0) {
    throw new CliError('AFF_FIXTURE_INVALID', `TTYP file ${file} failed schema validation: ${errors.join('; ')}`, {
      file,
      details: errors,
    });
  }
  if (doc.lineType.rowStructure) {
    throw new CliError(
      'TTYP_ROW_STRUCTURE_UNSUPPORTED',
      'TTYP lineType.rowStructure is not supported: a DDIC table type needs a repository row type (data element / structure / table / table type), and an inline row structure has no ADT or ICF representation',
      {
        file,
        object: name,
        type: 'TTYP',
        nextSteps: [
          'Maintain the inline row structure in SE11 / ADT, or create a structure and reference it from lineType.rowType.',
          'Replace lineType.rowStructure with lineType.rowType naming a repository type.',
        ],
      },
    );
  }
  let channel: 'adt' | 'icf' = decision.channel;
  let fallbackReason: PushTtypResult['fallbackReason'];
  if (decision.channel === 'adt') {
    try {
      const client = await AdtClientWrapper.create();
      // ADT only persists the DDIC description when the body language equals
      // the logon language, so the wire always speaks the profile language.
      const body = localToWire(doc, name, { language: client.getConfig().sap.language });
      await pushAdt(client, name, body, opts.transport);
    } catch (error) {
      if (!isAdtEndpointUnavailable(error)) throw error;
      channel = 'icf';
      fallbackReason = 'ADT_ENDPOINT_UNAVAILABLE';
      await pushIcf(name, doc, opts.transport);
    }
  } else {
    fallbackReason = decision.fallbackReason as 'ECC_EHP6_NO_ADT_TABLETYPE';
    await pushIcf(name, doc, opts.transport);
  }
  return {
    object: name,
    channel,
    ...(fallbackReason ? { fallbackReason } : {}),
    action: 'updated',
  };
}
