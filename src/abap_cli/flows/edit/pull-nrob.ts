/**
 * PR5 (B1): NROB (number range object) pull flow.
 *
 * NROB is an ADT-managed repository object (`/sap/bc/adt/numberranges/objects`)
 * whose *source is the abap-file-format `nrob-v1.json` document* — the system
 * exposes the same schema at `numberranges/objects/$schema`. So the primary
 * read path is a plain ADT source read and no system-side format helper is
 * involved (unlike TABL/DOMA/DTEL, which are ICF-only).
 *
 * The ADT collection is read-only on NW 7.93 / S/4HANA (2026-09-16 real-SAP
 * probe — see commits bb058bb / tmp/handoff/202609170032-...), so this ADT
 * primary / ICF fallback pair is **only** used for reads. Create / push stays
 * on the bundled ICF `/ddic/nrob` route, which writes the classic TNRO /
 * TNROT tables (see flows/edit/{create,push}-nrob.ts and zcl_abap_vibe_icf
 * .clas.implementations.abap#create_ddic_nrob).
 *
 * Not every release exposes the ADT endpoint, so when the ADT read does not
 * yield a usable document we fall back to the ICF `/ddic/nrob/<name>` route.
 * The fallback reason is hardcoded here (was previously also mirrored in the
 * registry's `channel.fallbackReason` field, which had no consumer and was
 * dropped on 2026-09-17).
 */
import * as path from 'node:path';
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { IcfClient } from '../../clients/icf-client.js';
import { CliError } from '../../output/json.js';
import type { ErrorCode } from '../../output/error-codes.js';
import { buildFilename } from '../../formats/file-resolver.js';
import { folderFor } from '../../formats/type-folder.js';
import { wireToLocal, writeNrobJson, validateNrobObject } from '../../formats/nrob/json.js';
import { toOutputPath } from '../../core/path-output.js';
import { type PullOptions } from './pull-shared.js';
import { registerPullHandler } from '../../types/registry.js';

/** Read the AFF document via ADT, or null when unavailable. */
async function readViaAdt(name: string): Promise<Record<string, unknown> | null> {
  try {
    const client = await AdtClientWrapper.create();
    const body = await client.readNrobSource(name);
    const parsed = JSON.parse(body) as Record<string, unknown>;
    return parsed && typeof parsed === 'object' && 'interval' in parsed ? parsed : null;
  } catch {
    return null;
  }
}

/** Read the wire document via the ICF `/ddic/nrob/<name>` route. Throws when absent. */
async function readViaIcf(name: string): Promise<Record<string, unknown>> {
  const icf = await IcfClient.create();
  const resp = await icf.getDdic<Record<string, unknown>>('nrob', name);
  if (resp.status !== 'success' || !resp.data) {
    const rawCode = resp.error?.code ?? 'SAP_ERROR';
    const code: ErrorCode = rawCode === 'DDIC_OBJECT_NOT_FOUND' ? 'OBJECT_NOT_FOUND' : (rawCode as ErrorCode);
    throw new CliError(code, resp.error?.message ?? `Failed to pull NROB ${name}`, {
      object: name,
      type: 'NROB',
      nextSteps: [
        'Verify the object exists in the target system.',
        'Run `abap search <name>` to confirm the object name and type.',
      ],
    });
  }
  return resp.data;
}

interface PullNrobOptions { dir?: string; overwrite?: boolean; skipExisting?: boolean }

export async function runPullNrob(name: string, opts: PullNrobOptions = {}): Promise<{
  object: string;
  channel: 'adt' | 'icf';
  fallbackReason?: 'ECC_EHP6_NO_ADT_NROB';
  files: string[];
}> {
  const upper = name.trim().toUpperCase();
  const dir = opts.dir ?? '.';
  const filename = buildFilename(upper, 'NROB', 'main', '.json');
  const relPath = path.join(dir, folderFor('NROB'), filename);
  const targetPath = path.resolve(process.cwd(), relPath);

  let channel: 'adt' | 'icf' = 'adt';
  let fallbackReason: 'ECC_EHP6_NO_ADT_NROB' | undefined;
  let wire = await readViaAdt(upper);
  if (wire === null) {
    channel = 'icf';
    fallbackReason = 'ECC_EHP6_NO_ADT_NROB';
    wire = await readViaIcf(upper);
  }

  const local = wireToLocal(wire);
  const errors = await validateNrobObject(local);
  if (errors.length > 0) {
    throw new CliError('AFF_FIXTURE_INVALID', `Pulled NROB ${upper} failed schema: ${errors.join('; ')}`, {
      object: upper,
      details: errors,
    });
  }

  await writeNrobJson(targetPath, local);
  const outPath = toOutputPath(relPath);
  return {
    object: upper,
    channel,
    ...(fallbackReason ? { fallbackReason } : {}),
    files: [outPath],
  };
}

// Register the NROB pull handler. Decision 2A: per-type results funnel through
// `wrapPullResult` so the coordinator stays consistent with the other DDIC
// dual-channel types (MSAG/TTYP/...).
registerPullHandler('NROB', async ({ objectName, opts }) => {
  const r = await runPullNrob(objectName, opts as PullNrobOptions);
  return { object: r.object, files: r.files, channel: r.channel, ...(r.fallbackReason ? { fallbackReason: r.fallbackReason } : {}) };
});
