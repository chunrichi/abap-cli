import { readCapability } from './textpool-capability.js';

export type TextpoolRoute = 'adt' | 'icf';
export type TextpoolOperation = 'read' | 'write';

/**
 * Mixed-mode routing: reads the cached SystemProfile capability (recorded once at
 * connect/init time) and picks the route DIRECTLY — no runtime probe, no fallback
 * on the fly.
 *
 * Conservative defaults when the profile has no adtTextpool record (not probed):
 *   - read  → ADT (getTextElements works on all systems)
 *   - write → ICF (ECC/older systems lack the ADT write endpoint)
 */
export function routeTextpool(systemName: string, op: TextpoolOperation): TextpoolRoute {
  const cap = readCapability(systemName);
  if (!cap) return op === 'read' ? 'adt' : 'icf';
  if (op === 'read') return cap.read ? 'adt' : 'icf';
  return cap.write ? 'adt' : 'icf';
}
