/**
 * Session policy resolution — three-state machine:
 *   `reuse`           : default; reuse existing cookie jar across commands
 *   `always-logout`   : always call `ADTClient.logout()` at command end
 *   `default`         : resolves to `reuse` (kept as a documented alias
 *                       so .abap.json authors can use either label)
 *
 * Precedence:
 *   1. `process.env.ABAP_CLI_SESSION_POLICY` if set to `reuse` / `always-logout`
 *   2. `SapConfig.sessionPolicy` (workspace .abap.json or profile override)
 *   3. `'default'`
 *
 * Cloud / BTP detection lives here too: the `isCloudOrBtpProfile` helper
 * reads `SapConfig.systemType` and returns true for `cloud` / `btp`,
 * allowing the doctor / AdtClient / IcfClient layers to opt out of cookie
 * reuse without each one re-implementing the rule.
 */

import type { ProjectConfig, SapConfig } from '../config/project-config.js';

export type SessionPolicy = 'reuse' | 'always-logout' | 'default';

export const SESSION_POLICY_ENV = 'ABAP_CLI_SESSION_POLICY';

const VALID_LITERAL: ReadonlySet<string> = new Set(['reuse', 'always-logout']);
const VALID_PROFILE: ReadonlySet<string> = new Set(['reuse', 'always-logout', 'default']);

/** Process-level one-shot guard for the keychain-fallback WARN. */
export const WARN_ONCE_CACHE: Map<string, boolean> = new Map();

/**
 * Resolve the effective session policy for a command. Env var wins.
 * `SapConfig.sessionPolicy` is the canonical user-visible source — callers
 * that want to honor `.abap.json#sap.sessionPolicy` populate it before
 * calling here.
 */
export function resolveSessionPolicy(config: ProjectConfig): SessionPolicy {
  const fromEnv = process.env[SESSION_POLICY_ENV];
  if (fromEnv && VALID_LITERAL.has(fromEnv)) {
    return fromEnv as SessionPolicy;
  }
  if (fromEnv && fromEnv !== 'default') {
    process.stderr.write(
      `WARN session policy: ignoring ${SESSION_POLICY_ENV}=${fromEnv}; expected one of: reuse, always-logout\n`,
    );
  }
  const fromProfile = config.sap.sessionPolicy;
  if (fromProfile && VALID_PROFILE.has(fromProfile)) {
    return fromProfile as SessionPolicy;
  }
  if (fromProfile) {
    process.stderr.write(
      `WARN session policy: ignoring sap.sessionPolicy=${fromProfile}; expected one of: reuse, always-logout, default\n`,
    );
  }
  return 'default';
}

/** Map a policy to its effective behavior. `'default'` aliases `'reuse'`. */
export function effectivePolicy(policy: SessionPolicy): 'reuse' | 'always-logout' {
  return policy === 'always-logout' ? 'always-logout' : 'reuse';
}

/** True for profiles whose system type explicitly opts out of cookie reuse. */
export function isCloudOrBtpProfile(system: SapConfig): boolean {
  return system.systemType === 'cloud' || system.systemType === 'btp';
}

/** True when the given profile should skip cookie reuse entirely. */
export function isUnsupportedInContext(config: ProjectConfig): boolean {
  return isCloudOrBtpProfile(config.sap);
}
