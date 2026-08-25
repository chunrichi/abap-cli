import { getSystem } from '../config/user-config.js';
import { getPassword } from '../config/secrets.js';
import { readCaCertificate, type SapConfig } from '../config/project-config.js';
import { CliError } from '../output/json.js';
import { buildAuth } from '../auth/adapter.js';

/** ADT runtime tier detected from public discovery endpoints (030).
 *  Drives deploy-flow branching and surfaces the runtime on `profile test`
 *  JSON so agents can adapt without trial-and-error. */
export type AdtRuntime = 'netweaver740' | 'netweaver750' | 'steampunk' | 'unknown';

export interface RuntimeProbeResult {
  runtime: AdtRuntime;
  /** Source endpoint(s) that yielded the verdict (debug / hint). */
  source: 'informationsystem' | 'discovery' | 'none';
  /** True when the system blocks `cl_icf_tree` (Steampunk always; older NW never). */
  icfSetupBlocked: boolean;
  /** Optional raw `sap-component` value seen in Atom XML, for diagnostics. */
  sapComponent?: string;
  /** Optional release string (`sap:rel`) when the Atom XML exposes it. */
  release?: string;
  error?: { code: string; message: string };
}

/**
 * Probe the target SAP system's ADT runtime tier.
 *
 * Two-step heuristic that never throws for probe failures:
 *   1. GET `/sap/bc/adt/repository/informationsystem` (Atom XML). The Atom
 *      `<service>` / `<workspace>` elements carry `sap-component` + `sap:rel`.
 *      Steampunk responses include `BTP` / `SAPBTP`; S/4HANA on-prem `S4CORE`;
 *      classic ECC `BASIS` / `NW` / `SAP_ABA`.
 *   2. If (1) is inconclusive (network 404 / non-Atom / unknown component),
 *      fall back to `/sap/bc/adt/discovery` and check whether the Atom
 *      workspace declares a `sap/bc/adt/icf` collection. Classic NW exposes
 *      it; Steampunk hides it.
 *
 * Returns `runtime: 'unknown'` when neither endpoint yields a verdict; the
 * caller treats this as "assume on-prem behaviour".
 */
export async function probeAdtRuntime(profileName: string): Promise<RuntimeProbeResult> {
  const profile = getSystem(profileName);
  if (!profile) {
    return {
      runtime: 'unknown',
      source: 'none',
      icfSetupBlocked: false,
      error: { code: 'CONFIG_ERROR', message: `Connection profile '${profileName}' not found.` },
    };
  }
  const password = (await getPassword(profileName)) || '';
  const sap: SapConfig = {
    url: profile.url,
    client: profile.client || '100',
    username: profile.username,
    password,
    language: profile.language || 'EN',
    insecure: profile.insecure ?? process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0',
    caPath: profile.ca || '',
    auth: profile.auth,
    sourceDir: process.cwd(),
  };
  let built;
  try {
    built = await buildAuth(sap, profileName);
  } catch (error) {
    return {
      runtime: 'unknown',
      source: 'none',
      icfSetupBlocked: false,
      error: { code: 'AUTH_ERROR', message: error instanceof Error ? error.message : String(error) },
    };
  }
  const { passwordOrFetcher, options } = built;
  try {
    const { ADTClient } = await import('abap-adt-api');
    const client = new ADTClient(
      profile.url,
      profile.username,
      passwordOrFetcher,
      profile.client || '100',
      profile.language || 'EN',
      options,
    );
    await client.login();

    // Step 1: informationsystem Atom XML
    let infoXml: string;
    try {
      const resp = await client.httpClient.request('/sap/bc/adt/repository/informationsystem', {
        method: 'GET',
        headers: { Accept: 'application/atomsvc+xml' },
      });
      infoXml = extractBody(resp);
    } catch (error) {
      // Step 2: discovery collection membership
      return await probeFromDiscovery(client);
    }
    const infoVerdict = classifyInformationsystem(infoXml);
    if (infoVerdict.runtime !== 'unknown') {
      return infoVerdict;
    }
    return await probeFromDiscovery(client);
  } catch (error) {
    return {
      runtime: 'unknown',
      source: 'none',
      icfSetupBlocked: false,
      error: { code: 'SAP_ERROR', message: error instanceof Error ? error.message : String(error) },
    };
  }
}

function classifyInformationsystem(xml: string): RuntimeProbeResult {
  const lower = xml.toLowerCase();
  let sapComponent: string | undefined;
  const compMatch = /sap-component\s*=\s*"([^"]+)"/i.exec(xml);
  if (compMatch) sapComponent = compMatch[1];
  const relMatch = /sap:rel\s*=\s*"([^"]+)"/i.exec(xml);
  const release = relMatch ? relMatch[1] : undefined;

  // Steampunk / BTP ABAP environment.
  // Verified 2026-08-25: BTP trial's /sap/bc/adt/repository/informationsystem
  // returns 404, so this branch mostly fires on hypothetical future BTP
  // variants that expose sap-component. Still keep the keywords broad.
  if (
    sapComponent &&
    /(BTP|SAPBTP|ABAPENV|Steampunk)/i.test(sapComponent)
  ) {
    return {
      runtime: 'steampunk',
      source: 'informationsystem',
      icfSetupBlocked: true,
      sapComponent,
      release,
    };
  }
  if (/(steampunk|sapbtp|abap[\s_-]?env|hana\.ondemand)/i.test(lower)) {
    return {
      runtime: 'steampunk',
      source: 'informationsystem',
      icfSetupBlocked: true,
      sapComponent,
      release,
    };
  }

  // S/4HANA on-prem (>= NW 7.50 double-track era)
  if (sapComponent && /S4CORE/i.test(sapComponent)) {
    return {
      runtime: 'netweaver750',
      source: 'informationsystem',
      icfSetupBlocked: false,
      sapComponent,
      release,
    };
  }

  // Classic ECC / NW 7.40 family
  if (sapComponent && /(BASIS|NW|SAP_ABA|ECC)/i.test(sapComponent)) {
    return {
      runtime: 'netweaver740',
      source: 'informationsystem',
      icfSetupBlocked: false,
      sapComponent,
      release,
    };
  }

  return {
    runtime: 'unknown',
    source: 'informationsystem',
    icfSetupBlocked: false,
    sapComponent,
    release,
  };
}

async function probeFromDiscovery(client: unknown): Promise<RuntimeProbeResult> {
  const c = client as { httpClient: { request: (path: string, opts: { method: string; headers: Record<string, string> }) => Promise<unknown> } };
  let discXml: string;
  try {
    const resp = await c.httpClient.request('/sap/bc/adt/discovery', {
      method: 'GET',
      headers: { Accept: 'application/atomsvc+xml' },
    });
    discXml = extractBody(resp);
  } catch (error) {
    return {
      runtime: 'unknown',
      source: 'none',
      icfSetupBlocked: false,
      error: { code: 'SAP_ERROR', message: error instanceof Error ? error.message : String(error) },
    };
  }
  // /sap/bc/adt/icf collection is the legacy SICF admin API. Classic on-prem
  // (NW 7.40 + S/4HANA on-prem) always exposes it; Steampunk hides it because
  // CL_ICF_TREE is not in the Released APIs whitelist. This is the strongest
  // single signal we have from the discovery endpoint.
  const hasIcfCollection = /href\s*=\s*"[^"]*\/sap\/bc\/adt\/icf\//i.test(discXml);
  // Steampunk markers observed in real BTP trial responses (verified 2026-08-25):
  //   - "Steampunk" / "steampunk" — appears in collection paths like
  //     /sap/bc/adt/aps/cloud/com/sco1/steampunkAllowedInst/values
  //   - "hana.ondemand" — BTP ABAP environment URL pattern
  //   - "abap-env" / "ABAPENV" — Steampunk sap-component namespace
  const hasSteampunkMarker =
    /steampunk/i.test(discXml) ||
    /hana\.ondemand\.com/i.test(discXml) ||
    /sapbtp|abap[\s_-]?env/i.test(discXml);
  if (hasSteampunkMarker && !hasIcfCollection) {
    return {
      runtime: 'steampunk',
      source: 'discovery',
      icfSetupBlocked: true,
    };
  }
  if (hasIcfCollection) {
    return {
      runtime: 'netweaver750',
      source: 'discovery',
      icfSetupBlocked: false,
    };
  }
  // No ICF collection AND no Steampunk marker — ambiguous. Stay conservative
  // and report unknown so deploy-flow falls back to on-prem behaviour (the
  // cl_icf_tree failure mode is loud enough to surface as a runtime error).
  return {
    runtime: 'unknown',
    source: 'discovery',
    icfSetupBlocked: false,
  };
}

/** Pull a printable body from the abap-adt-api httpClient response. */
function extractBody(resp: unknown): string {
  if (resp == null) return '';
  if (typeof resp === 'string') return resp;
  const obj = resp as { body?: unknown; data?: unknown; text?: unknown };
  for (const key of ['body', 'data', 'text']) {
    const v = obj[key as keyof typeof obj];
    if (typeof v === 'string') return v;
    if (v && typeof v === 'object' && 'toString' in (v as object)) {
      const s = (v as { toString(): string }).toString();
      if (s && s !== '[object Object]') return s;
    }
  }
  return '';
}

/**
 * Build the structured `nextSteps` for Steampunk users who just ran
 * `extension deploy` (030). The hint walks through the BTP Cockpit
 * destination + route setup so the ICF handler is reachable end-to-end.
 */
export function steampunkDeployHint(systemUrl: string): string[] {
  const trimmed = systemUrl.replace(/\/+$/, '');
  return [
    `On BTP ABAP environment the traditional SICF service node cannot be created automatically (CL_ICF_TREE is not released).`,
    `Expose ZCL_ABAP_VIBE_ICF via a Cloud Foundry destination:`,
    `  1. SAP BTP Cockpit → Cloud Foundry → your space → your ABAP trial`,
    `  2. Connectivity → Destinations → New Destination:`,
    `       Name:           zabap_vibe`,
    `       Type:           HTTP`,
    `       URL:            ${trimmed}/sap/zabap_vibe`,
    `       ProxyType:      Internet`,
    `       Authentication: NoAuthentication (or per your security policy)`,
    `  3. Verify:   curl ${trimmed}/sap/zabap_vibe/   → {"service":"zabap_vibe","version":"0.5.0",…}`,
    `  4. (Optional) bind a route:  cf map-route <app> <domain> --path zabap_vibe`,
  ];
}

// Re-export so deploy-flow can reach CliError if it ever needs to short-circuit.
export { CliError };