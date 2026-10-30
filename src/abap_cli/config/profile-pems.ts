/**
 * Write-path normaliser for the profile CA certificate.
 *
 * Every profile writer (`profile add`, `profile set`, `init`) funnels through
 * `upsertProfileWithPems()`, which imports the local CA path into the
 * content-addressed store (`config/ca-store.ts`) instead of writing it to
 * `systems.json` verbatim. The profile ends up pointing at
 * `~/.abap-cli/certificates/<sha256>.pem`, so the source file can be moved or
 * deleted afterwards.
 *
 * Paths that already live in the store are left untouched, which keeps repeat
 * writes idempotent (`profile set dev --ca <storedPath>` does not re-import).
 */
import { collectOrphanPems, importCaPem, isStoredPemPath } from './ca-store.js';
import { loadUserConfig, upsertSystem, type SystemProfile } from './user-config.js';

/** Persisted PEM slots for a profile. */
export interface NormalizedProfilePems {
  /** Profile-level CA (`ca`), used for TLS verification. */
  ca?: string;
  /** ISO timestamp of the CA import, surfaced by `profile show`. */
  caImportedAt?: string;
}

/**
 * Import the profile's local CA path into the store and return the path that
 * should be persisted. The CA import timestamp is returned only when `ca` was
 * set on input (so re-saving an existing profile doesn't bump the timestamp).
 */
export function normalizeProfilePems(profile: { ca?: string }): NormalizedProfilePems {
  const normalized: NormalizedProfilePems = {};
  if (!profile.ca) return normalized;
  if (isStoredPemPath(profile.ca)) {
    normalized.ca = profile.ca;
    return normalized;
  }
  const result = importCaPem(profile.ca);
  normalized.ca = result.storedPath;
  normalized.caImportedAt = result.importedAt;
  return normalized;
}

/**
 * Import the CA and persist its store path + import timestamp on the profile in
 * place. Used by the setup flows so `profile show` can surface when the CA
 * entered the store.
 */
export function applyPemsToProfileWithTimestamp<T extends { ca?: string; caImportedAt?: string }>(profile: T): T {
  const pems = normalizeProfilePems(profile);
  if (pems.ca) profile.ca = pems.ca;
  if (pems.caImportedAt) profile.caImportedAt = pems.caImportedAt;
  return profile;
}

/**
 * Persist `updated` with its CA imported, then reclaim store PEMs that `base`
 * referenced and `updated` dropped (replaced `--ca`, `--clear-ca`, or a deleted
 * profile).
 *
 * The import happens before the write, so a bad PEM aborts without touching
 * `systems.json`; the reclaim happens after it, so a failed write never deletes
 * a file the profile still points at. The returned profile is the one written.
 */
export function upsertProfileWithPems<T extends SystemProfile>(
  name: string,
  base: SystemProfile | null,
  updated: T,
): { profile: T; pemsReclaimed: number } {
  applyPemsToProfileWithTimestamp(updated);
  upsertSystem(name, updated);

  if (!base) return { profile: updated, pemsReclaimed: 0 };
  try {
    return { profile: updated, pemsReclaimed: collectOrphanPems(base, updated, loadUserConfig().systems) };
  } catch {
    // Cleanup is best-effort — a corrupt systems.json must not fail the write.
    return { profile: updated, pemsReclaimed: 0 };
  }
}
