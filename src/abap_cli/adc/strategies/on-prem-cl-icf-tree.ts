import { CliError } from '../../output/json.js';
import type { AdtClientWrapper } from '../../clients/adt-client.js';
import type { IcfRegisterStrategy, IcfRegisterOutcome, IcfServiceSpec } from '../icf-register-strategy.js';
import type { RuntimeProbeResult } from '../runtime-probe.js';

/** 034: on-prem `cl_icf_tree` strategy — wraps the existing
 *  `ZCL_ABAP_VIBE_ICF_SETUP` classrun so deploy-flow has a uniform
 *  `register()` call. Supports any runtime whose ICF collection is
 *  available (trial on-prem or NetWeaver). On Steampunk the ICF collection
 *  is hidden, so this strategy returns false from `supports()`. */
export class OnPremClIcfTreeStrategy implements IcfRegisterStrategy {
  readonly id = 'on-prem-cl-icf-tree' as const;

  supports(probe: RuntimeProbeResult): boolean {
    // Either an explicit capability flag (preferred), or any non-steampunk
    // runtime as a conservative fallback (030 contract: unknown → on-prem).
    if (probe.apiCapabilities?.icf.available === true) return true;
    if (probe.runtime === 'netweaver740' || probe.runtime === 'netweaver750') return true;
    if (probe.runtime === 'unknown') return true; // 030 conservative default
    return false;
  }

  async register(_client: AdtClientWrapper, _spec: IcfServiceSpec): Promise<IcfRegisterOutcome> {
    let raw = '';
    try {
      raw = await _client.runClass('ZCL_ABAP_VIBE_ICF_SETUP');
      const parsed = JSON.parse(raw) as {
        status?: string;
        action?: string;
        node?: { active?: boolean };
        error?: { code?: string; message?: string };
      };
      if (parsed.status === 'error') {
        return {
          status: 'error',
          strategyId: this.id,
          error: {
            code: parsed.error?.code ?? 'ICF_SETUP_FAILED',
            message: parsed.error?.message ?? 'classrun reported error',
          },
        };
      }
      return {
        status: 'success',
        action: parsed.action as 'created' | 'updated' | 'already_active',
        active: parsed.node?.active,
        strategyId: this.id,
      };
    } catch (error: unknown) {
      // Non-JSON classrun output or class-not-found; surface as structured error.
      // Preserve the raw classrun text so debugging unparseable responses does
      // not require rerunning the deploy.
      const parserError = error instanceof SyntaxError;
      const message = parserError ? `Unparseable classrun output: ${raw}` : (error instanceof Error ? error.message : String(error));
      const code = parserError ? 'ICF_SETUP_OUTPUT' : (error instanceof CliError ? error.code : 'ICF_SETUP_FAILED');
      return {
        status: 'error',
        strategyId: this.id,
        error: { code, message },
      };
    }
  }
}