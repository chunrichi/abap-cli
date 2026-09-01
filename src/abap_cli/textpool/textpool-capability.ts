import { getSystem, upsertSystem } from '../config/user-config.js';
import { AdtClientWrapper } from '../clients/adt-client.js';

/** Capability record persisted on SystemProfile. */
export interface TextpoolCapability {
  read: boolean;
  write: boolean;
  checkedAt: string;
}

/** Extended system profile shape (persisted to ~/.abap-cli/systems.json). */
export interface CapabilityAwareProfile {
  url: string;
  client: string;
  username: string;
  language: string;
  insecure?: boolean;
  ca?: string;
  systemVersion?: string;
  adtTextpool?: TextpoolCapability;
}

/**
 * One-shot probe (Q1: record once at connect/init, reuse afterwards).
 * - read: getTextElements succeeds (all SAP systems; author-doc confirmed).
 * - write: setTextElements succeeds; unsupported systems (ECC) throw → write=false.
 * Never throws: any probe failure degrades to read=false/write=false rather than
 * blocking the calling command (init / profile add|set stay non-blocking).
 */
export async function probeTextpoolCapability(): Promise<TextpoolCapability & { systemVersion?: string }> {
  const checkedAt = new Date().toISOString();
  let read = false;
  let write = false;
  try {
    const client = await AdtClientWrapper.create();
    const te = await client.getTextElements('PROG', 'ZABAP_VIBE_PROBE', 'symbols');
    read = Array.isArray(te?.textElements);
    try {
      // A write probe on a read-only-capable system verifies the PUT endpoint.
      // We probe against a throwaway object name; on ECC the endpoint itself is
      // absent (404/501), which surfaces as "write unsupported".
      await client.setTextElements('PROG', 'ZABAP_VIBE_PROBE', 'symbols', [], '');
      write = true;
    } catch {
      write = false;
    }
  } catch {
    read = false;
    write = false;
  }
  return { read, write, checkedAt };
}

/** Persist the probe result (and optional system release) onto a SystemProfile. */
export async function recordCapability(systemName: string, cap: TextpoolCapability & { systemVersion?: string }): Promise<void> {
  const current = getSystem(systemName);
  if (!current) {
    throw new Error(`System profile '${systemName}' not found; cannot record textpool capability`);
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
  const profile = getSystem(systemName) as CapabilityAwareProfile | null;
  return profile?.adtTextpool;
}
