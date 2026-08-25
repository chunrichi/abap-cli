/**
 * Auth adapter — thin dispatcher that resolves an `AuthStrategy` from the
 * registry and delegates `build()`. All method-specific logic lives in
 * `strategies/<method>.ts`.
 *
 * To add a new auth method:
 *   1. Add the method to `AuthMethodV2` in `v2-types.ts`.
 *   2. Create `strategies/<method>.ts` exporting a `registerStrategy({...})`.
 *   3. Add one side-effect import line below.
 */
import type { BearerFetcher } from 'abap-adt-api/build/AdtHTTP.js';
import type { ClientOptions } from 'abap-adt-api';
import type { SapConfig } from '../config/project-config.js';
import { getStrategy } from './strategy.js';
import type { AuthMethodV2 } from './v2-types.js';

// Side-effect import — registers all built-in strategies. Idempotent.
import './registry-bootstrap.js';

export interface BuiltAuth {
  /** Password literal or async `BearerFetcher` for `new ADTClient(url, user, this, …)`. */
  passwordOrFetcher: string | BearerFetcher;
  /** Extra `ClientOptions` (httpsAgent / headers) merged into ADTClient. */
  options: ClientOptions;
  /** Short machine-readable label for logs / doctor reports. */
  label: string;
}

/**
 * Resolve login artefacts for an `ADTClient` based on `sap.auth.method`.
 * Strategies are looked up via the registry — no method-name dispatch lives
 * in this file.
 */
export async function buildAuth(sap: SapConfig, systemName: string): Promise<BuiltAuth> {
  const parts = await getStrategy(sap.auth.method).build(sap, systemName, sap.auth);
  return { ...parts, label: sap.auth.method as AuthMethodV2 };
}
