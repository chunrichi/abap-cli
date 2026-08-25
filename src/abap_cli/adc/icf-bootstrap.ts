/** 034: side-effect aggregator that wires the built-in ICF register strategies
 *  into the global registry. Imported by `flows/deploy-flow.ts` so the
 *  registration happens exactly once at module load. New strategies land
 *  by adding a register call here — deploy-flow stays unchanged. */
import { registerIcfStrategy } from './icf-register-registry.js';
import { OnPremClIcfTreeStrategy } from './strategies/on-prem-cl-icf-tree.js';
import { SteampunkCockpitFallbackStrategy } from './strategies/steampunk-cockpit-fallback.js';
import { SteampunkSwbStrategy } from './strategies/steampunk-swb.js';

let bootstrapped = false;

export function bootstrapIcfStrategies(): void {
  if (bootstrapped) return;
  bootstrapped = true;
  // Order matters: most specific first. SWB is registered first so that
  // when its `supports()` predicate flips true it wins over the Cockpit
  // fallback without any further code change.
  registerIcfStrategy(new SteampunkSwbStrategy());
  registerIcfStrategy(new OnPremClIcfTreeStrategy());
  registerIcfStrategy(new SteampunkCockpitFallbackStrategy());
}

// Auto-bootstrap on import so deploy-flow does not need to call it explicitly.
// (Side-effect import is intentional — keep deploy-flow side-effect free.)
bootstrapIcfStrategies();