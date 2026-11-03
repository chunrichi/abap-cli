/**
 * `abap publish` / `abap unpublish` against mock-adt.
 *
 * Pins the full command path: create a binding through the existing SRVB
 * create flow, then publish/unpublish it. The mock rejects a protocol mismatch
 * (V2 binding must use `odatav2`), so the test also proves the flow derives the
 * endpoint from the binding metadata.
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

const TMP_HOME = mkdtempSync(join(os.tmpdir(), 'abap-srvb-home-'));
mkdirSync(join(TMP_HOME, '.abap-cli'), { recursive: true });
const TMP_PROJECT = mkdtempSync(join(os.tmpdir(), 'abap-srvb-project-'));
writeFileSync(join(TMP_PROJECT, '.abap.json'), JSON.stringify({ system: 'mock', transport: '', package: '$TMP' }, null, 2) + '\n');
mkdirSync(join(TMP_PROJECT, 'src'), { recursive: true });

const NAME = 'ZCLI_MOCK_SB';
const FIXTURE = `src/${NAME.toLowerCase()}.srvb.json`;
writeFileSync(
  join(TMP_PROJECT, FIXTURE),
  JSON.stringify(
    {
      formatVersion: '1',
      header: { description: 'mock service binding', originalLanguage: 'en' },
      bindingType: 'ODATA V2',
      bindingTypeCategory: 'ui',
      services: [{ name: NAME, versions: [{ serviceVersion: '0001', serviceDefinition: 'ZCLI_MOCK_SRVD' }] }],
    },
    null,
    2,
  ) + '\n',
);

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
          sessionPolicy: 'always-logout',
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

function startMock(port: number): Promise<ChildProcess> {
  return new Promise((resolveP, rejectP) => {
    const proc = spawn('node', [MOCK, String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
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

function runCli(args: string[]): Promise<{ stdout: string; stderr: string; exit: number }> {
  return new Promise((resolveP, rejectP) => {
    const proc = spawn('node', [CLI, ...args], {
      cwd: TMP_PROJECT,
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

async function withMock<T>(fn: () => Promise<T>): Promise<T> {
  const port = await getFreePort();
  writeSystemsConfig(port);
  const proc = await startMock(port);
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
  rmSync(TMP_HOME, { recursive: true, force: true });
  rmSync(TMP_PROJECT, { recursive: true, force: true });
});

describe.skipIf(!hasBuiltCli)('service binding publish/unpublish (mock ADT)', () => {
  it('publishes, re-publishes, unpublishes and rejects unknown bindings', async () => {
    await withMock(async () => {
      const create = await runCli(['create', 'SRVB', NAME, '--file', FIXTURE, '--package', '$TMP', '--yes', '--json']);
      expect(create.exit, create.stderr || create.stdout).toBe(0);

      const publish = await runCli(['publish', NAME, '--json']);
      expect(publish.exit, publish.stderr || publish.stdout).toBe(0);
      expect(parseEnvelope(publish).data).toMatchObject({
        object: NAME,
        type: 'SRVB',
        action: 'published',
        channel: 'adt',
        serviceVersion: '0001',
        bindingVersion: 'V2',
        published: true,
        status: 'OK',
      });

      // Idempotent from a fresh command invocation.
      const again = await runCli(['publish', NAME, '--json']);
      expect(again.exit).toBe(0);
      expect(parseEnvelope(again).data).toMatchObject({ action: 'published', published: true });

      const unpublish = await runCli(['unpublish', NAME, '--json']);
      expect(unpublish.exit, unpublish.stderr || unpublish.stdout).toBe(0);
      expect(parseEnvelope(unpublish).data).toMatchObject({
        object: NAME,
        action: 'unpublished',
        published: false,
        serviceVersion: '0001',
      });

      const missing = await runCli(['publish', 'ZCLI_MOCK_NOPE', '--json']);
      expect(missing.exit).toBe(8);
      expect(parseEnvelope(missing).error).toMatchObject({ code: 'OBJECT_NOT_FOUND' });

    });
  });

  it('prints the command schema without touching SAP', async () => {
    const publishSchema = await runCli(['publish', '--schema', '--json']);
    expect(publishSchema.exit, publishSchema.stderr).toBe(0);
    expect((publishSchema).stdout).toContain('"command":"publish"');
    const unpublishSchema = await runCli(['unpublish', '--schema', '--json']);
    expect(unpublishSchema.exit, unpublishSchema.stderr).toBe(0);
    expect(unpublishSchema.stdout).toContain('"command":"unpublish"');
  });
});
