import * as fs from 'fs';
import * as tls from 'tls';
import type { ClientOptions } from 'abap-adt-api';
import { getSystem, upsertSystem } from '../config/user-config.js';
import { getPassword } from '../config/secrets.js';
import { readCaCertificate, type SapConfig } from '../config/project-config.js';
import { CliError } from '../output/json.js';
import { classifyHttpError } from './http-error.js';
import { buildAuth } from '../auth/adapter.js';
import type { AuthConfig, AuthMethodV2 } from '../auth/v2-types.js';
import { defaultCookieFile as defaultCookieFileFor, readCookieStore } from '../auth/sso-cookie.js';

/** Per-layer result of `profile test <name>`. */
export interface ProbeLayerResult {
  ok: boolean;
  /** True when the layer was not run because a prerequisite failed. */
  skipped?: boolean;
  error?: { code: string; message: string };
  nextSteps?: string[];
  /** Auth strategy that was actually attempted. */
  authMethod?: AuthMethodV2;
}

/** 036-ttyp-msag-ddls: per-type capability snapshot surfaced in `profile test`.
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
  /** 036-ttyp-msag-ddls: per-type capability matrix. Empty only when adt.icf
   *  both failed and we couldn't run any type-level probe. */
  capabilities?: ProfileCapabilitySnapshot;
  /** 036: shortcut for DDLS — `true` iff the system can host CDS / DDL sources.
   *  Mirrors `capabilities.ddls.supported` but is promoted to top-level per
   *  SC-008 so agent-side greppers have a one-stop field. */
  ddlSourceSupported?: boolean;
}

/**
 * Probe-only config. Carries the canonical `AuthConfig` straight from
 * `SystemProfile.auth` so adding a new auth method does NOT require editing
 * this file's per-method spread (only the registry needs to know about the
 * new method).
 */
interface ProbeConfig {
  url: string;
  client: string;
  username: string;
  language: string;
  password: string;
  insecure: boolean;
  /** PEM content (loaded from the profile's caPath or cert-level caPath). */
  caPem?: string;
  auth: AuthConfig;
  /** Convenience accessor — keeps call-sites concise. */
  readonly authMethod: AuthMethodV2;
}

const SKIP = (authMethod?: AuthMethodV2): ProbeLayerResult => ({
  ok: false,
  skipped: true,
  error: { code: 'SKIPPED', message: 'Skipped because a prerequisite layer failed.' },
  authMethod,
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
  const password = (await getPassword(name)) || '';
  const authMethod: AuthMethodV2 = profile.auth.method;
  const auth: AuthConfig = profile.auth;
  const config: ProbeConfig = {
    url: profile.url,
    client: profile.client || '100',
    username: profile.username,
    language: profile.language || 'EN',
    password,
    insecure: profile.insecure ?? process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0',
    caPem: readCaCertificate(profile.ca || ''),
    auth,
    get authMethod() { return auth.method; },
  };

  const tlsResult = await probeTls(name, config);
  const authResult = tlsResult.ok ? await probeAuth(name, config) : SKIP(authMethod);
  const adtResult = authResult.ok ? await probeAdt(name, config) : SKIP(authMethod);
  const icfResult = authResult.ok ? await probeIcf(name, config) : SKIP(authMethod);
  // 036-ttyp-msag-ddls: per-type capability snapshot — only when ADT/ICF
  // both finished probing (else we cannot tell "absent" from "skipped").
  const probeOut = adtResult.ok || icfResult.ok
    ? await probeCapabilities(config, { adtOk: adtResult.ok, icfOk: icfResult.ok })
    : undefined;
  const capabilities = probeOut?.capabilities;
  // 036: persist the discovered kernel release back into the profile so that
  // channel-detect (which reads cfg.systemVersion) can route TTYP/MSAG/DDLS
  // without re-probing. Best-effort: missing or unparseable release leaves
  // the profile untouched. SC-008 contract.
  if (probeOut?.kernelRelease) {
    try {
      upsertSystem(name, { ...profile, systemVersion: probeOut.kernelRelease });
    } catch {
      // Persist is best-effort — probe output still surfaces below.
    }
  }
  return {
    tls: { ...tlsResult, authMethod },
    auth: { ...authResult, authMethod },
    adt: { ...adtResult, authMethod },
    icf: { ...icfResult, authMethod },
    ...(capabilities ? { capabilities, ddlSourceSupported: capabilities.ddls.supported } : {}),
  };
}

/** 036-ttyp-msag-ddls: probe the four per-type endpoints.
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
  config: ProbeConfig,
  state: { adtOk: boolean; icfOk: boolean },
): Promise<{ capabilities: ProfileCapabilitySnapshot; kernelRelease?: string }> {
  const probeUrl = async (path: string): Promise<'ok' | 'absent'> => {
    try {
      const { ADTClient } = await import('abap-adt-api');
      const auth = await buildAuthForProbe(config.username, config);
      const client = new ADTClient(
        config.url,
        config.username,
        auth.passwordOrFetcher,
        config.client,
        config.language,
        auth.options,
      );
      await client.login();
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
        ttyp: await probeUrl('/sap/zabap_vibe/ddic/ttyp/LVC_T_TABL'),
        msag: await probeUrl('/sap/zabap_vibe/ddic/msag/SADT_TOOLS_CORE'),
        // DDLS has no ICF handler on purpose — always absent.
        ddls: 'absent' as const,
      }
    : { ttyp: 'absent' as const, msag: 'absent' as const, ddls: 'absent' as const };

  // `supported` is intrinsic to the system; for the heuristic we treat
  // modern kernels (>= 753) or S/4HANA as supporting DDLS. For the live
  // ADT endpoint to register "ok", we already trust the kernel.
  const supportedByKernel = await readKernelRelease(config);
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
async function readKernelRelease(config: ProbeConfig): Promise<string | undefined> {
  try {
    const { ADTClient } = await import('abap-adt-api');
    const auth = await buildAuthForProbe(config.username, config);
    const client = new ADTClient(
      config.url,
      config.username,
      auth.passwordOrFetcher,
      config.client,
      config.language,
      auth.options,
    );
    await client.login();
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

/** TLS layer — raw handshake for https URLs; http is trivially ok.
 *  For cert profiles we fail-fast when the cert / key files are missing —
 *  the runtime would just throw the same error later, but we surface it
 *  during probe so `profile test` is informative.
 *  For browser_sso profiles we fail-fast when the cookie jar is missing
 *  or expired — same reason.
 */
function probeTls(name: string, config: ProbeConfig): Promise<ProbeLayerResult> {
  if (config.auth.method === 'browser_sso') {
    const cookieFile = config.auth.sso.cookieFile || defaultCookieFileFor(name);
    const store = readCookieStore(cookieFile);
    if (!store) {
      return Promise.resolve({
        ok: false,
        error: {
          code: 'AUTH_ERROR',
          message: fs.existsSync(cookieFile)
            ? `SSO cookies for '${name}' are missing or expired (TTL 30 min).`
            : `SSO cookie file not found at '${cookieFile}'.`,
        },
        nextSteps: [`abap profile login ${name}`],
        authMethod: config.authMethod,
      });
    }
  }
  if (config.auth.method === 'cert') {
    const cert = config.auth.cert;
    const missing: string[] = [];
    if (!cert.certPath || !fs.existsSync(cert.certPath)) {
      missing.push(`certPath='${cert.certPath || ''}' (not found)`);
    }
    if (!cert.keyPath || !fs.existsSync(cert.keyPath)) {
      missing.push(`keyPath='${cert.keyPath || ''}' (not found)`);
    }
    if (missing.length > 0) {
      return Promise.resolve({
        ok: false,
        error: {
          code: 'CONFIG_ERROR',
          message: `cert auth pre-flight failed for '${name}': ${missing.join('; ')}.`,
        },
        nextSteps: [
          `abap profile set ${name} --auth-method cert --cert-path /abs/cert.pem --cert-key /abs/key.pem`,
        ],
        authMethod: config.authMethod,
      });
    }
  }
  if (!config.url.startsWith('https://')) {
    return Promise.resolve({ ok: true, skipped: true, authMethod: config.authMethod });
  }
  return new Promise((resolve) => {
    let host = '';
    let port = 443;
    try {
      const u = new URL(config.url);
      host = u.hostname;
      port = Number(u.port) || 443;
    } catch {
      resolve({ ok: false, error: { code: 'CONFIG_ERROR', message: `Invalid URL: ${config.url}` }, authMethod: config.authMethod });
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
        authMethod: config.authMethod,
      });
    });
  });
}

/** Build the SapConfig that `buildAuth` consumes — reuses the canonical
 * type so probe and runtime agree on every field. `auth` is taken verbatim
 * from `ProbeConfig` (which already carries the canonical AuthConfig), so
 * adding a new method does not require editing this function. */
function buildProbeSap(_name: string, config: ProbeConfig): SapConfig {
  return {
    url: config.url,
    client: config.client,
    username: config.username,
    password: config.password,
    language: config.language,
    insecure: config.insecure,
    caPath: '', // CA goes through options.httpsAgent / tls.connect ca param
    auth: config.auth,
    sourceDir: process.cwd(),
  };
}

/** Resolve adapter artefacts for probe use. */
async function buildAuthForProbe(name: string, config: ProbeConfig): Promise<{
  passwordOrFetcher: string | (() => Promise<string>);
  options: ClientOptions;
}> {
  const sap = buildProbeSap(name, config);
  const built = await buildAuth(sap, name);
  return {
    passwordOrFetcher: built.passwordOrFetcher,
    options: built.options,
  };
}

/** Probe via ADTClient — shares CSRF + BearerFetcher cache with runtime. */
async function probeWithAdtClient(name: string, config: ProbeConfig, endpoint: { path: string; accept: string }): Promise<ProbeLayerResult> {
  try {
    const { ADTClient } = await import('abap-adt-api');
    const { passwordOrFetcher, options } = await buildAuthForProbe(name, config);
    const client = new ADTClient(
      config.url,
      config.username,
      passwordOrFetcher,
      config.client,
      config.language,
      options,
    );
    await client.login();
    // Use httpClient.request directly so we hit the chosen endpoint without
    // depending on abap-adt-api's search/structure parser (which has a known
    // bug on BTP trial when parsing wildcard search responses).
    await client.httpClient.request(endpoint.path, {
      method: 'GET',
      headers: { Accept: endpoint.accept },
    });
    return { ok: true, authMethod: config.authMethod };
  } catch (error: unknown) {
    const classified = classifyHttpError(error, { name, authMethod: config.authMethod });
    return { ok: false, error: { code: classified.code, message: classified.message }, nextSteps: classified.nextSteps, authMethod: config.authMethod };
  }
}

/** Auth layer — compatibility graph reachable with the chosen strategy. */
function probeAuth(name: string, config: ProbeConfig): Promise<ProbeLayerResult> {
  return probeWithAdtClient(name, config, { path: '/sap/bc/adt/compatibility/graph', accept: 'application/xml' });
}

/** ADT layer — login + discovery endpoint as a lightweight ADT reachability
 * probe (avoids the library's search/structure parser bug on BTP trial). */
function probeAdt(name: string, config: ProbeConfig): Promise<ProbeLayerResult> {
  return probeWithAdtClient(name, config, { path: '/sap/bc/adt/discovery', accept: 'application/atomsvc+xml' });
}

/** ICF layer — reachability of the self-built ICF service root via ADTClient. */
function probeIcf(name: string, config: ProbeConfig): Promise<ProbeLayerResult> {
  return probeWithAdtClient(name, config, { path: '/sap/zabap_vibe/', accept: 'application/json' });
}
