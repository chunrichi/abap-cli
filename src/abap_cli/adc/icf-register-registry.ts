import type { RuntimeProbeResult } from './runtime-probe.js';
import type { IcfRegisterStrategy, IcfServiceSpec, IcfRegisterOutcome } from './icf-register-strategy.js';
import type { AdtClientWrapper } from '../clients/adt-client.js';

/** 034: runtime → strategy registry. The first strategy whose
 *  `supports(probe)` returns true wins. Insertion order matters: register
 *  more specific strategies (e.g. SWB by capability) before broader
 *  fallbacks (e.g. Cockpit hint). */
const strategies: IcfRegisterStrategy[] = [];

/** 034: register a strategy. Idempotent — re-registering the same id replaces. */
export function registerIcfStrategy(strategy: IcfRegisterStrategy): void {
  const idx = strategies.findIndex((s) => s.id === strategy.id);
  if (idx >= 0) strategies.splice(idx, 1, strategy);
  strategies.push(strategy);
}

/** 034: select a strategy for the probed runtime. Returns the first
 *  matching strategy or `undefined`. Visible for testing only — production
 *  code goes through `executeIcfRegister` which short-circuits to a
 *  safe no-op when no strategy matches. */
export function selectIcfStrategy(probe: RuntimeProbeResult): IcfRegisterStrategy | undefined {
  return strategies.find((s) => s.supports(probe));
}

/** 034: clear all registered strategies. Test helper — production code never
 *  calls this. */
export function _resetIcfStrategiesForTests(): void {
  strategies.length = 0;
}

/** 034: dispatch helper used by `deploy-flow`. The `noop` outcome (status
 *  'planned', strategyId undefined) is returned when no strategy matches
 *  the probe — deploy-flow surfaces this as a generic warning. */
export async function executeIcfRegister(
  client: AdtClientWrapper,
  spec: IcfServiceSpec,
  probe: RuntimeProbeResult,
): Promise<IcfRegisterOutcome> {
  const strategy = selectIcfStrategy(probe);
  if (!strategy) {
    return {
      status: 'planned',
      strategyId: 'steampunk-cockpit-fallback',
      hint: [
        'No ICF register strategy matched the probed runtime; deploy sources only.',
      ],
    };
  }
  return strategy.register(client, spec);
}