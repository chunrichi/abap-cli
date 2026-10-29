/**
 * `profile add` with auth-method=cert.
 *
 * Cert/key paths given on the CLI are imported into the content-addressed PEM
 * store (`config/ca-store.ts`), so the profile ends up pointing at the stored
 * copy and the user's source files can be moved afterwards.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { createHash } from 'crypto';

const CERT_PEM = '-----BEGIN CERTIFICATE-----\nMIIBclient\n-----END CERTIFICATE-----\n';
const KEY_PEM = '-----BEGIN PRIVATE KEY-----\nMIIBkey\n-----END PRIVATE KEY-----\n';

const storeCertPassphrase = vi.fn();
const storePassword = vi.fn();
const upsertSystem = vi.fn();

vi.mock('../../src/abap_cli/config/secrets.js', () => ({
  storeCertPassphrase: (...args: unknown[]) => storeCertPassphrase(...args),
  storePassword: (...args: unknown[]) => storePassword(...args),
}));

vi.mock('../../src/abap_cli/config/user-config.js', () => ({
  getSystem: () => null, // no existing profile
  upsertSystem: (...args: unknown[]) => upsertSystem(...args),
  listSystemNames: () => [],
  deleteSystem: () => false,
  loadUserConfig: () => ({ systems: {} }),
}));

vi.mock('../../src/abap_cli/clients/textpool-capability.js', () => ({
  probeTextpoolCapability: () => Promise.reject(new Error('not used')),
  recordCapability: () => Promise.resolve(),
}));

import { runAdd } from '../../src/abap_cli/flows/setup/profile.js';

const sha = (content: string) => createHash('sha256').update(content).digest('hex');

let srcDir: string;
let certDir: string;
let prevCertDir: string | undefined;

function writePems(): { cert: string; key: string } {
  const cert = path.join(srcDir, 'cert.pem');
  const key = path.join(srcDir, 'key.pem');
  fs.writeFileSync(cert, CERT_PEM);
  fs.writeFileSync(key, KEY_PEM);
  return { cert, key };
}

describe('abap profile add — cert auth', () => {
  beforeEach(() => {
    srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-cert-src-'));
    certDir = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-cert-store-'));
    prevCertDir = process.env.ABAP_CLI_CERT_DIR;
    process.env.ABAP_CLI_CERT_DIR = certDir;
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (prevCertDir === undefined) delete process.env.ABAP_CLI_CERT_DIR;
    else process.env.ABAP_CLI_CERT_DIR = prevCertDir;
    fs.rmSync(srcDir, { recursive: true, force: true });
    fs.rmSync(certDir, { recursive: true, force: true });
  });

  it('creates a profile whose cert block points at the imported store copies', async () => {
    const { cert, key } = writePems();

    await runAdd('trial', {
      url: 'https://sap.example.com',
      username: 'me',
      authMethod: 'cert',
      certPath: cert,
      certKey: key,
    }, 'json');

    const storedCert = path.join(certDir, `${sha(CERT_PEM)}.pem`);
    const storedKey = path.join(certDir, `${sha(KEY_PEM)}.pem`);
    expect(upsertSystem).toHaveBeenCalledWith('trial', expect.objectContaining({
      url: 'https://sap.example.com',
      username: 'me',
      auth: { method: 'cert', cert: { certPath: storedCert, keyPath: storedKey } },
    }));
    expect(fs.readFileSync(storedCert, 'utf-8')).toBe(CERT_PEM);
    expect(fs.readFileSync(storedKey, 'utf-8')).toBe(KEY_PEM);
    // The private key is stored 0600.
    expect(fs.statSync(storedKey).mode & 0o777).toBe(0o600);
  });

  it('rejects --auth-method=cert when --cert-path and --cert-key are not both supplied', async () => {
    const { cert } = writePems();

    await expect(runAdd('trial', {
      url: 'https://sap.example.com',
      username: 'me',
      authMethod: 'cert',
      certPath: cert,
      // certKey missing
    }, 'json')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('rejects a cert file that is not a certificate PEM', async () => {
    const { cert } = writePems();
    fs.writeFileSync(cert, 'BEGIN');

    await expect(runAdd('trial', {
      url: 'https://sap.example.com',
      username: 'me',
      authMethod: 'cert',
      certPath: cert,
      certKey: cert,
    }, 'json')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(upsertSystem).not.toHaveBeenCalled();
  });

  it('stores cert passphrase in keychain when supplied', async () => {
    const { cert, key } = writePems();

    await runAdd('trial', {
      url: 'https://sap.example.com',
      username: 'me',
      authMethod: 'cert',
      certPath: cert,
      certKey: key,
      certPassphrase: 'secret',
    }, 'json');

    expect(storeCertPassphrase).toHaveBeenCalledWith('trial', 'secret');
  });
});
