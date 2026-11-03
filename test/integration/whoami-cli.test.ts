/**
 * End-to-end `abap whoami` contract: drive the real CLI binary against the
 * mock ADT server's ICF emulation.
 *
 * Pins the system-side identity path:
 *   - `GET /sap/abap_cli/whoami` returns the SAP-session identity; the CLI
 *     projects it instead of echoing the local profile user.
 *   - an old / not-yet-deployed ICF service answers the route with the old
 *     handler's 404 NOT_FOUND envelope → `ICF_IDENTITY_UNAVAILABLE` (exit 8)
 *     with an actionable `abap deploy --yes` next step.
 * Plus the two context failures an agent must branch on: an unbound workspace
 * (CONFIG_ERROR, exit 3) and `--schema` without any SAP call.
 */
import { describe, expect, it, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import * as net from 'node:net';
import { join, resolve } from 'node:path';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';

const ROOT = resolve(__dirname, '../..');
const CLI = resolve(ROOT, 'dist/index.js');
const hasBuiltCli = existsSync(CLI);
const MOCK = resolve(ROOT, 'test/integration/mock-adt/server.js');

const TMP_HOME = mkdtempSync(join(os.tmpdir(), 'abap-whoami-home-'));
mkdirSync(join(TMP_HOME, '.abap-cli'), { recursive: true });
const TMP_PROJECT = mkdtempSync(join(os.tmpdir(), 'abap-whoami-project-'));
writeFileSync(
  join(TMP_PROJECT, '.abap.json'),
  JSON.stringify({ system: 'mock' }, null, 2) + '\n',
);
const TMP_UNBOUND = mkdtempSync(join(os.tmpdir(), 'abap-whoami-unbound-'));

function writeSystemsConfig(port: number): void {
  writeFileSync(
    join(TMP_HOME, '.abap-cli', 'systems.json'),
    JSON.stringify({
      systems: {
        mock: {
          url: `http://localhost:${port}`,
          client: '100',
          username: 'MOCKUSER',
          language: 'EN',
          auth: { method: 'basic' },
        },
      },
    }),
  );
}

function getFreePort(): Promise<number> {
  return new Promise((resolveP, rejectP) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => (port ? resolveP(port) : rejectP(new Error('no free port'))));
    });
    srv.on('error', rejectP);
  });
}

function startMock(port: number, env: NodeJS.ProcessEnv = {}): Promise<ChildProcess> {
  return new Promise((resolveP, rejectP) => {
    const proc = spawn('node', [MOCK, String(port)], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });
    const onData = (chunk: Buffer) => {
      if (chunk.toString().includes('Mock ADT listening')) {
        proc.stdout?.off('data', onData);
        resolveP(proc);
      }
    };
    proc.stdout?.on('data', onData);
    proc.on('error', rejectP);
    setTimeout(() => rejectP(new Error('mock-adt startup timeout')), 5000);
  });
}

function runCli(args: string[], cwd = TMP_PROJECT): Promise<{ stdout: string; stderr: string; exit: number }> {
  return new Promise((resolveP, rejectP) => {
    const proc = spawn('node', [CLI, ...args], {
      cwd,
      env: {
        ...process.env,
        HOME: TMP_HOME,
        USERPROFILE: TMP_HOME,
        ABAP_CLI_KEYCHAIN_BACKEND: 'fixture',
        ABAP_CLI_KEYCHAIN_FIXTURE_PASSWORD: 'dummy',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (c) => { stdout += c.toString(); });
    proc.stderr.on('data', (c) => { stderr += c.toString(); });
    proc.on('close', (exit) => resolveP({ stdout, stderr, exit: exit ?? -1 }));
    proc.on('error', rejectP);
  });
}

async function withMock<T>(env: NodeJS.ProcessEnv, fn: () => Promise<T>): Promise<T> {
  const port = await getFreePort();
  writeSystemsConfig(port);
  const proc = await startMock(port, env);
  try {
    return await fn();
  } finally {
    proc.kill('SIGTERM');
  }
}

function parseEnvelope(result: { stdout: string; stderr: string }): Record<string, unknown> {
  const text = result.stdout.trim() ? result.stdout : result.stderr;
  return JSON.parse(text.slice(text.indexOf('{'))) as Record<string, unknown>;
}

afterAll(() => {
  for (const dir of [TMP_HOME, TMP_PROJECT, TMP_UNBOUND]) rmSync(dir, { recursive: true, force: true });
});

describe('abap whoami (mock ICF service)', () => {
  it.skipIf(!hasBuiltCli)('reports the SAP-session identity as JSON', async () => {
    await withMock({}, async () => {
      const res = await runCli(['whoami', '--json']);
      expect(res.exit).toBe(0);
      const envelope = parseEnvelope(res);
      expect(envelope.status).toBe('success');
      expect(envelope.data).toMatchObject({
        profile: 'mock',
        system: 'S4H',
        client: '100',
        user: 'MOCKUSER',
        server: {
          applicationServer: 'mockhost',
          database: 'HDB',
          os: 'Linux',
          abapRelease: '757',
        },
      });
      expect(String((envelope.data as Record<string, unknown>).url)).toContain('http://localhost:');
    });
  });

  it.skipIf(!hasBuiltCli)('prints the human identity block by default', async () => {
    await withMock({}, async () => {
      const res = await runCli(['whoami']);
      expect(res.exit).toBe(0);
      expect(res.stdout).toContain('Connection identity:');
      expect(res.stdout).toContain('profile:  mock');
      expect(res.stdout).toContain('system:   S4H client 100');
      expect(res.stdout).toContain('user:     MOCKUSER');
      expect(res.stdout).toContain('server:   HDB · Linux · mockhost · ABAP 757');
    });
  });

  it.skipIf(!hasBuiltCli)('reports an old ICF service as ICF_IDENTITY_UNAVAILABLE (exit 8) with a deploy next step', async () => {
    await withMock({ MOCK_ICF_OLD: '1' }, async () => {
      const res = await runCli(['whoami', '--json']);
      expect(res.exit).toBe(8);
      expect(res.stdout).toBe('');
      const envelope = parseEnvelope(res);
      expect(envelope.status).toBe('error');
      expect((envelope.error as Record<string, unknown>).code).toBe('ICF_IDENTITY_UNAVAILABLE');
      expect((envelope.error as Record<string, unknown>).nextSteps).toEqual(
        expect.arrayContaining([expect.stringContaining('abap deploy --yes')]),
      );
    });
  });

  it.skipIf(!hasBuiltCli)('fails with CONFIG_ERROR (exit 3) when the workspace is unbound', async () => {
    const res = await runCli(['whoami', '--json'], TMP_UNBOUND);
    expect(res.exit).toBe(3);
    const envelope = parseEnvelope(res);
    expect(envelope.status).toBe('error');
    expect((envelope.error as Record<string, unknown>).code).toBe('CONFIG_ERROR');
  });

  it.skipIf(!hasBuiltCli)('prints its schema without config and without any SAP call', async () => {
    const res = await runCli(['whoami', '--schema', '--json'], TMP_UNBOUND);
    expect(res.exit).toBe(0);
    const envelope = parseEnvelope(res);
    expect((envelope.data as Record<string, unknown>).command).toBe('whoami');
    expect((envelope.data as Record<string, unknown>).scope).toBe('sap');
  });
});
