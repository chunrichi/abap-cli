import { describe, expect, it, vi, beforeEach } from 'vitest';

const runClass = vi.fn();
const client = { runClass: (...a: unknown[]) => runClass(...a), getConfig: () => ({ sap: { url: 'https://example.com' } }) };
// The above is a structural stand-in — strategies only need `runClass` and `getConfig`.

import { executeIcfRegister, _resetIcfStrategiesForTests, registerIcfStrategy } from '../../src/abap_cli/adc/icf-register-registry.js';
import { OnPremClIcfTreeStrategy } from '../../src/abap_cli/adc/strategies/on-prem-cl-icf-tree.js';
import { SteampunkCockpitFallbackStrategy } from '../../src/abap_cli/adc/strategies/steampunk-cockpit-fallback.js';
import { SteampunkSwbStrategy } from '../../src/abap_cli/adc/strategies/steampunk-swb.js';
import type { RuntimeProbeResult } from '../../src/abap_cli/adc/runtime-probe.js';

const SPEC = {
  name: 'zabap_vibe',
  description: 'ABAP Vibe - ICF Services',
  handler: 'ZCL_ABAP_VIBE_ICF',
  urlPath: '/sap/zabap_vibe',
  state: 'active' as const,
};

function probe(overrides: Partial<RuntimeProbeResult>): RuntimeProbeResult {
  return {
    runtime: 'unknown',
    source: 'none',
    icfSetupBlocked: false,
    ...overrides,
  };
}

describe('IcfRegisterStrategy registry — 034 strategy dispatch', () => {
  beforeEach(() => {
    _resetIcfStrategiesForTests();
    runClass.mockReset();
  });

  it('selectIcfStrategy prefers SWB when its supports() returns true', async () => {
    const swb = new SteampunkSwbStrategy();
    vi.spyOn(swb, 'supports').mockReturnValue(true);
    registerIcfStrategy(swb);
    registerIcfStrategy(new SteampunkCockpitFallbackStrategy());
    const outcome = await executeIcfRegister(client as never, SPEC, probe({ runtime: 'steampunk' }));
    expect(outcome.strategyId).toBe('steampunk-swb');
  });

  it('on-prem probe → OnPremClIcfTreeStrategy.runClass → success envelope', async () => {
    runClass.mockResolvedValueOnce(JSON.stringify({ status: 'success', action: 'already_active', node: { active: true } }));
    registerIcfStrategy(new OnPremClIcfTreeStrategy());
    const outcome = await executeIcfRegister(client as never, SPEC, probe({ runtime: 'netweaver750' }));
    expect(outcome.status).toBe('success');
    expect(outcome.action).toBe('already_active');
    expect(outcome.active).toBe(true);
    expect(outcome.strategyId).toBe('on-prem-cl-icf-tree');
    expect(runClass).toHaveBeenCalledWith('ZCL_ABAP_VIBE_ICF_SETUP');
  });

  it('on-prem probe → classrun error envelope → structured error outcome', async () => {
    runClass.mockResolvedValueOnce(JSON.stringify({ status: 'error', error: { code: 'ICF_SETUP_FAILED', message: 'nope' } }));
    registerIcfStrategy(new OnPremClIcfTreeStrategy());
    const outcome = await executeIcfRegister(client as never, SPEC, probe({ runtime: 'netweaver750' }));
    expect(outcome.status).toBe('error');
    expect(outcome.error?.code).toBe('ICF_SETUP_FAILED');
    expect(outcome.error?.message).toBe('nope');
  });

  it('on-prem probe → unparseable classrun output → ICF_SETUP_OUTPUT error code', async () => {
    runClass.mockResolvedValueOnce('not json');
    registerIcfStrategy(new OnPremClIcfTreeStrategy());
    const outcome = await executeIcfRegister(client as never, SPEC, probe({ runtime: 'netweaver750' }));
    expect(outcome.status).toBe('error');
    expect(outcome.error?.code).toBe('ICF_SETUP_OUTPUT');
    // 034: preserve the raw classrun text in the message for debugging —
    // the previous behaviour (just `"not json"`) made it impossible to tell
    // whether the JSON parse failure came from a real message or noise.
    expect(outcome.error?.message).toContain('Unparseable classrun output');
    expect(outcome.error?.message).toContain('not json');
  });

  it('Steampunk probe → Cockpit fallback returns planned + Cockpit hint', async () => {
    registerIcfStrategy(new SteampunkCockpitFallbackStrategy());
    const outcome = await executeIcfRegister(client as never, SPEC, probe({ runtime: 'steampunk' }));
    expect(outcome.status).toBe('planned');
    expect(outcome.strategyId).toBe('steampunk-cockpit-fallback');
    expect(outcome.hint).toBeDefined();
    expect(outcome.hint?.join('\n')).toContain('Cloud Foundry');
    // No mutation should have been attempted — classrun must not have run.
    expect(runClass).not.toHaveBeenCalled();
  });

  it('unknown runtime → matches OnPremClIcfTreeStrategy (030 conservative default)', async () => {
    runClass.mockResolvedValueOnce(JSON.stringify({ status: 'success', action: 'created', node: { active: true } }));
    registerIcfStrategy(new OnPremClIcfTreeStrategy());
    const outcome = await executeIcfRegister(client as never, SPEC, probe({ runtime: 'unknown' }));
    expect(outcome.status).toBe('success');
    expect(outcome.strategyId).toBe('on-prem-cl-icf-tree');
  });

  it('matches via apiCapabilities even when runtime is misclassified', () => {
    const onPrem = new OnPremClIcfTreeStrategy();
    const swb = new SteampunkSwbStrategy();
    // Probe says "unknown" but discovery revealed icf=true → on-prem.
    expect(onPrem.supports(probe({ runtime: 'unknown', apiCapabilities: { icf: { available: true }, httpService: { available: false } } }))).toBe(true);
    // SWB matches nothing today (its supports is gated on a future capability).
    expect(swb.supports(probe({ runtime: 'steampunk', apiCapabilities: { icf: { available: false }, httpService: { available: true } } }))).toBe(false);
  });

  it('no strategy registered → planned + generic hint (defensive)', async () => {
    const outcome = await executeIcfRegister(client as never, SPEC, probe({ runtime: 'unknown' }));
    expect(outcome.status).toBe('planned');
    expect(outcome.hint?.[0]).toMatch(/No ICF register strategy/);
  });
});