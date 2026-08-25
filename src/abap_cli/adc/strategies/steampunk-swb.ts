import type { AdtClientWrapper } from '../../clients/adt-client.js';
import type { IcfRegisterStrategy, IcfRegisterOutcome, IcfServiceSpec } from '../icf-register-strategy.js';
import type { RuntimeProbeResult } from '../runtime-probe.js';

/** 034: Steampunk SWB strategy — placeholder for the future path that
 *  goes through `cl_swb_object` (either via a new ABAP classrun wrapper or
 *  directly via `/sap/bc/adt/ucon/httpservices` once SAP documents the
 *  request body schema). Today the strategy matches nothing — BTP trial
 *  POST returns 500 SY530 (schema un-documented) and PUT requires
 *  S_ABPLNGVS which trial developer users lack. Keep the class as a
 *  documented extension point; registry-bootstrap wires it as the
 *  preferred strategy when its `supports()` flips to true. */
export class SteampunkSwbStrategy implements IcfRegisterStrategy {
  readonly id = 'steampunk-swb' as const;

  supports(probe: RuntimeProbeResult): boolean {
    // 034: gated on capability evidence. We require an explicit
    //  `httpService.available === true` AND a verified POST mime; neither
    //  is currently produced by the discovery probe (the API exists but
    //  POST fails SY530 on every documented body). When the probe gains a
    //  POST round-trip that succeeds (200/201), update this predicate.
    return false;
  }

  async register(_client: AdtClientWrapper, _spec: IcfServiceSpec): Promise<IcfRegisterOutcome> {
    return {
      status: 'error',
      strategyId: this.id,
      error: {
        code: 'STEAMPUNK_SWB_NOT_AVAILABLE',
        message: 'Steampunk SWB register path not yet wired up; falling back to Cockpit hint.',
      },
    };
  }
}