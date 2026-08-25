import type { AdtClientWrapper } from '../clients/adt-client.js';
import type { RuntimeProbeResult } from './runtime-probe.js';

/** 034: Spec for an HTTP service registration request. Concrete strategy
 *  implementations (on-prem `cl_icf_tree`, BTP SWB, Cockpit fallback) map
 *  this common shape into their own API call. */
export interface IcfServiceSpec {
  /** Service node name (no leading slash, no path). */
  name: string;
  /** Human-readable description (multilingual leave to the strategy). */
  description: string;
  /** Handler class implementing IF_HTTP_EXTENSION / IF_HTTP_SERVICE_EXTENSION. */
  handler: string;
  /** Service URL path, e.g. `/sap/zabap_vibe`. */
  urlPath: string;
  /** Target state. Strategies may differ in what they actually do (see plan.md). */
  state: 'active' | 'inactive';
  /** Optional transport. On-prem SICF requires one; BTP SWB ignores it. */
  transport?: string;
}

/** What an ICF register call actually did — fed back into deploy summary. */
export interface IcfRegisterOutcome {
  /** success: HTTP service is up; planned: no mutation happened (dry-run);
   *  error: strategy declined or failed. */
  status: 'success' | 'planned' | 'error';
  /** Concrete action when status === 'success'. */
  action?: 'created' | 'updated' | 'already_active';
  /** True when the strategy reports the service node is reachable. */
  active?: boolean;
  /** Hint surfaced as `STEAMPUNK_ICF_MANUAL` etc. when status === 'planned'. */
  hint?: string[];
  /** Strategy identifier — used for diagnostics and tests. */
  strategyId: 'on-prem-cl-icf-tree' | 'steampunk-cockpit-fallback' | 'steampunk-swb';
  /** Populated when status === 'error'. */
  error?: { code: string; message: string };
}

/** 034: contract for runtime-branched HTTP service registration. Each
 *  strategy owns exactly one mutation shape (cl_icf_tree vs SWB vs hint).
 *  Registry maps runtime → strategy; selectIcfStrategy is the only public
 *  dispatch path. */
export interface IcfRegisterStrategy {
  /** Strategy id — surfaced in `IcfRegisterOutcome.strategyId`. */
  readonly id: IcfRegisterOutcome['strategyId'];
  /** True when this strategy can service the runtime + capability combination.
   *  The probe may run a lightweight ADT call (e.g. class existence check). */
  supports(probe: RuntimeProbeResult): boolean;
  /** Register the HTTP service. May be a no-op that returns `planned`
   *  (e.g. dry-run). Must never throw on user-visible failures — wrap in
   *  `IcfRegisterOutcome` with `status: 'error'` instead. */
  register(client: AdtClientWrapper, spec: IcfServiceSpec): Promise<IcfRegisterOutcome>;
}