/**
 * Session store — where session jars live, and how they are read/written.
 *
 * Reuse is only honest when the jar lives in a location the **next CLI
 * process** can read. A successful `writeFileSync` proves neither visibility
 * nor duarbility: `$TMPDIR` can be per-process in a sandbox, a container can
 * drop it between commands, and a read-only HOME cannot hold the jar at all.
 * The old code wrote to `$TMPDIR` and marked the session "reusable" anyway,
 * which is how one orphan SAP session per command accumulated.
 *
 * Candidate locations, in priority order (all durable by construction):
 *
 *   1. `ABAP_CLI_SESSION_DIR`      — explicit user/CI override
 *   2. `~/.abap-cli/sessions`      — default, unchanged for normal dev machines
 *   3. `<workspace>/.abap-cli/sessions` — for sandboxed agents where HOME is
 *      read-only but the workspace is writable; self-ignored via
 *      `<workspace>/.abap-cli/.gitignore` containing `*`
 *
 * `$TMPDIR` is deliberately not a store: it can never be proven durable across
 * processes. If no candidate is writable the lifecycle runs per-command
 * (login + logout) instead of pretending to persist.
 *
 * Writes are atomic (same-directory temp file + rename, 0600) because two
 * commands may race on the same jar; reads scan every candidate and pick the
 * newest decrypted jar so a stale read-only jar cannot mask a fresh one.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CliError } from '../output/json.js';
import type { SapConfig } from '../config/project-config.js';
import {
  computeSystemHash,
  decryptJar,
  encryptJar,
  hasStatefulSessionCookie,
  type SessionJar,
} from './jar.js';

export type StoreKind = 'env' | 'home' | 'workspace';

/** Environment variable that overrides the session store directory. */
export const SESSION_DIR_ENV = 'ABAP_CLI_SESSION_DIR';

export interface StoreCandidate {
  kind: StoreKind;
  /** Absolute directory holding `<system-hash>.json` files. */
  dir: string;
  /** Human-facing path (home shortened to `~`). */
  displayDir: string;
}

export type StoreFailure = 'unwritable' | 'unreadable' | 'corrupt' | 'unset';

export interface StoreStatus {
  kind: StoreKind;
  path: string;
  displayPath: string;
  durability: 'durable';
  exists: boolean;
  /** Best-effort writability hint; `null` when not probed. */
  writable: boolean | null;
  jarExists: boolean;
  status: 'ok' | StoreFailure;
  error?: string;
  jar?: SessionJar;
}

export interface StoreReadResult {
  statuses: StoreStatus[];
  /** Newest jar among the decryptable candidates. */
  best: { jar: SessionJar; candidate: StoreCandidate } | null;
  /** True when at least one candidate exists but none could be decrypted. */
  corrupt: boolean;
}

export interface StoreWriteResult {
  ok: boolean;
  candidate?: StoreCandidate;
  path?: string;
  error?: string;
}

export interface StoreWriteProbe {
  candidate: StoreCandidate | null;
  statuses: StoreStatus[];
}

/** Human path: `~` for the home directory. */
export function displayPath(p: string): string {
  const home = os.homedir();
  if (p === home) return '~';
  if (p.startsWith(home + path.sep)) return '~' + p.slice(home.length);
  return p;
}

/** Candidate store directories for a profile, highest priority first. */
export function resolveStoreCandidates(
  profile: SapConfig,
  opts: { workspaceRoot?: string | null } = {},
): StoreCandidate[] {
  const candidates: StoreCandidate[] = [];
  const envDir = process.env[SESSION_DIR_ENV]?.trim();
  if (envDir) {
    const dir = path.resolve(envDir);
    candidates.push({ kind: 'env', dir, displayDir: displayPath(dir) });
  }
  const homeDir = path.join(os.homedir(), '.abap-cli', 'sessions');
  candidates.push({ kind: 'home', dir: homeDir, displayDir: displayPath(homeDir) });
  if (opts.workspaceRoot) {
    const dir = path.join(path.resolve(opts.workspaceRoot), '.abap-cli', 'sessions');
    candidates.push({ kind: 'workspace', dir, displayDir: displayPath(dir) });
  }
  return candidates;
}

/** Absolute jar path for a profile inside a candidate store. */
export function jarPathFor(candidate: StoreCandidate, profile: SapConfig): string {
  return path.join(candidate.dir, `${computeSystemHash(profile)}.json`);
}

function isFsErrorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return undefined;
}

/** Filesystem errors that mean "this candidate is not usable; try the next". */
function isUnwritableError(error: unknown): boolean {
  const code = isFsErrorCode(error);
  return code === 'EPERM' || code === 'EACCES' || code === 'EROFS' || code === 'ENOTDIR' || code === 'ENOENT';
}

/** `mkdir -p` with 0700 on the created directories (best effort chmod). */
function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    // best effort — a pre-existing dir may be owned/managed by the user
  }
}

/**
 * Make a workspace store self-ignoring: `<workspace>/.abap-cli/.gitignore`
 * with `*`. This keeps agent-created jars out of version control without
 * touching the user's `.gitignore`.
 */
function ensureWorkspaceIgnore(candidate: StoreCandidate): void {
  if (candidate.kind !== 'workspace') return;
  const parent = path.dirname(candidate.dir);
  const ignore = path.join(parent, '.gitignore');
  try {
    if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, '*\n', { mode: 0o600 });
  } catch {
    // best effort — the store is already 0600/0700 and outside git tracks
  }
}

/**
 * Writability hint without creating anything (used by the read-only
 * `abap session info`): check the closest existing ancestor for `W_OK`.
 */
export function writableHint(dir: string): boolean {
  let current = path.resolve(dir);
  for (;;) {
    try {
      if (fs.existsSync(current)) {
        fs.accessSync(current, fs.constants.W_OK);
        return true;
      }
    } catch {
      return false;
    }
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

/** Base status record for a candidate. */
function baseStatus(candidate: StoreCandidate, profile: SapConfig): StoreStatus {
  const file = jarPathFor(candidate, profile);
  return {
    kind: candidate.kind,
    path: file,
    displayPath: displayPath(file),
    durability: 'durable',
    exists: false,
    writable: null,
    jarExists: false,
    status: 'unset',
  };
}

/**
 * Read the best decryptable jar across all candidates. Never throws for
 * per-candidate problems (unreadable/corrupt); they are reported in statuses.
 */
export function readSessionJars(
  profile: SapConfig,
  key: Buffer | null,
  candidates: readonly StoreCandidate[],
): StoreReadResult {
  const systemHash = computeSystemHash(profile);
  const statuses: StoreStatus[] = [];
  let best: { jar: SessionJar; candidate: StoreCandidate } | null = null;
  let sawCorrupt = false;

  for (const candidate of candidates) {
    const status = baseStatus(candidate, profile);
    status.exists = fs.existsSync(candidate.dir);
    if (status.exists) status.writable = writableHint(candidate.dir);
    status.jarExists = fs.existsSync(status.path);
    if (!status.jarExists) {
      status.status = 'unset';
      statuses.push(status);
      continue;
    }
    if (!key) {
      status.status = 'unreadable';
      status.error = 'session key unavailable';
      statuses.push(status);
      continue;
    }
    try {
      const blob = fs.readFileSync(status.path);
      const jar = decryptJar(blob, key, systemHash);
      status.status = 'ok';
      status.jar = jar;
      if (!best || jar.header.lastLoginAt > best.jar.header.lastLoginAt) best = { jar, candidate };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const isDecrypt = error instanceof CliError && error.code === 'SESSION_JAR_DECRYPT_FAILED';
      status.status = isDecrypt ? 'corrupt' : 'unreadable';
      status.error = message;
      if (isDecrypt) sawCorrupt = true;
    }
    statuses.push(status);
  }

  return {
    statuses,
    best,
    corrupt: sawCorrupt && best === null,
  };
}

/**
 * Probe candidates for writability by actually creating the directory (and,
 * for a workspace store, its self-ignore file). Returns the highest-priority
 * writable candidate; no jar is written.
 */
export function probeWriteCandidate(
  profile: SapConfig,
  candidates: readonly StoreCandidate[],
): StoreWriteProbe {
  const statuses: StoreStatus[] = [];
  let writable: StoreCandidate | null = null;
  for (const candidate of candidates) {
    const status = baseStatus(candidate, profile);
    status.exists = fs.existsSync(candidate.dir);
    status.jarExists = fs.existsSync(status.path);
    try {
      ensureDir(candidate.dir);
      ensureWorkspaceIgnore(candidate);
      // A directory can exist but still be unwritable (sandboxed HOME, read-only
      // mount, managed config dir): only an actual write proves durability.
      const probe = path.join(candidate.dir, `.write-probe-${process.pid}`);
      fs.writeFileSync(probe, '', { mode: 0o600 });
      fs.rmSync(probe, { force: true });
      status.exists = true;
      status.writable = true;
      if (!writable) writable = candidate;
    } catch (error: unknown) {
      status.writable = false;
      status.status = 'unwritable';
      status.error = error instanceof Error ? error.message : String(error);
    }
    if (status.status !== 'unwritable') status.status = status.jarExists ? 'ok' : 'unset';
    statuses.push(status);
  }
  return { candidate: writable, statuses };
}

/**
 * Encrypt and atomically write the jar to the first writable candidate.
 * Returns which candidate won (the caller needs that for diagnostics and for
 * deciding whether the session is really reusable).
 */
export function writeSessionJar(
  jar: SessionJar,
  profile: SapConfig,
  key: Buffer,
  candidates: readonly StoreCandidate[],
): StoreWriteResult {
  const encrypted = encryptJar(jar, key);
  let lastError: string | undefined;
  for (const candidate of candidates) {
    const file = jarPathFor(candidate, profile);
    try {
      ensureDir(candidate.dir);
      ensureWorkspaceIgnore(candidate);
      const tmp = path.join(candidate.dir, `.tmp-${process.pid}-${Math.random().toString(16).slice(2)}.json`);
      try {
        fs.writeFileSync(tmp, encrypted, { mode: 0o600 });
        fs.renameSync(tmp, file);
      } catch (error: unknown) {
        try {
          fs.rmSync(tmp, { force: true });
        } catch {
          // best effort cleanup
        }
        throw error;
      }
      return { ok: true, candidate, path: file };
    } catch (error: unknown) {
      lastError = error instanceof Error ? error.message : String(error);
      // A structurally unwritable candidate: try the next one.
      if (isUnwritableError(error)) continue;
      // Unknown failure on the highest-priority store: still try the next.
      continue;
    }
  }
  return { ok: false, error: lastError ?? 'no writable session store' };
}

/**
 * Remove the profile's jar (and any quarantined copies) from every candidate.
 * Used by `session reset` and when a session this process logged out is gone.
 */
export function clearSessionJars(profile: SapConfig, candidates: readonly StoreCandidate[]): string[] {
  const removed: string[] = [];
  const hash = computeSystemHash(profile);
  for (const candidate of candidates) {
    const dir = candidate.dir;
    if (!fs.existsSync(dir)) continue;
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry !== `${hash}.json` && !entry.startsWith(`${hash}.json.corrupt`)) continue;
      const file = path.join(dir, entry);
      try {
        fs.rmSync(file, { force: true });
        removed.push(displayPath(file));
      } catch {
        // best effort
      }
    }
  }
  return removed;
}

/**
 * Move a corrupt jar aside so it is not retried forever. Only possible when
 * the candidate directory is writable.
 */
export function quarantineCorruptJars(
  profile: SapConfig,
  candidates: readonly StoreCandidate[],
): string[] {
  const moved: string[] = [];
  for (const candidate of candidates) {
    const file = jarPathFor(candidate, profile);
    if (!fs.existsSync(file)) continue;
    try {
      const target = `${file}.corrupt-${Date.now()}`;
      fs.renameSync(file, target);
      moved.push(displayPath(target));
    } catch {
      // best effort
    }
  }
  return moved;
}

/** Convenience for diagnostics: the session id of a jar, if any. */
export function jarHasStatefulSession(jar: SessionJar): boolean {
  return hasStatefulSessionCookie(jar.cookies);
}
