import {
  getTextElements as adtGetTextElements,
  setTextElements as adtSetTextElements,
  textElementsUrl,
} from 'abap-adt-api/build/api/textelements.js';
import { buildBasicAuth } from './basic-auth.js';
import { withRawAdtSession } from './raw-adt-session.js';
import { getPassword } from '../config/secrets.js';
import { getSystem, upsertSystem } from '../config/user-config.js';
import { CliError } from '../output/json.js';

/** Capability record persisted on SystemProfile. */
export interface TextpoolCapability {
  read: boolean;
  write: boolean;
  checkedAt: string;
}

/**
 * Probe outcome. `reached` separates "logged in but the endpoint is missing"
 * (ECC → write=false) from "never reached the system" (bad password/unreachable):
 * only a reached probe may be persisted, otherwise a transient outage would
 * pin the profile to false/false.
 */
export interface TextpoolProbeResult extends TextpoolCapability {
  reached: boolean;
}

/**
 * One-shot probe against ONE named profile (record once at connect/init, reuse
 * afterwards). It never borrows the current workspace's connection: `profile
 * add` may run in a directory bound to a different system, and `init` may be
 * creating a brand-new profile.
 *
 * - read: getTextElements succeeds (all SAP systems; author-doc confirmed).
 * - write: setTextElements succeeds; unsupported systems (ECC) throw → write=false.
 * Never throws: any probe failure degrades to read=false/write=false/reached=false
 * rather than blocking the calling command (init / profile add stay non-blocking).
 */
export async function probeTextpoolCapability(systemName: string): Promise<TextpoolProbeResult> {
  const checkedAt = new Date().toISOString();
  const profile = getSystem(systemName);
  if (!profile) {
    return { read: false, write: false, reached: false, checkedAt };
  }

  let read = false;
  let write = false;
  let reached = false;
  try {
    const password = (await getPassword(systemName)) ?? '';
    const auth = buildBasicAuth({
      url: profile.url,
      client: profile.client || '100',
      username: profile.username,
      password,
      language: profile.language || 'EN',
      insecure: profile.insecure ?? process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0',
      caPath: profile.ca || '',
      sourceDir: process.cwd(),
    });
    await withRawAdtSession(
      {
        url: profile.url,
        username: profile.username,
        password: auth.password,
        client: profile.client || '100',
        language: profile.language || 'EN',
        options: auth.options,
      },
      async (client) => {
        reached = true;
        const textElementUrl = textElementsUrl('PROG', 'ZABAP_VIBE_PROBE');
        const te = await adtGetTextElements(client.httpClient, textElementUrl, 'symbols');
        read = Array.isArray(te?.textElements);
        try {
          // A write probe verifies the PUT endpoint. The throwaway object name
          // means no real text element is touched; on ECC the endpoint itself is
          // absent (404/501), which surfaces as "write unsupported".
          await adtSetTextElements(client.httpClient, textElementUrl, 'symbols', [], '');
          write = true;
        } catch {
          write = false;
        }
      },
    );
  } catch {
    read = false;
    write = false;
  }
  return { read, write, reached, checkedAt };
}

/** Persist the probe result (and optional system release) onto a SystemProfile. */
export async function recordCapability(
  systemName: string,
  cap: TextpoolCapability & { systemVersion?: string },
): Promise<void> {
  const current = getSystem(systemName);
  if (!current) {
    throw new CliError('CONFIG_ERROR', `System profile '${systemName}' not found; cannot record textpool capability`, {
      nextSteps: [`Re-run abap init to create profile '${systemName}'.`],
    });
  }
  upsertSystem(systemName, {
    ...current,
    ...(cap.systemVersion ? { systemVersion: cap.systemVersion } : {}),
    adtTextpool: { read: cap.read, write: cap.write, checkedAt: cap.checkedAt },
  });
}

/**
 * Read the cached capability for a system. Returns undefined when the profile has
 * no adtTextpool record (not probed yet) — callers apply conservative defaults.
 */
export function readCapability(systemName: string): TextpoolCapability | undefined {
  return getSystem(systemName)?.adtTextpool;
}
