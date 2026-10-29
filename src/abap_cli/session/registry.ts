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
 *
 * The actual per-client shutdown lives in `clients/client-lifecycle.ts`
 * (which applies a fixed timeout so a stuck SAP logout never blocks the
 * agent loop). This file is the backwards-compatible facade that maps
 * the ADT (async `logout`) and ICF (sync `cleanup`) shapes onto the
 * shared `CloseableClient` contract.
 */

import {
  _resetLifecycle,
  closeTrackedClients,
  trackClient,
  type CloseableClient,
} from '../clients/client-lifecycle.js';
import type { AdtClientWrapper } from '../clients/adt-client.js';
import type { IcfClient } from '../clients/icf-client.js';

/** ADT adapter: async logout, labelled "adt". */
function toAdtCloseable(client: AdtClientWrapper): CloseableClient {
  return {
    label: 'adt',
    close: async () => {
      try {
        await client.logout();
      } catch {
        // logout is best-effort per client
      }
    },
  };
}

/** ICF adapter: sync cleanup wrapped in a resolved promise, labelled "icf". */
function toIcfCloseable(client: IcfClient): CloseableClient {
  return {
    label: 'icf',
    close: async () => {
      try {
        client.cleanup();
      } catch {
        // cleanup is best-effort per client
      }
    },
  };
}

/** Register a live ADT client for end-of-command logout. */
export function registerAdtClient(client: AdtClientWrapper): void {
  trackClient(toAdtCloseable(client));
}

/** Register a live ICF client for end-of-command cleanup. */
export function registerIcfClient(client: IcfClient): void {
  trackClient(toIcfCloseable(client));
}

/**
 * Best-effort release of every live client. Idempotent — safe to call from
 * `postAction`, an error path, or a signal handler more than once.
 *
 * `opts` selects which kinds to release (`adt` / `icf`, both default on);
 * clients of an excluded kind stay tracked for a later drain.
 */
export async function drainClients(opts: { adt?: boolean; icf?: boolean } = {}): Promise<void> {
  const labels = new Set<string>();
  if (opts.adt ?? true) labels.add('adt');
  if (opts.icf ?? true) labels.add('icf');
  await closeTrackedClients(undefined, labels);
}

/** Test-only: reset the registry between cases. */
export function resetRegistry(): void {
  _resetLifecycle();
}
