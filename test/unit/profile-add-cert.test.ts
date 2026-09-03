import { describe, expect, it, vi } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

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
}));

vi.mock('../../src/abap_cli/clients/textpool-capability.js', () => ({
  probeTextpoolCapability: () => Promise.reject(new Error('not used')),
  recordCapability: () => Promise.resolve(),
}));

import { runAdd } from '../../src/abap_cli/flows/setup/profile.js';

describe('abap profile add — cert auth', () => {
  it('creates a profile with v2 canonical cert block', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-cert-'));
    const cert = path.join(dir, 'cert.pem');
    const key = path.join(dir, 'key.pem');
    fs.writeFileSync(cert, 'BEGIN');
    fs.writeFileSync(key, 'BEGIN');

    await runAdd('trial', {
      url: 'https://sap.example.com',
      username: 'me',
      authMethod: 'cert',
      certPath: cert,
      certKey: key,
    }, 'json');

    expect(upsertSystem).toHaveBeenCalledWith('trial', expect.objectContaining({
      url: 'https://sap.example.com',
      username: 'me',
      auth: { method: 'cert', cert: { certPath: cert, keyPath: key } },
    }));
  });

  it('rejects --auth-method=cert when --cert-path and --cert-key are not both supplied', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-cert-'));
    const cert = path.join(dir, 'cert.pem');
    fs.writeFileSync(cert, 'BEGIN');

    await expect(runAdd('trial', {
      url: 'https://sap.example.com',
      username: 'me',
      authMethod: 'cert',
      certPath: cert,
      // certKey missing
    }, 'json')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('stores cert passphrase in keychain when supplied', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-cert-'));
    const cert = path.join(dir, 'cert.pem');
    const key = path.join(dir, 'key.pem');
    fs.writeFileSync(cert, 'BEGIN');
    fs.writeFileSync(key, 'BEGIN');

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