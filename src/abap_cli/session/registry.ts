/**
 * Global live-client registry.
 *
 * The CLI is a short-lived process: one command, one (or a few) ADT / ICF
 * client instances, then exit. To release SAP sessions at command end we
 * need a handle on every client created during the run — without threading
 * `logout()` calls through the 23+ command action bodies.
 *
 * This module is the single registry: `AdtClientWrapper.create()` and
 * `IcfClient.create()` register themselves; the `postAction` hook (and the
 * SIGINT/SIGTERM handlers) drain the registry and call `logout()` /
 * `cleanup()` on whatever is live. Draining is idempotent and never throws.
 */

import type { AdtClientWrapper } from '../clients/adt-client.js';
import type { IcfClient } from '../clients/icf-client.js';

const adtClients: AdtClientWrapper[] = [];
const icfClients: IcfClient[] = [];
let drained = false;

/** Register a live ADT client for end-of-command logout. */
export function registerAdtClient(client: AdtClientWrapper): void {
  adtClients.push(client);
}

/** Register a live ICF client for end-of-command cleanup. */
export function registerIcfClient(client: IcfClient): void {
  icfClients.push(client);
}

/**
 * Best-effort release of every live client. Idempotent — safe to call from
 * `postAction`, an error path, or a signal handler more than once.
 */
export async function drainClients(opts: { adt?: boolean; icf?: boolean } = {}): Promise<void> {
  const doAdt = opts.adt ?? true;
  const doIcf = opts.icf ?? true;
  if (doAdt) {
    const list = adtClients.splice(0);
    await Promise.all(
      list.map(async (c) => {
        try {
          await c.logout();
        } catch {
          // logout is best-effort per client
        }
      }),
    );
  }
  if (doIcf) {
    const list = icfClients.splice(0);
    for (const c of list) {
      try {
        c.cleanup();
      } catch {
        // cleanup is best-effort per client
      }
    }
  }
  if (adtClients.length === 0 && icfClients.length === 0) drained = true;
}

/** True after every registered client has been drained once. */
export function isDrained(): boolean {
  return drained;
}

/** Test-only: reset the registry between cases. */
export function resetRegistry(): void {
  adtClients.length = 0;
  icfClients.length = 0;
  drained = false;
}
