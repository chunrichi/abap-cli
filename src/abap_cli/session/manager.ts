/**
 * Session lifecycle — the single decision point for "do we reuse a SAP
 * session, and must this process release the one it opened?".
 *
 * Before this module the decision was spread across `adt-client` (three
 * duplicated login/capture/persist blocks), `icf-client`, the cleanup hook and
 * the registry, and it was based on the wrong signal: "the jar write
 * succeeded" was used as "the next command can reuse it". That made the
 * end-of-command release safety net unreachable whenever the jar was persisted
 * to a location the next process could not read (or the replayed session was
 * rejected by SAP), leaving one orphan session per command in SM04.
 *
 * The contract now:
 *
 *   - a session is `reusable` only when the jar was persisted to a **durable**
 *     store, contains a stateful `SAP_SESSIONID_*` cookie, and replay has not
 *     been blocked by repeated auth failures;
 *   - a session that is not reusable is logged out when the command ends;
 *   - repeated auth failures pause reuse (`reuseBlockedUntil`) so a broken
 *     environment degrades to "login + logout per command" instead of leaking.
 */

import type { ADTClient } from 'abap-adt-api';
import type { ProjectConfig } from '../config/project-config.js';
import { adtSessionCloseWarning, closeAdtSession } from '../clients/adt-session-close.js';
import { collectWarning } from '../output/meta.js';
import { effectivePolicy, resolveSessionPolicy } from './policy.js';
import { loadOrCreateSessionKey } from './key.js';
import {
  hasStatefulSessionCookie,
  makeEmptyJar,
  type SessionJar,
  type SessionKeyMode,
} from './jar.js';
import { SessionCookieController } from './cookies.js';
import {
  clearSessionJars,
  displayPath,
  probeWriteCandidate,
  quarantineCorruptJars,
  readSessionJars,
  resolveStoreCandidates,
  writeSessionJar,
  type StoreCandidate,
  type StoreStatus,
} from './store.js';

/** Consecutive commands whose replayed session SAP rejected before reuse pauses. */
export const REUSE_FAILURE_LIMIT = 2;

/** How long reuse stays paused before the jar is retried once. */
export const REUSE_BLOCK_MS = 10 * 60_000;

export type EffectiveSessionKeyMode = 'keychain' | 'derived' | 'ephemeral' | 'disabled';

export type ReuseReason =
  | 'cloud-btp'
  | 'always-logout'
  | 'key-store-ephemeral'
  | 'no-durable-store'
  | 'reuse-unstable'
  | 'corrupt-jar'
  | null;

/** True when the jar is currently paused after repeated auth failures. */
export function reuseIsBlocked(jar: SessionJar, now: Date = new Date()): boolean {
  if (jar.header.reuseFailures < REUSE_FAILURE_LIMIT) return false;
  if (!jar.header.reuseBlockedUntil) return true;
  return new Date(jar.header.reuseBlockedUntil).getTime() > now.getTime();
}

/** Reset a paused jar now that the pause expired (retry once from scratch). */
function clearReuseBlock(jar: SessionJar): void {
  jar.header.reuseFailures = 0;
  delete jar.header.reuseBlockedUntil;
}

function resolvePolicySource(config: ProjectConfig): 'env' | 'profile' | 'default' {
  const env = process.env.ABAP_CLI_SESSION_POLICY;
  if (env === 'reuse' || env === 'always-logout') return 'env';
  const profile = config.sap.sessionPolicy;
  if (profile && profile !== 'default') return 'profile';
  return 'default';
}

export class SessionLifecycle {
  /** Live cookie set shared with the HTTP transport wrapper. */
  readonly controller = new SessionCookieController();

  readonly policy: 'reuse' | 'always-logout';
  readonly policySource: 'env' | 'profile' | 'default';
  readonly keyMode: EffectiveSessionKeyMode;

  reuseEnabled = false;
  reuseReason: ReuseReason = null;
  candidates: StoreCandidate[] = [];
  storeStatuses: StoreStatus[] = [];

  private readonly config: ProjectConfig;
  private key: Buffer | null = null;
  private writeCandidate: StoreCandidate | null = null;
  private persistedStore: StoreCandidate | null = null;
  private jar: SessionJar | null = null;
  private state: 'reused' | 'fresh' | 'per-command' | 'blocked' = 'per-command';
  private freshLogin = false;
  private reusable = false;
  private fallbackUsed = false;
  private persisted = false;

  private constructor(
    config: ProjectConfig,
    policy: 'reuse' | 'always-logout',
    policySource: 'env' | 'profile' | 'default',
    keyMode: EffectiveSessionKeyMode,
  ) {
    this.config = config;
    this.policy = policy;
    this.policySource = policySource;
    this.keyMode = keyMode;
  }

  /** Resolve policy + key + store and prepare the (possibly reused) session. */
  static async init(config: ProjectConfig): Promise<SessionLifecycle> {
    const declaredPolicy = resolveSessionPolicy(config);
    const policy = effectivePolicy(declaredPolicy);
    const policySource = resolvePolicySource(config);

    // Cloud/BTP and forced fresh-login modes never touch the store.
    if (policy !== 'reuse') {
      const lifecycle = new SessionLifecycle(config, policy, policySource, 'disabled');
      lifecycle.reuseReason = 'always-logout';
      return lifecycle;
    }
    if (isUnsupported(config)) {
      const lifecycle = new SessionLifecycle(config, policy, policySource, 'disabled');
      lifecycle.reuseReason = 'cloud-btp';
      return lifecycle;
    }

    const { key, mode } = await loadOrCreateSessionKey(config.sap);
    const lifecycle = new SessionLifecycle(config, policy, policySource, mode);
    lifecycle.key = key;
    if (mode === 'ephemeral') {
      lifecycle.reuseReason = 'key-store-ephemeral';
      warnOnce(
        'SESSION_REUSE_DISABLED',
        'Session reuse is disabled: the configured key store does not persist across processes. ' +
          'Every command logs in and logs out again.',
      );
      return lifecycle;
    }

    lifecycle.candidates = resolveStoreCandidates(config.sap, { workspaceRoot: config.workspaceRoot });
    const read = readSessionJars(config.sap, key, lifecycle.candidates);
    if (read.corrupt) {
      const moved = quarantineCorruptJars(config.sap, lifecycle.candidates);
      collectWarning(
        'SESSION_JAR_CORRUPT',
        'The stored session jar could not be decrypted and was discarded; the next command logs in again.',
        moved.length > 0 ? { quarantined: moved } : undefined,
      );
    }
    const probe = probeWriteCandidate(config.sap, lifecycle.candidates);
    lifecycle.writeCandidate = probe.candidate;
    lifecycle.storeStatuses = probe.statuses;
    if (probe.candidate?.kind === 'workspace') {
      collectWarning(
        'SESSION_STORE_FALLBACK',
        `The home directory is not writable; session reuse is using the workspace store (${displayPath(probe.candidate.dir)}).`,
      );
    }

    if (read.best) {
      const jar = read.best.jar;
      const paused = jar.header.reuseFailures >= REUSE_FAILURE_LIMIT && reuseIsBlocked(jar);
      if (paused) {
        // A paused jar may also have had its dead cookies cleared on release;
        // it must still be recognised so the next command runs per-command
        // instead of silently starting a fresh reusable session.
        lifecycle.jar = jar;
        lifecycle.reuseEnabled = true;
        lifecycle.state = 'blocked';
        lifecycle.reuseReason = 'reuse-unstable';
        warnOnce(
          'SESSION_REUSE_UNSTABLE',
          'SAP kept rejecting the stored session; reuse is paused and commands run with a fresh, released session until it recovers.',
        );
        return lifecycle;
      }
      if (jar.header.reuseFailures >= REUSE_FAILURE_LIMIT) clearReuseBlock(jar);
      if (hasStatefulSessionCookie(jar.cookies)) {
        lifecycle.jar = jar;
        lifecycle.reuseEnabled = true;
        lifecycle.controller.seed(jar.cookies);
        lifecycle.state = 'reused';
        return lifecycle;
      }
    }

    lifecycle.state = 'fresh';
    lifecycle.reuseEnabled = lifecycle.writeCandidate !== null;
    if (!lifecycle.reuseEnabled) {
      lifecycle.reuseReason = 'no-durable-store';
      warnOnce(
        'SESSION_REUSE_DISABLED',
        'Session reuse is disabled: no durable session directory is writable. ' +
          'Every command logs in and logs out again; set ABAP_CLI_SESSION_DIR to enable reuse.',
      );
    }
    return lifecycle;
  }

  /** True when this process is riding a persisted session. */
  get reused(): boolean {
    return this.state === 'reused';
  }

  /** True once this process has a usable session (reused or freshly logged in). */
  get hasEstablishedSession(): boolean {
    return this.state === 'reused' || this.freshLogin;
  }

  /** True when this process opened a session it cannot hand to the next command. */
  get needsRelease(): boolean {
    return this.freshLogin && !this.reusable;
  }

  /** Expose the loaded jar for diagnostics/tests. */
  get sessionJar(): SessionJar | null {
    return this.jar;
  }

  /** Write the reused CSRF token into the live client (no login round-trip). */
  applyTo(client: ADTClient): void {
    if (this.state !== 'reused') return;
    const csrf = this.jar?.csrf.value;
    if (csrf) client.httpClient.csrfToken = csrf;
  }

  /** Forget any seeded cookies before an explicit `login()`. */
  beginFreshLogin(): void {
    this.controller.clear();
    this.freshLogin = false;
    this.reusable = false;
    this.state = 'fresh';
  }

  /**
   * Capture the session the client just opened, persist it when possible, and
   * decide honestly whether the next command can reuse it.
   */
  async adoptFreshLogin(client: ADTClient): Promise<void> {
    this.freshLogin = true;
    const now = new Date().toISOString();
    const jar = this.jar ?? makeEmptyJar(
      this.config.sap,
      this.config.sap.systemType ?? 'on-prem',
      this.config.systemName,
      this.keyMode === 'keychain' || this.keyMode === 'derived' ? this.keyMode : 'unknown',
    );
    jar.header.lastLoginAt = now;
    if (this.keyMode === 'keychain' || this.keyMode === 'derived') jar.header.keyMode = this.keyMode;
    jar.cookies = this.controller.snapshot();
    const csrf = client.httpClient.csrfToken;
    if (csrf) jar.csrf = { value: csrf, fetchedAt: now };
    jar.header.sapSessionId = this.controller.sessionId();
    this.jar = jar;
    this.controller.enableInjection();

    const blocked = reuseIsBlocked(jar);
    let persisted = false;
    if (this.key) {
      // Try every candidate in priority order: a probe can be stale (e.g. a
      // directory that exists but is not writable under a sandbox).
      const outcome = writeSessionJar(jar, this.config.sap, this.key, this.candidates);
      persisted = outcome.ok;
      this.persistedStore = outcome.ok ? (outcome.candidate ?? null) : null;
    }
    this.persisted = persisted;
    this.reusable = persisted && hasStatefulSessionCookie(jar.cookies) && !blocked;
  }

  /**
   * A replayed session was rejected (401/403/440). Count the failure, pause
   * reuse after repeated hits, and allow exactly one re-login + retry.
   */
  recordAuthFailure(): boolean {
    if (this.state !== 'reused' || this.fallbackUsed) return false;
    this.fallbackUsed = true;
    if (this.jar) {
      this.jar.header.reuseFailures += 1;
      if (this.jar.header.reuseFailures >= REUSE_FAILURE_LIMIT) {
        this.jar.header.reuseBlockedUntil = new Date(Date.now() + REUSE_BLOCK_MS).toISOString();
        collectWarning(
          'SESSION_REUSE_UNSTABLE',
          'SAP rejected the stored session again; reuse is paused for this run and the session will be released at command end.',
        );
      }
    }
    this.controller.clear();
    this.freshLogin = false;
    this.reusable = false;
    return true;
  }

  /** A request on a reused session succeeded: clear the failure counter. */
  markReuseSuccess(): void {
    const store = this.persistedStore ?? this.writeCandidate;
    if (this.state !== 'reused' || !this.jar || !this.key || !store) return;
    if (this.jar.header.reuseFailures === 0 && this.jar.header.lastUsedAt) return;
    this.jar.header.reuseFailures = 0;
    this.jar.header.lastUsedAt = new Date().toISOString();
    writeSessionJar(this.jar, this.config.sap, this.key, [store]);
  }

  /**
   * End-of-command release. Keeps a reusable session open for the next
   * command; closes the SAP context (and forgets the jar) when it could not be
   * handed off.
   */
  async release(client: ADTClient): Promise<void> {
    if (!this.needsRelease) {
      this.controller.clear();
      return;
    }
    this.controller.enableInjection();
    // The custom transport owns the live cookies; mirror them into the library
    // jar so the close exchange can read the context id and observe SAP's
    // `sap-contextid=0` acknowledgement.
    const liveCookies = this.controller.headerValue();
    if (liveCookies) {
      try {
        client.session?.importCookies?.({ cookieHeader: liveCookies, replace: true });
      } catch {
        // Fall back to whatever cookie set the library captured itself.
      }
    }
    // Prefer the ADT close exchange: the legacy ICF logoff can answer 403, and
    // silently ignoring that used to leak the session into SM04.
    const close = await closeAdtSession(client);
    const warning = adtSessionCloseWarning(close, 'after the command');
    if (warning) console.error(`WARN: ${warning}`);
    this.controller.clear();
    const store = this.persistedStore ?? this.writeCandidate;
    if (this.jar && this.key && store) {
      if (reuseIsBlocked(this.jar)) {
        // Persist the pause marker without the now dead session cookies so the
        // next command does not replay them; the pause survives the logout.
        this.jar.cookies = [];
        this.jar.csrf = { value: '', fetchedAt: new Date().toISOString() };
        writeSessionJar(this.jar, this.config.sap, this.key, [store]);
      } else if (this.persisted) {
        clearSessionJars(this.config.sap, [store]);
      }
    }
    this.persistedStore = null;
    this.jar = null;
    this.persisted = false;
    this.freshLogin = false;
    this.reusable = false;
    this.state = 'per-command';
  }
}

function isUnsupported(config: ProjectConfig): boolean {
  return config.sap.systemType === 'cloud' || config.sap.systemType === 'btp';
}

/** Emit a session warning at most once per process (environment properties). */
const warned = new Set<string>();
function warnOnce(code: Parameters<typeof collectWarning>[0], message: string): void {
  if (warned.has(code)) return;
  warned.add(code);
  collectWarning(code, message);
}

/** Test-only: reset the process-level warning guard. */
export function _resetSessionWarnings(): void {
  warned.clear();
}

/** Map a jar-encryption key source to the jar header value. */
export function keyModeForJar(mode: EffectiveSessionKeyMode): SessionKeyMode {
  return mode === 'keychain' || mode === 'derived' ? mode : 'unknown';
}
