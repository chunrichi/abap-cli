/**
 * `abap init` profile writes go through the same PEM import path as
 * `profile add/set`: `saveProfile()` imports local CA / client-cert / key
 * files into the content-addressed store before persisting the profile.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';

const SAMPLE_PEM = '-----BEGIN CERTIFICATE-----\nMIIBcorp\n-----END CERTIFICATE-----\n';
const OTHER_PEM = '-----BEGIN CERTIFICATE-----\nMIIBother\n-----END CERTIFICATE-----\n';
const THIRD_PEM = '-----BEGIN CERTIFICATE-----\nMIIBthird\n-----END CERTIFICATE-----\n';
const sha = (content: string) => createHash('sha256').update(content).digest('hex');

let systems: Record<string, Record<string, unknown>>;

vi.mock('../../src/abap_cli/config/user-config.js', () => ({
  getSystem: (name: string) => systems[name] ?? null,
  listSystemNames: () => Object.keys(systems),
  upsertSystem: (name: string, profile: Record<string, unknown>) => { systems[name] = { ...profile }; },
  deleteSystem: (name: string) => { delete systems[name]; return true; },
  loadUserConfig: () => ({ systems }),
  saveUserConfig: vi.fn(),
}));

vi.mock('../../src/abap_cli/config/secrets.js', () => ({
  getPassword: vi.fn().mockResolvedValue(null),
  storePassword: vi.fn().mockResolvedValue(''),
  deletePassword: vi.fn().mockResolvedValue(true),
  storeCertPassphrase: vi.fn().mockResolvedValue(''),
}));

vi.mock('../../src/abap_cli/clients/textpool-capability.js', () => ({
  probeTextpoolCapability: vi.fn().mockRejectedValue(new Error('not used')),
  recordCapability: vi.fn().mockResolvedValue(''),
}));

import { saveProfile } from '../../src/abap_cli/flows/setup/init.js';
import { defaultAuth } from '../../src/abap_cli/auth/v2-types.js';

let srcDir: string;
let certDir: string;
let prevCertDir: string | undefined;

beforeEach(() => {
  srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'init-pem-src-'));
  certDir = fs.mkdtempSync(path.join(os.tmpdir(), 'init-pem-store-'));
  prevCertDir = process.env.ABAP_CLI_CERT_DIR;
  process.env.ABAP_CLI_CERT_DIR = certDir;
  systems = {};
});

afterEach(() => {
  if (prevCertDir === undefined) delete process.env.ABAP_CLI_CERT_DIR;
  else process.env.ABAP_CLI_CERT_DIR = prevCertDir;
  fs.rmSync(srcDir, { recursive: true, force: true });
  fs.rmSync(certDir, { recursive: true, force: true });
});

function writeSrc(name: string, content: string): string {
  const p = path.join(srcDir, name);
  fs.writeFileSync(p, content);
  return p;
}

describe('init saveProfile — PEM import', () => {
  it('imports --ca into the store instead of persisting the source path', async () => {
    const src = writeSrc('corp.pem', SAMPLE_PEM);
    await saveProfile('dev', {
      url: 'https://sap.example.com',
      client: '100',
      username: 'DEV',
      language: 'EN',
      ca: src,
      auth: defaultAuth(),
    }, '', '');

    expect(systems.dev!.ca).toBe(path.join(certDir, `${sha(SAMPLE_PEM)}.pem`));
    expect(fs.readFileSync(systems.dev!.ca as string, 'utf-8')).toBe(SAMPLE_PEM);
  });

  it('imports cert-auth cert + key and reclaims the replaced CA on re-save', async () => {
    const certSrc = writeSrc('client.pem', SAMPLE_PEM);
    const keySrc = writeSrc('client.key', '-----BEGIN PRIVATE KEY-----\nMIIBkey\n-----END PRIVATE KEY-----\n');
    const caOne = writeSrc('ca-one.pem', OTHER_PEM);
    const caTwo = writeSrc('ca-two.pem', THIRD_PEM);

    await saveProfile('dev', {
      url: 'https://sap.example.com',
      client: '100',
      username: 'DEV',
      language: 'EN',
      ca: caOne,
      auth: defaultAuth(),
    }, '', '');
    const firstCa = path.join(certDir, `${sha(OTHER_PEM)}.pem`);
    expect(fs.existsSync(firstCa)).toBe(true);

    // Re-save with a different CA and cert auth on top.
    await saveProfile('dev', {
      url: 'https://sap.example.com',
      client: '100',
      username: 'DEV',
      language: 'EN',
      ca: caTwo,
      auth: { method: 'cert', cert: { certPath: certSrc, keyPath: keySrc } },
    }, '', '');

    const storedCert = path.join(certDir, `${sha(SAMPLE_PEM)}.pem`);
    const storedKey = path.join(certDir, `${sha('-----BEGIN PRIVATE KEY-----\nMIIBkey\n-----END PRIVATE KEY-----\n')}.pem`);
    expect(systems.dev!.ca).toBe(path.join(certDir, `${sha(THIRD_PEM)}.pem`));
    expect((systems.dev!.auth as { cert: { certPath: string; keyPath: string } }).cert.certPath).toBe(storedCert);
    expect((systems.dev!.auth as { cert: { certPath: string; keyPath: string } }).cert.keyPath).toBe(storedKey);
    expect(fs.statSync(storedKey).mode & 0o777).toBe(0o600);
    // The replaced CA is no longer referenced by any profile and was reclaimed.
    expect(fs.existsSync(firstCa)).toBe(false);
  });
});
