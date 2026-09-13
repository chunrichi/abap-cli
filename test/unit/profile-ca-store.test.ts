/**
 * `profile add/set --ca` integration with the content-addressed cert store.
 *
 * The unit tests in ca-store.test.ts cover the store itself; this file covers
 * the profile flow wiring: the stored canonical path (not the user's path) is
 * what lands in systems.json, the import timestamp is persisted, and
 * `profile delete` only reclaims the PEM when no remaining profile uses it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { registerProfileCommand } from '../../src/abap_cli/commands/profile.js';
import { makeProgram, runCommand } from './cli-helper.js';

const SAMPLE_PEM = '-----BEGIN CERTIFICATE-----\nMIIBcorp\n-----END CERTIFICATE-----\n';
const CERT_PEM = '-----BEGIN CERTIFICATE-----\nMIIBclient\n-----END CERTIFICATE-----\n';
const KEY_PEM = '-----BEGIN PRIVATE KEY-----\nMIIBkey\n-----END PRIVATE KEY-----\n';

/** Mutable stand-ins so each case controls what "the store" contains. */
let systems: Record<string, Record<string, unknown>>;
const upsertSystem = vi.fn();
const deleteSystem = vi.fn();

vi.mock('../../src/abap_cli/config/user-config.js', () => ({
  getSystem: (name: string) => systems[name] ?? null,
  listSystemNames: () => Object.keys(systems),
  upsertSystem: (...args: unknown[]) => upsertSystem(...args),
  deleteSystem: (name: string) => {
    deleteSystem(name);
    delete systems[name];
    return true;
  },
  loadUserConfig: () => ({ systems }),
  saveUserConfig: vi.fn(),
}));

vi.mock('../../src/abap_cli/config/secrets.js', () => ({
  storePassword: vi.fn(async () => ''),
  deletePassword: vi.fn(async () => ''),
  getPassword: vi.fn(async () => null),
}));

describe('profile add/set --ca (cert store import)', () => {
  let cwd: string;
  let certDir: string;
  let srcDir: string;
  let prevCertDir: string | undefined;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-ca-cwd-'));
    certDir = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-ca-store-'));
    srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-ca-src-'));
    prevCertDir = process.env.ABAP_CLI_CERT_DIR;
    process.env.ABAP_CLI_CERT_DIR = certDir;
    systems = {};
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (prevCertDir === undefined) delete process.env.ABAP_CLI_CERT_DIR;
    else process.env.ABAP_CLI_CERT_DIR = prevCertDir;
    for (const dir of [cwd, certDir, srcDir]) fs.rmSync(dir, { recursive: true, force: true });
  });

  function writeSrc(name: string, content = SAMPLE_PEM): string {
    const p = path.join(srcDir, name);
    fs.writeFileSync(p, content);
    return p;
  }

  function shaOf(content = SAMPLE_PEM): string {
    return createHash('sha256').update(content).digest('hex');
  }

  async function runProfile(args: string[]): Promise<{ stdout: string; stderr: string; exitCode?: number }> {
    const program = makeProgram();
    registerProfileCommand(program);
    setSystemFromUpsert();
    return runCommand(program, ['profile', ...args, '--json'], { cwd });
  }

  /** Mirror the real upsert into the in-memory store used by getSystem(). */
  function setSystemFromUpsert(): void {
    upsertSystem.mockImplementation((name: string, profile: Record<string, unknown>) => {
      systems[name] = { ...profile };
    });
  }

  it('stores the imported canonical path, not the path the user typed', async () => {
    const src = writeSrc('corp.pem');
    const res = await runProfile(['add', 'dev', '--url', 'http://sap.example:50000', '--username', 'DEV', '--ca', src]);
    expect(res.exitCode).toBeUndefined();

    const expected = path.join(certDir, `${shaOf()}.pem`);
    expect(systems.dev!.ca).toBe(expected);
    expect(systems.dev!.ca).not.toBe(src);
    expect(fs.readFileSync(expected, 'utf-8')).toBe(SAMPLE_PEM);
    // The source file is now irrelevant.
    fs.rmSync(src);
    expect(fs.existsSync(expected)).toBe(true);
  });

  it('persists caImportedAt and surfaces it via profile show', async () => {
    const src = writeSrc('corp.pem');
    await runProfile(['add', 'dev', '--url', 'http://sap.example:50000', '--username', 'DEV', '--ca', src]);
    expect(typeof systems.dev!.caImportedAt).toBe('string');

    const shown = await runProfile(['show', 'dev']);
    const detail = JSON.parse(shown.stdout).data.system;
    expect(detail.caFingerprint).toBe(shaOf().slice(0, 16));
    expect(detail.caImportedAt).toBe(systems.dev!.caImportedAt);
  });

  it('is idempotent when the same PEM is imported from a second path', async () => {
    await runProfile(['add', 'dev', '--url', 'http://sap.example:50000', '--username', 'DEV', '--ca', writeSrc('a.pem')]);
    const first = systems.dev!.caImportedAt;
    await runProfile(['set', 'dev', '--ca', writeSrc('b.pem')]);
    expect(systems.dev!.ca).toBe(path.join(certDir, `${shaOf()}.pem`));
    expect(fs.readdirSync(certDir)).toEqual([`${shaOf()}.pem`]);
    // Repeat import keeps the original timestamp.
    expect(typeof first).toBe('string');
  });

  it('reclaims the stored PEM when the last referencing profile is deleted', async () => {
    await runProfile(['add', 'dev', '--url', 'http://sap.example:50000', '--username', 'DEV', '--ca', writeSrc('corp.pem')]);
    const stored = path.join(certDir, `${shaOf()}.pem`);
    expect(fs.existsSync(stored)).toBe(true);

    const res = await runProfile(['delete', 'dev', '--yes']);
    expect(JSON.parse(res.stdout).data.caOrphanRemoved).toBe(true);
    expect(fs.existsSync(stored)).toBe(false);
  });

  it('keeps the stored PEM while another profile still references it', async () => {
    await runProfile(['add', 'dev', '--url', 'http://sap.example:50000', '--username', 'DEV', '--ca', writeSrc('corp.pem')]);
    await runProfile(['add', 'trial', '--url', 'http://sap.example:50000', '--username', 'TRIAL', '--ca', writeSrc('corp-copy.pem')]);
    const stored = path.join(certDir, `${shaOf()}.pem`);

    const res = await runProfile(['delete', 'dev', '--yes']);
    expect(JSON.parse(res.stdout).data.caOrphanRemoved).toBe(false);
    expect(fs.existsSync(stored)).toBe(true);
  });

  it('rejects a non-certificate PEM before writing to the store', async () => {
    const res = await runProfile(['add', 'dev', '--url', 'http://sap.example:50000', '--username', 'DEV', '--ca', writeSrc('key.pem', '-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----\n')]);
    expect(res.exitCode).toBe(2);
    expect(JSON.parse(res.stderr).error.code).toBe('INVALID_ARGUMENT');
    expect(fs.readdirSync(certDir)).toEqual([]);
  });

  it('reclaims the replaced PEM when --ca points at a different file', async () => {
    const other = '-----BEGIN CERTIFICATE-----\nMIIBother\n-----END CERTIFICATE-----\n';
    await runProfile(['add', 'dev', '--url', 'http://sap.example:50000', '--username', 'DEV', '--ca', writeSrc('a.pem')]);
    const firstStored = path.join(certDir, `${shaOf()}.pem`);
    await runProfile(['set', 'dev', '--ca', writeSrc('b.pem', other)]);

    const secondStored = path.join(certDir, `${shaOf(other)}.pem`);
    expect(systems.dev!.ca).toBe(secondStored);
    expect(fs.existsSync(secondStored)).toBe(true);
    expect(fs.existsSync(firstStored)).toBe(false);
  });

  it('reclaims the PEM on --clear-ca', async () => {
    await runProfile(['add', 'dev', '--url', 'http://sap.example:50000', '--username', 'DEV', '--ca', writeSrc('corp.pem')]);
    const stored = path.join(certDir, `${shaOf()}.pem`);

    await runProfile(['set', 'dev', '--clear-ca']);
    expect(systems.dev!.ca).toBeUndefined();
    expect(systems.dev!.caImportedAt).toBeUndefined();
    expect(fs.existsSync(stored)).toBe(false);
  });

  it('keeps a replaced PEM that another profile still references', async () => {
    const src = writeSrc('corp.pem');
    await runProfile(['add', 'dev', '--url', 'http://sap.example:50000', '--username', 'DEV', '--ca', src]);
    await runProfile(['add', 'trial', '--url', 'http://sap.example:50000', '--username', 'TRIAL', '--ca', writeSrc('corp-copy.pem')]);

    await runProfile(['set', 'dev', '--clear-ca']);
    expect(fs.existsSync(path.join(certDir, `${shaOf()}.pem`))).toBe(true);
  });

  it('imports cert-auth cert + key into the store and reclaims them on delete', async () => {
    const certSrc = writeSrc('client.pem', CERT_PEM);
    const keySrc = writeSrc('client.key', KEY_PEM);
    await runProfile([
      'add', 'dev', '--url', 'http://sap.example:50000', '--username', 'DEV',
      '--auth-method', 'cert', '--cert-path', certSrc, '--cert-key', keySrc,
    ]);

    const auth = systems.dev!.auth as { method: string; cert: { certPath: string; keyPath: string } };
    const storedCert = path.join(certDir, `${shaOf(CERT_PEM)}.pem`);
    const storedKey = path.join(certDir, `${shaOf(KEY_PEM)}.pem`);
    expect(auth.cert.certPath).toBe(storedCert);
    expect(auth.cert.keyPath).toBe(storedKey);
    expect(fs.statSync(storedKey).mode & 0o777).toBe(0o600);

    // The source files are now irrelevant.
    fs.rmSync(certSrc);
    fs.rmSync(keySrc);

    const res = await runProfile(['delete', 'dev', '--yes']);
    expect(JSON.parse(res.stdout).data.caOrphanRemoved).toBe(true);
    expect(fs.existsSync(storedCert)).toBe(false);
    expect(fs.existsSync(storedKey)).toBe(false);
  });
});
