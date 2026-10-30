/**
 * `clients/basic-auth` — the login artefacts every SAP client consumes.
 *
 * Basic auth is the only supported login method: the password comes straight
 * from the keychain-resolved `SapConfig.password`, TLS trust settings become
 * `ClientOptions`, and no credential ever leaves the process.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import https from 'https';
import { buildBasicAuth } from '../../src/abap_cli/clients/basic-auth.js';
import type { SapConfig } from '../../src/abap_cli/config/project-config.js';

const CERT_PEM = '-----BEGIN CERTIFICATE-----\nMIIBdummy\n-----END CERTIFICATE-----\n';

function baseSap(overrides: Partial<SapConfig> = {}): SapConfig {
  return {
    url: 'https://sap.example.com:44300',
    client: '100',
    username: 'DEV',
    password: 'p@ss',
    language: 'EN',
    insecure: false,
    caPath: '',
    sourceDir: process.cwd(),
    ...overrides,
  };
}

let certDir: string;
let prevCertDir: string | undefined;

beforeEach(() => {
  certDir = fs.mkdtempSync(path.join(os.tmpdir(), 'basic-auth-'));
  prevCertDir = process.env.ABAP_CLI_CERT_DIR;
  process.env.ABAP_CLI_CERT_DIR = certDir;
});

afterEach(() => {
  if (prevCertDir === undefined) delete process.env.ABAP_CLI_CERT_DIR;
  else process.env.ABAP_CLI_CERT_DIR = prevCertDir;
  fs.rmSync(certDir, { recursive: true, force: true });
});

describe('clients/basic-auth.buildBasicAuth', () => {
  it('passes the keychain password through unchanged', () => {
    const result = buildBasicAuth(baseSap({ password: 's3cret' }));
    expect(result.password).toBe('s3cret');
  });

  it('returns an httpsAgent that verifies the server certificate by default', () => {
    const agent = buildBasicAuth(baseSap()).options.httpsAgent as https.Agent;
    expect(agent).toBeInstanceOf(https.Agent);
    expect(agent.options.rejectUnauthorized).toBe(true);
  });

  it('disables verification when --insecure is set', () => {
    const agent = buildBasicAuth(baseSap({ insecure: true })).options.httpsAgent as https.Agent;
    expect(agent.options.rejectUnauthorized).toBe(false);
  });

  it('loads the stored CA certificate into the agent', () => {
    const sha = createHash('sha256').update(CERT_PEM).digest('hex');
    const stored = path.join(certDir, `${sha}.pem`);
    fs.writeFileSync(stored, CERT_PEM);

    const agent = buildBasicAuth(baseSap({ caPath: stored })).options.httpsAgent as https.Agent;
    expect(agent.options.ca).toBe(CERT_PEM);
  });
});
