/**
 * End-of-command session release policy.
 *
 * `reuse`   (default): keep the SAP session open — the jar persists it so the
 *           next CLI process reuses the same session. No logout on success.
 * `always-logout`:     log the session out (ADT + ICF) when the command ends,
 *           so no session lingers on SAP. The jar is cleared on logout.
 *
 * `runAlwaysLogoutIfNeeded` is called from the `postAction` hook (and from
 * the top-level exit path) and reads the resolved policy once per process.
 */

import { effectivePolicy, resolveSessionPolicy } from './policy.js';
import { drainClients } from './registry.js';

let policyChecked = false;

/**
 * Drain live clients when the effective policy is `always-logout`. No-op for
 * `reuse` (the default) — sessions are meant to be reused by the next run.
 * Idempotent: after the first drain the registry is empty.
 */
export async function runAlwaysLogoutIfNeeded(config: Parameters<typeof resolveSessionPolicy>[0]): Promise<void> {
  if (policyChecked) return;
  policyChecked = true;
  const policy = effectivePolicy(resolveSessionPolicy(config));
  if (policy === 'always-logout') {
    await drainClients({ adt: true, icf: true });
  }
}

/** Test-only: reset the module-level guard between cases. */
export function _resetPolicyGuard(): void {
  policyChecked = false;
}
