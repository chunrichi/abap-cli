/**
 * Write-path normaliser for PEM credentials (CA / client cert / client key).
 *
 * Every profile writer (`profile add`, `profile set`, `init`) funnels through
 * `upsertProfileWithPems()`, which imports local paths into the
 * content-addressed store (`config/ca-store.ts`) instead of writing them to
 * `systems.json` verbatim. Whatever the auth method's field names are, the
 * profile ends up pointing at `~/.abap-cli/certificates/<sha256>.pem`, so the
 * source file can be moved or deleted afterwards.
 *
 * Paths that already live in the store are left untouched, which keeps repeat
 * writes idempotent (`profile set dev --ca <storedPath>` does not re-import).
 */

import type { AuthConfig } from '../auth/v2-types.js';
import { collectOrphanPems, importCaPem, importClientCert, importClientKey, isStoredPemPath } from './ca-store.js';
import { loadUserConfig, upsertSystem, type SystemProfile } from './user-config.js';

/** The PEM slots a profile can carry. */
export interface NormalizedProfilePems {
  /** Profile-level CA (`ca`), used for TLS verification. */
  ca?: string;
  /** cert-auth certificate (`auth.cert.certPath`). */
  certPath?: string;
  /** cert-auth private key (`auth.cert.keyPath`). */
  keyPath?: string;
  /** cert-auth CA override (`auth.cert.caPath`). */
  certCaPath?: string;
  /** ISO timestamp of the CA import, surfaced by `profile show`. */
  caImportedAt?: string;
}

/**
 * Import every local PEM path in `profile` into the store and return the paths
 * that should be persisted. Fields that are absent stay absent; fields already
 * in the store pass through unchanged. The CA import timestamp is returned
 * only when `profile.ca` was set on input (so re-saving an existing profile
 * doesn't bump the timestamp).
 */
export function normalizeProfilePems(
  profile: { ca?: string; auth: AuthConfig },
): NormalizedProfilePems {
  const normalized: NormalizedProfilePems = {};
  const keepOrImport = (
    value: string | undefined,
    importFn: (p: string) => { storedPath: string; importedAt: string },
  ): string | undefined => {
    if (!value) return undefined;
    if (isStoredPemPath(value)) return value;
    const result = importFn(value);
    normalized.caImportedAt ??= result.importedAt;
    return result.storedPath;
  };

  if (profile.ca) {
    if (isStoredPemPath(profile.ca)) {
      normalized.ca = profile.ca;
    } else {
      const result = importCaPem(profile.ca);
      normalized.ca = result.storedPath;
      normalized.caImportedAt = result.importedAt;
    }
  }

  if (profile.auth.method === 'cert') {
    const cert = profile.auth.cert;
    normalized.certPath = keepOrImport(cert.certPath, importClientCert);
    normalized.keyPath = keepOrImport(cert.keyPath, importClientKey);
    normalized.certCaPath = keepOrImport(cert.caPath, importCaPem);
  }
  return normalized;
}

/**
 * Apply the stored (imported) PEM paths onto the profile in place. Kept
 * separate so a writer can import early — before keychain side effects — and
 * still persist through `upsertProfileWithPems()` later.
 */
export function applyPemsToProfile<T extends { ca?: string; auth: AuthConfig }>(profile: T): T {
  const pems = normalizeProfilePems(profile);
  if (pems.ca) profile.ca = pems.ca;
  if (profile.auth.method === 'cert') {
    if (pems.certPath) profile.auth.cert.certPath = pems.certPath;
    if (pems.keyPath) profile.auth.cert.keyPath = pems.keyPath;
    if (pems.certCaPath) profile.auth.cert.caPath = pems.certCaPath;
  }
  return profile;
}

/**
 * Like `applyPemsToProfile` but also persists the CA import timestamp on the
 * profile (`caImportedAt`). Used by `applyNormalizedPems` in the setup flow so
 * `profile show` can surface when the CA entered the store.
 */
export function applyPemsToProfileWithTimestamp<T extends { ca?: string; caImportedAt?: string; auth: AuthConfig }>(profile: T): T {
  const pems = normalizeProfilePems(profile);
  if (pems.ca) profile.ca = pems.ca;
  if (pems.caImportedAt) profile.caImportedAt = pems.caImportedAt;
  if (profile.auth.method === 'cert') {
    if (pems.certPath) profile.auth.cert.certPath = pems.certPath;
    if (pems.keyPath) profile.auth.cert.keyPath = pems.keyPath;
    if (pems.certCaPath) profile.auth.cert.caPath = pems.certCaPath;
  }
  return profile;
}

/**
 * Persist `updated` with its PEM paths imported, then reclaim store PEMs that
 * `base` referenced and `updated` dropped (replaced `--ca` / `--cert-path` /
 * `--cert-key`, `--clear-ca`, or a deleted profile).
 *
 * The import happens before the write, so a bad PEM aborts without touching
 * `systems.json`; the reclaim happens after it, so a failed write never
 * deletes a file the profile still points at. The returned profile is the one
 * that was written.
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
