/**
 * End-of-command session release policy.
 *
 * `always-logout`: log every live session out (ADT + ICF) when the command
 *           ends; the jar is cleared on logout.
 * `reuse`   (default): keep the session open — the jar persists it so the
 *           next CLI process reuses the same session. As a safety net, a
 *           session this process opened itself but could not persist for
 *           reuse (non-durable key store, unwritable jar) is still released:
 *           otherwise every command of a degraded run would leave one orphan
 *           SAP session behind.
 *
 * `runEndOfCommandCleanup` is called from the `postAction` hook (and from the
 * top-level exit path) and reads the resolved policy once per process.
 *
 * Per-client release lives in `clients/client-lifecycle.ts` with a hard
 * timeout, so a stuck SAP logout can't keep the agent loop blocked.
 */

import { effectivePolicy, resolveSessionPolicy } from './policy.js';
import { drainClients, drainUnreusableClients } from './registry.js';

let policyChecked = false;

/**
 * Release sessions according to the effective policy: everything under
 * `always-logout`, and under `reuse` only the sessions that cannot be
 * reused by the next command. Idempotent: after the first call the registry
 * no longer holds the released clients.
 */
export async function runEndOfCommandCleanup(config: Parameters<typeof resolveSessionPolicy>[0]): Promise<void> {
  if (policyChecked) return;
  policyChecked = true;
  const policy = effectivePolicy(resolveSessionPolicy(config));
  if (policy === 'always-logout') {
    await drainClients({ adt: true, icf: true });
    return;
  }
  await drainUnreusableClients();
}

/** Test-only: reset the module-level guard between cases. */
export function _resetPolicyGuard(): void {
  policyChecked = false;
}
