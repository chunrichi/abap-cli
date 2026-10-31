import * as tls from 'node:tls';
import type { ADTClient } from 'abap-adt-api';
import { getSystem, upsertSystem } from '../config/user-config.js';
import { getPassword } from '../config/secrets.js';
import { readCaCertificate, type SapConfig } from '../config/project-config.js';
import { assertSupportedAuth } from '../config/validation.js';
import { CliError } from '../output/json.js';
import { classifyHttpError } from './http-error.js';
import { buildBasicAuth } from './basic-auth.js';
import { ICF_BASE_PATH } from './icf-version.js';
import { withRawAdtSession } from './raw-adt-session.js';

/** Per-layer result of `profile test <name>`. */
export interface ProbeLayerResult {
  ok: boolean;
  /** True when the layer was not run because a prerequisite failed. */
  skipped?: boolean;
  error?: { code: string; message: string };
  nextSteps?: string[];
}

/** per-type capability snapshot surfaced in `profile test`.
 *  Each subject has three orthogonal bits: ADT reachability, ICF reachability,
 *  and whether the system is *intrinsically* able to host that object type. */
export interface ProfileCapabilitySnapshot {
  ttyp: { adt: 'ok' | 'absent'; icf: 'ok' | 'absent'; supported: boolean };
  msag: { adt: 'ok' | 'absent'; icf: 'ok' | 'absent'; supported: boolean };
  ddls: { adt: 'ok' | 'absent'; icf: 'ok' | 'absent'; supported: boolean };
}

export interface SystemProbe {
  tls: ProbeLayerResult;
  auth: ProbeLayerResult;
  adt: ProbeLayerResult;
  icf: ProbeLayerResult;
  /** per-type capability matrix. Empty only when adt.icf
   *  both failed and we couldn't run any type-level probe. */
  capabilities?: ProfileCapabilitySnapshot;
  /** shortcut for DDLS — `true` iff the system can host CDS / DDL sources.
   *  Mirrors `capabilities.ddls.supported` but is promoted to top-level so
   *  agent-side greppers have a one-stop field. */
  ddlSourceSupported?: boolean;
}

/** Probe-only config — the subset of a profile needed to log in and probe. */
interface ProbeConfig {
  url: string;
  client: string;
  username: string;
  language: string;
  password: string;
  insecure: boolean;
  /** PEM content (loaded from the profile's caPath). */
  caPem?: string;
}

const SKIP = (): ProbeLayerResult => ({
  ok: false,
  skipped: true,
  error: { code: 'SKIPPED', message: 'Skipped because a prerequisite layer failed.' },
});

/**
 * Probe a named system profile across four layers: tls → auth → adt → icf.
 * Layers are skipped when their prerequisite fails. Never throws for probe
 * failures — each layer reports its own ok/error/nextSteps.
 */
export async function probeSystem(name: string): Promise<SystemProbe> {
  const profile = getSystem(name);
  if (!profile) {
    throw new CliError('CONFIG_ERROR', `Connection profile '${name}' not found.`, {
      nextSteps: [`Run 'abap profile add ${name} --url <url> --username <user>' to create the profile.`],
      example: `abap profile set ${name} --url <url> --username <user> --password <pass>`,
    });
  }
  assertSupportedAuth(name, profile);
  const config: ProbeConfig = {
    url: profile.url,
    client: profile.client || '100',
    username: profile.username,
    language: profile.language || 'EN',
    password: (await getPassword(name)) || '',
    insecure: profile.insecure ?? process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0',
    caPem: readCaCertificate(profile.ca || ''),
  };

  const tlsResult = await probeTls(config);
  if (!tlsResult.ok) {
    return { tls: tlsResult, auth: SKIP(), adt: SKIP(), icf: SKIP() };
  }

  // One stateful ADT session serves every layer below: the login is the auth
  // probe, and the same client answers the adt/icf endpoint probes plus the
  // per-type capability matrix. `withRawAdtSession` releases the SAP session
  // on every exit path — a probe is the easiest place to leak an SM04 entry.
  let auth: { password: string; options: import('abap-adt-api').ClientOptions };
  try {
    auth = buildBasicAuth(buildProbeSap(config));
  } catch (error: unknown) {
    const classified = classifyHttpError(error, { name });
    return {
      tls: tlsResult,
      auth: { ok: false, error: { code: classified.code, message: classified.message }, nextSteps: classified.nextSteps },
      adt: SKIP(),
      icf: SKIP(),
    };
  }

  try {
    return await withRawAdtSession(
      {
        url: config.url,
        username: config.username,
        password: auth.password,
        client: config.client,
        language: config.language,
        options: auth.options,
      },
      async (client) => {
        const authResult: ProbeLayerResult = { ok: true };
        const adtResult = await probeEndpoint(name, client, {
          path: '/sap/bc/adt/discovery',
          accept: 'application/atomsvc+xml',
        });
        const icfResult = await probeEndpoint(name, client, {
          path: `${ICF_BASE_PATH}/`,
          accept: 'application/json',
        });
        // per-type capability snapshot — only when ADT/ICF both finished
        // probing (else we cannot tell "absent" from "skipped").
        const probeOut = adtResult.ok || icfResult.ok
          ? await probeCapabilities(client, { adtOk: adtResult.ok, icfOk: icfResult.ok })
          : undefined;
        const capabilities = probeOut?.capabilities;
        // persist the discovered kernel release back into the profile so that
        // channel-detect (which reads cfg.systemVersion) can route
        // TTYP/MSAG/DDLS without re-probing. Best-effort: missing or
        // unparseable release leaves the profile untouched.
        if (probeOut?.kernelRelease) {
          try {
            upsertSystem(name, { ...profile, systemVersion: probeOut.kernelRelease });
          } catch {
            // Persist is best-effort — probe output still surfaces below.
          }
        }
        return {
          tls: tlsResult,
          auth: authResult,
          adt: adtResult,
          icf: icfResult,
          ...(capabilities ? { capabilities, ddlSourceSupported: capabilities.ddls.supported } : {}),
        };
      },
    );
  } catch (error: unknown) {
    // Login (or session open) failed: report it as the auth layer and skip
    // the dependent layers, exactly like a failed TLS handshake.
    const classified = classifyHttpError(error, { name });
    return {
      tls: tlsResult,
      auth: { ok: false, error: { code: classified.code, message: classified.message }, nextSteps: classified.nextSteps },
      adt: SKIP(),
      icf: SKIP(),
    };
  }
}

/** probe the four per-type endpoints.
 *
 * Strategy: hit each ADT/ICF endpoint with a HEAD-ish GET and watch the
 * HTTP status code (401 / 404 are fine — they prove the endpoint exists on
 * this SAP system; only 5xx or unreachable means "absent"). Errors never
 * throw; we surface "absent" so a non-supported ECC release still reports
 * a usable capabilities matrix.
 *
 * Also returns the discovered kernel release (via readKernelRelease) so the
 * caller can persist it on the profile and downstream channel-detect can
 * make its decision without re-probing.
 */
async function probeCapabilities(
  client: ADTClient,
  state: { adtOk: boolean; icfOk: boolean },
): Promise<{ capabilities: ProfileCapabilitySnapshot; kernelRelease?: string }> {
  const probeUrl = async (path: string): Promise<'ok' | 'absent'> => {
    try {
      // `request` returns a response with statusCode (4xx == present, 5xx/none == absent).
      const resp = await client.httpClient.request(path, {
        method: 'GET',
        headers: { Accept: 'application/xml' },
      }).catch((err: unknown) => ({ statusCode: 0, error: err }));
      const code = (resp as { status?: number }).status ?? 0;
      if (code >= 200 && code < 500) return 'ok';
      return 'absent';
    } catch {
      return 'absent';
    }
  };
  const adtProbe = state.adtOk
    ? {
        ttyp: await probeUrl('/sap/bc/adt/ddic/tabletypes/LVC_T_TABL'),
        msag: await probeUrl('/sap/bc/adt/messageclass/SADT_TOOLS_CORE'),
        ddls: await probeUrl('/sap/bc/adt/ddic/ddl/sources/I_ABAPAPPLICATIONCOMPONENT'),
      }
    : { ttyp: 'absent' as const, msag: 'absent' as const, ddls: 'absent' as const };
  const icfProbe = state.icfOk
    ? {
        ttyp: await probeUrl(`${ICF_BASE_PATH}/ddic/ttyp/LVC_T_TABL`),
        msag: await probeUrl(`${ICF_BASE_PATH}/ddic/msag/SADT_TOOLS_CORE`),
        // DDLS has no ICF handler on purpose — always absent.
        ddls: 'absent' as const,
      }
    : { ttyp: 'absent' as const, msag: 'absent' as const, ddls: 'absent' as const };

  // `supported` is intrinsic to the system; for the heuristic we treat
  // modern kernels (>= 753) or S/4HANA as supporting DDLS. For the live
  // ADT endpoint to register "ok", we already trust the kernel.
  const supportedByKernel = await readKernelRelease(client);
  const ddlsIntrinsic = supportedByKernel === undefined
    ? false
    : supportedByKernel === 'S4' || !isEccOldRelease(supportedByKernel);
  return {
    capabilities: {
      ttyp: { adt: adtProbe.ttyp, icf: icfProbe.ttyp, supported: true },
      msag: { adt: adtProbe.msag, icf: icfProbe.msag, supported: true },
      ddls: { adt: adtProbe.ddls, icf: icfProbe.ddls, supported: ddlsIntrinsic },
    },
    kernelRelease: supportedByKernel,
  };
}

/** Best-effort kernel release probe without a runtime library dependency.
 *  Falls back to undefined when the SAP release isn't reachable. */
async function readKernelRelease(client: ADTClient): Promise<string | undefined> {
  try {
    // ADT /sap/bc/adt/system/information returns an Atom feed with one
    // <atom:entry> per system property; the KernelRelease entry carries
    // e.g. "793" or "S4". The older <app:release> tag in /sap/bc/adt/discovery
    // was removed in newer kernels, so we go to system-information for a
    // stable read.
    const raw = (await client.httpClient.request('/sap/bc/adt/system/information', {
      method: 'GET',
      headers: { Accept: 'application/atom+xml;type=feed' },
    })) as { body?: string };
    const body = raw.body ?? '';
    const m = body.match(/<atom:id>KernelRelease<\/atom:id>\s*<atom:title>([^<]+)<\/atom:title>/i);
    return m?.[1]?.trim();
  } catch {
    return undefined;
  }
}

/** Local copy of the parser — keeping it private avoids a duplicate
 *  `flows/edit/channel-detect.ts` import path that's painful for the CLI's
 *  layer separation (probe lives under clients/, channel-detect under flows/). */
function isEccOldRelease(kernelRelease: string | undefined): boolean {
  if (!kernelRelease) return true;
  const trimmed = kernelRelease.trim().toUpperCase().replace('/', '').replace('.', '');
  if (trimmed === 'S4') return false;
  const parsed = parseInt(trimmed, 10);
  if (Number.isNaN(parsed)) return true;
  return parsed < 753;
}

/** TLS layer — raw handshake for https URLs; http is trivially ok. */
function probeTls(config: ProbeConfig): Promise<ProbeLayerResult> {
  if (!config.url.startsWith('https://')) {
    return Promise.resolve({ ok: true, skipped: true });
  }
  return new Promise((resolve) => {
    let host = '';
    let port = 443;
    try {
      const u = new URL(config.url);
      host = u.hostname;
      port = Number(u.port) || 443;
    } catch {
      resolve({ ok: false, error: { code: 'CONFIG_ERROR', message: `Invalid URL: ${config.url}` } });
      return;
    }
    const socket = tls.connect(
      {
        host,
        port,
        servername: host,
        rejectUnauthorized: !config.insecure,
        ca: config.caPem ? [config.caPem] : undefined,
      },
      () => {
        socket.destroy();
        resolve({ ok: true });
      },
    );
    socket.on('error', (err) => {
      const classified = classifyHttpError(err);
      resolve({
        ok: false,
        error: { code: classified.code, message: classified.message },
        nextSteps: classified.nextSteps,
      });
    });
  });
}

/** Build the SapConfig that `buildBasicAuth` consumes. The CA is passed
 *  through `SapConfig.caPath` only for the probe's TLS layer; login options
 *  come from `insecure`/`caPem`. */
function buildProbeSap(config: ProbeConfig): SapConfig {
  return {
    url: config.url,
    client: config.client,
    username: config.username,
    password: config.password,
    language: config.language,
    insecure: config.insecure,
    caPath: '', // CA goes through options.httpsAgent / tls.connect ca param
    sourceDir: process.cwd(),
  };
}

/**
 * Hit one endpoint on the shared probe client.
 *
 * Uses `httpClient.request` directly so the probe does not depend on
 * abap-adt-api's search/structure parser (which has a known bug on BTP trial
 * when parsing wildcard search responses). Probe failures never throw — the
 * layer reports them.
 */
async function probeEndpoint(
  name: string,
  client: ADTClient,
  endpoint: { path: string; accept: string },
): Promise<ProbeLayerResult> {
  try {
    await client.httpClient.request(endpoint.path, {
      method: 'GET',
      headers: { Accept: endpoint.accept },
    });
    return { ok: true };
  } catch (error: unknown) {
    const classified = classifyHttpError(error, { name });
    return { ok: false, error: { code: classified.code, message: classified.message }, nextSteps: classified.nextSteps };
  }
}
