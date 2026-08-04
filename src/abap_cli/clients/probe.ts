import * as tls from 'tls';
import axios from 'axios';
import * as https from 'https';
import { ADTClient, createSSLConfig } from 'abap-adt-api';
import { getSystem } from '../config/user-config.js';
import { getPassword } from '../crypto/secrets.js';
import { readCaCertificate } from '../config/project-config.js';
import { CliError } from '../output/json.js';
import { classifyHttpError } from './http-error.js';

/** Per-layer result of `connection test <name>` (FR-024). */
export interface ProbeLayerResult {
  ok: boolean;
  /** True when the layer was not run because a prerequisite failed. */
  skipped?: boolean;
  error?: { code: string; message: string };
  nextSteps?: string[];
}

export interface SystemProbe {
  tls: ProbeLayerResult;
  auth: ProbeLayerResult;
  adt: ProbeLayerResult;
  icf: ProbeLayerResult;
}

interface ProbeConfig {
  url: string;
  client: string;
  username: string;
  language: string;
  password: string;
  insecure: boolean;
  ca?: string;
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
      nextSteps: [`Run 'abap connection add ${name} --url <url> --username <user>' to create the profile.`],
      example: `abap connection set ${name} --url <url> --username <user> --password <pass>`,
    });
  }
  const password = (await getPassword(name)) || process.env.SAP_PASSWORD || '';
  const config: ProbeConfig = {
    url: profile.url,
    client: profile.client || '100',
    username: profile.username,
    language: profile.language || 'EN',
    password,
    insecure: profile.insecure ?? process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0',
    ca: readCaCertificate(profile.ca || ''),
  };

  const tlsResult = await probeTls(config);
  const authResult = tlsResult.ok ? await probeAuth(config) : SKIP();
  const adtResult = authResult.ok ? await probeAdt(config) : SKIP();
  const icfResult = authResult.ok ? await probeIcf(config) : SKIP();
  return { tls: tlsResult, auth: authResult, adt: adtResult, icf: icfResult };
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
        ca: config.ca ? [config.ca] : undefined,
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

/** Auth layer — basic-auth probe against the ADT compatibility graph. */
async function probeAuth(config: ProbeConfig): Promise<ProbeLayerResult> {
  try {
    await axios.get(`${config.url}/sap/bc/adt/compatibility/graph`, {
      auth: { username: config.username, password: config.password || '' },
      headers: { 'sap-client': config.client, Accept: 'application/xml' },
      httpsAgent: new https.Agent({ rejectUnauthorized: !config.insecure, ca: config.ca }),
      timeout: 15000,
    });
    return { ok: true };
  } catch (error: unknown) {
    const classified = classifyHttpError(error);
    return {
      ok: false,
      error: { code: classified.code, message: classified.message },
      nextSteps: classified.nextSteps,
    };
  }
}

/** ADT layer — login + a trivial object search through the real ADT client. */
async function probeAdt(config: ProbeConfig): Promise<ProbeLayerResult> {
  const client = new ADTClient(
    config.url,
    config.username,
    config.password,
    config.client,
    config.language,
    createSSLConfig(config.insecure, config.ca),
  );
  try {
    await client.login();
    await client.searchObject('*', undefined, 1);
    return { ok: true };
  } catch (error: unknown) {
    const classified = classifyHttpError(error);
    return {
      ok: false,
      error: { code: classified.code, message: classified.message },
      nextSteps: classified.nextSteps,
    };
  }
}

/** ICF layer — reachability of the self-built ICF service root. */
async function probeIcf(config: ProbeConfig): Promise<ProbeLayerResult> {
  try {
    await axios.get(`${config.url}/sap/zabap_vibe/`, {
      auth: { username: config.username, password: config.password || '' },
      headers: { 'sap-client': config.client, Accept: 'application/json' },
      httpsAgent: new https.Agent({ rejectUnauthorized: !config.insecure, ca: config.ca }),
      timeout: 15000,
    });
    return { ok: true };
  } catch (error: unknown) {
    const classified = classifyHttpError(error);
    return {
      ok: false,
      error: { code: classified.code, message: classified.message },
      nextSteps: classified.nextSteps,
    };
  }
}
