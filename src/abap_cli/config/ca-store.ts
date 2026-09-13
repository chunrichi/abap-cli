/**
 * PEM credential store under the user config directory.
 *
 * `profile add/set` used to store the user's absolute paths verbatim in
 * `systems.json`. A reboot, a `rm /tmp/foo.pem`, or a container restart
 * then breaks every subsequent SAP command at the TLS layer.
 *
 * This module imports each PEM into `~/.abap-cli/certificates/<sha256>.pem`
 * and returns the canonical stored path. The store is content-addressed, so
 * the same PEM imported from many places becomes a single file, and we can
 * count how many profiles reference a sha256 to clean up orphans without
 * breaking another profile that still needs it.
 *
 * Accepted blocks: certificates (CA / client cert) and private keys.
 * PKCS#12 / DER must be converted by the user before import.
 */

import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CliError } from '../output/json.js';

export const CERT_DIR_ENV = 'ABAP_CLI_CERT_DIR';

const PEM_CERTIFICATE_BEGIN = '-----BEGIN CERTIFICATE-----';

/** Stored PEM filenames are the lowercase sha256 of their bytes. */
const STORED_PEM_RE = /^([0-9a-f]{64})\.pem$/;

/** What a PEM import is allowed to be. */
export type PemKind = 'certificate' | 'private-key';

/** Where imported PEM files live. Overridable for tests. */
export function certDir(): string {
  const override = process.env[CERT_DIR_ENV];
  if (override) return override;
  return path.join(os.homedir(), '.abap-cli', 'certificates');
}

export interface CaImportResult {
  /** Absolute path to the canonical stored PEM. */
  storedPath: string;
  /** Lowercase hex sha256 of the PEM bytes — used as the filename and fingerprint. */
  sha256: string;
  /** ISO timestamp: first-write time on a fresh import, else the stored file's mtime. */
  importedAt: string;
}

/**
 * Parse a PEM block marker. Returns the block type (e.g. `CERTIFICATE`,
 * `RSA PRIVATE KEY`) when the text has a well-formed BEGIN/END pair, else
 * `undefined`.
 */
function pemBlockType(text: string): string | undefined {
  const begin = /-----BEGIN ([A-Z0-9 ]+)-----/.exec(text);
  if (!begin) return undefined;
  const type = begin[1]!;
  return text.includes(`-----END ${type}-----`) ? type : undefined;
}

function kindMatches(blockType: string, kind: PemKind): boolean {
  return kind === 'certificate' ? blockType === 'CERTIFICATE' : blockType.endsWith('PRIVATE KEY');
}

/** Sha of a path that already lives inside the store, else undefined. */
export function storedPemSha(p: string): string | undefined {
  if (path.dirname(p) !== certDir()) return undefined;
  return STORED_PEM_RE.exec(path.basename(p))?.[1];
}

/** True when the path is already a file inside the store (so it needs no import). */
export function isStoredPemPath(p: string): boolean {
  return storedPemSha(p) !== undefined;
}

/**
 * Read a PEM file from disk, validate the block type, and import it into the
 * credential store. Returns the canonical stored path.
 *
 * Idempotent: importing the same bytes twice returns the existing entry.
 */
export function importPem(srcPath: string, kind: PemKind): CaImportResult {
  const resolved = path.resolve(srcPath);
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(resolved);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const label = kind === 'certificate' ? 'CA certificate' : 'private key';
    throw new CliError('CONFIG_ERROR', `Cannot read ${label} file '${resolved}': ${message}`, {
      file: resolved,
      nextSteps: ['Verify the path exists and is readable.'],
    });
  }
  const blockType = pemBlockType(bytes.toString('utf-8'));
  if (!blockType || !kindMatches(blockType, kind)) {
    const expected = kind === 'certificate' ? PEM_CERTIFICATE_BEGIN : '-----BEGIN … PRIVATE KEY-----';
    throw new CliError(
      'INVALID_ARGUMENT',
      `File '${resolved}' is not a PEM ${kind} (expected a '${expected}' block). Convert PKCS#12 / DER to PEM first.`,
      { file: resolved },
    );
  }

  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const dir = certDir();
  const target = path.join(dir, `${sha256}.pem`);

  let importedAt: string;
  if (fs.existsSync(target)) {
    const stat = fs.statSync(target);
    importedAt = stat.mtime.toISOString();
  } else {
    writeStoredPem(dir, target, sha256, bytes);
    importedAt = new Date().toISOString();
  }
  return { storedPath: target, sha256, importedAt };
}

/**
 * CA certificate convenience wrapper (unchanged public contract):
 * `store/` paths pass through untouched so repeat writes stay idempotent.
 */
export function importCaPem(srcPath: string): CaImportResult {
  if (isStoredPemPath(path.resolve(srcPath))) {
    return importedPemResult(path.resolve(srcPath));
  }
  return importPem(srcPath, 'certificate');
}

/** Client certificate convenience wrapper. */
export function importClientCert(srcPath: string): CaImportResult {
  if (isStoredPemPath(path.resolve(srcPath))) {
    return importedPemResult(path.resolve(srcPath));
  }
  return importPem(srcPath, 'certificate');
}

/** Client private key convenience wrapper. */
export function importClientKey(srcPath: string): CaImportResult {
  if (isStoredPemPath(path.resolve(srcPath))) {
    return importedPemResult(path.resolve(srcPath));
  }
  return importPem(srcPath, 'private-key');
}

/** Result shape for a path that already lives in the store. */
function importedPemResult(storedPath: string): CaImportResult {
  const sha256 = storedPemSha(storedPath)!;
  let importedAt = new Date().toISOString();
  try {
    importedAt = fs.statSync(storedPath).mtime.toISOString();
  } catch {
    // A missing store file surfaces later via readCa with a re-import hint.
  }
  return { storedPath, sha256, importedAt };
}

/**
 * Write a fresh store entry. The directory is created 0700 *before* the PEM
 * lands in it (so the file is never briefly readable from a umask-default
 * parent), and the write goes through a temp file + rename so a concurrent
 * import never observes a half file.
 */
function writeStoredPem(dir: string, target: string, sha256: string, bytes: Buffer): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch { /* non-fatal — share-friendly hosts may reject */ }
  const tmp = path.join(dir, `.${sha256}.${process.pid}.tmp`);
  try {
    fs.writeFileSync(tmp, bytes, { mode: 0o600 });
    fs.renameSync(tmp, target);
  } catch (error: unknown) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* best-effort cleanup */ }
    throw error;
  }
}

/** Read a stored PEM file by its stored path. Throws CONFIG_ERROR if missing. */
export function readCa(storedPath: string): string {
  if (!storedPath) {
    throw new CliError('CONFIG_ERROR', 'CA certificate path is empty. Re-run `abap profile set <name> --ca <pem>`.');
  }
  try {
    return fs.readFileSync(storedPath, 'utf-8');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError('CONFIG_ERROR', `Cannot read CA certificate '${storedPath}': ${message}. Re-run \`abap profile set <name> --ca <pem>\`.`, {
      file: storedPath,
    });
  }
}

/**
 * Remove a stored certificate only when no remaining profile still
 * references it. The `referenceCount` is the number of profiles in
 * `systems.json` (after the deletion under way) that still point at
 * `sha256`. A count of 0 means the file is orphaned and safe to remove.
 */
export function removeCaIfOrphan(sha256: string, referenceCount: number): boolean {
  if (referenceCount > 0) return false;
  if (!sha256) return false;
  const target = path.join(certDir(), `${sha256}.pem`);
  if (!fs.existsSync(target)) return false;
  try {
    fs.unlinkSync(target);
    return true;
  } catch {
    return false;
  }
}

/** Short fingerprint for display (sha256 prefix). */
export function fingerprint(sha256: string | undefined, length = 16): string {
  return (sha256 ?? '').slice(0, length);
}

/**
 * Every store path mentioned by a profile-shaped object, whatever the auth
 * method's field names are (`ca`, `caPath`, `certPath`, `keyPath`). Values
 * outside the store (legacy absolute paths) yield no sha and are ignored.
 */
function storeShasOf(profile: unknown): Set<string> {
  const shas = new Set<string>();
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      const sha = storedPemSha(value);
      if (sha) shas.add(sha);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (value && typeof value === 'object') {
      for (const item of Object.values(value)) visit(item);
    }
  };
  visit(profile);
  return shas;
}

/** Shas referenced by any profile in the given store. */
function shasInUse(profiles: Record<string, unknown>): Set<string> {
  const used = new Set<string>();
  for (const profile of Object.values(profiles)) {
    for (const sha of storeShasOf(profile)) used.add(sha);
  }
  return used;
}

/**
 * Reclaim PEMs that `previous` referenced and `next` no longer does and no
 * other profile in `remainingProfiles` uses either. This is the GC path for
 * `--clear-ca`, a replaced `--ca` / `--cert-path` / `--cert-key`, and
 * `profile delete`. Returns the number of files removed. Never throws.
 */
export function collectOrphanPems(
  previous: unknown,
  next: unknown,
  remainingProfiles: Record<string, unknown>,
): number {
  const before = storeShasOf(previous);
  if (before.size === 0) return 0;
  // Still needed if the updated profile keeps it or any other profile uses it.
  const inUse = storeShasOf(next);
  for (const sha of shasInUse(remainingProfiles)) inUse.add(sha);

  let removed = 0;
  for (const sha of before) {
    if (inUse.has(sha)) continue;
    if (removeCaIfOrphan(sha, 0)) removed += 1;
  }
  return removed;
}
