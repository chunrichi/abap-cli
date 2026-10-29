import { steampunkDeployHint } from '../runtime-probe.js';
import type { AdtClientWrapper } from '../../clients/adt-client.js';
import type { IcfRegisterStrategy, IcfRegisterOutcome, IcfServiceSpec } from '../icf-register-strategy.js';
import type { RuntimeProbeResult } from '../runtime-probe.js';

/** 034: Steampunk Cockpit fallback — preserves the 030 behaviour of
 *  emitting a Cloud Foundry destination hint instead of attempting a
 *  mutation. This is the safe default when no SAP-side API is available
 *  (current BTP trial state — `cl_swb_object` whitelist unknown). */
export class SteampunkCockpitFallbackStrategy implements IcfRegisterStrategy {
  readonly id = 'steampunk-cockpit-fallback' as const;

  supports(probe: RuntimeProbeResult): boolean {
    return probe.runtime === 'steampunk';
  }

  async register(client: AdtClientWrapper, _spec: IcfServiceSpec): Promise<IcfRegisterOutcome> {
    const hint = steampunkDeployHint(client.getConfig().sap.url);
    return {
      status: 'planned',
      strategyId: this.id,
      hint,
    };
  }
}