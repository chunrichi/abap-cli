/**
 * UCON HTTP service (UCON_HTTP) lifecycle against mock-adt's ICF route.
 *
 * Drives the real CLI binary:
 *   create → pull → push → re-pull → delete,
 * plus the type-specific error surface: handler-class validation, the transport
 * rule for transportable packages, missing-target push and the TADIR mapping
 * reported by `abap types`.
 */
import { describe, expect, it, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import * as net from 'node:net';
import { join, resolve } from 'node:path';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';

const ROOT = resolve(__dirname, '../..');
const CLI = resolve(ROOT, 'dist/index.js');
const hasBuiltCli = existsSync(CLI);
const MOCK = resolve(ROOT, 'test/integration/mock-adt/server.js');

const TMP_HOME = mkdtempSync(join(os.tmpdir(), 'abap-ucon-http-home-'));
mkdirSync(join(TMP_HOME, '.abap-cli'), { recursive: true });
const TMP_PROJECT = mkdtempSync(join(os.tmpdir(), 'abap-ucon-http-project-'));
writeFileSync(
  join(TMP_PROJECT, '.abap.json'),
  JSON.stringify({ system: 'mock', transport: '', package: '$TMP' }, null, 2) + '\n',
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

function parseError(result: { stdout: string; stderr: string }): { code: string; message: string } {
  const parsed = parseEnvelope(result) as { error?: { code: string; message: string } };
  expect(parsed.error).toBeDefined();
  return parsed.error as { code: string; message: string };
}

const LOCAL = {
  formatVersion: '1',
  description: 'Mock UCON HTTP service',
  handlers: [
    { order: '01', handlerClass: 'ZCL_HTTP_DEMO_HANDLER' },
    { order: '02', handlerClass: 'ZCL_HTTP_AUDIT_HANDLER' },
  ],
};

function writeDoc(name: string, doc: Record<string, unknown>): string {
  mkdirSync(join(TMP_PROJECT, 'src'), { recursive: true });
  const rel = `src/${name}.ucon_http.json`;
  writeFileSync(join(TMP_PROJECT, rel), JSON.stringify(doc, null, 2) + '\n');
  return rel;
}

function readPulled(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(TMP_PROJECT, 'src', `${name}.ucon_http.json`), 'utf8')) as Record<string, unknown>;
}

afterAll(() => {
  rmSync(TMP_HOME, { recursive: true, force: true });
  rmSync(TMP_PROJECT, { recursive: true, force: true });
});

describe.skipIf(!hasBuiltCli)('abap create/pull/push/delete UCON_HTTP', () => {
  it('round-trips a UCON HTTP service and reports the TADIR mapping', async () => {
    await withMock(async () => {
      const file = writeDoc('zhttp_demo', LOCAL);

      let res = await runCli(['create', 'UCON_HTTP', 'ZHTTP_DEMO', '--file', file, '--package', '$TMP', '--yes', '--json']);
      expect(res.exit).toBe(0);
      expect(parseEnvelope(res)).toMatchObject({
        status: 'success',
        data: { object: 'ZHTTP_DEMO', type: 'UCON_HTTP', action: 'created', channel: 'icf', package: '$TMP' },
      });

      res = await runCli(['pull', 'ZHTTP_DEMO', '--type', 'UCON_HTTP', '--overwrite', '--json']);
      expect(res.exit).toBe(0);
      expect(readPulled('zhttp_demo')).toEqual(LOCAL);

      res = await runCli(['push', file, '--yes', '--json']);
      expect(res.exit).toBe(0);
      expect(parseEnvelope(res)).toMatchObject({ status: 'success', data: { results: [{ status: 'written' }] } });

      res = await runCli(['delete', 'ZHTTP_DEMO', '--type', 'UCON_HTTP', '--yes', '--json']);
      expect(res.exit).toBe(0);
      expect(parseEnvelope(res)).toMatchObject({ data: { object: 'ZHTTP_DEMO', deleted: true } });

      res = await runCli(['types', 'UCON_HTTP', '--json']);
      expect(res.exit).toBe(0);
      expect(parseEnvelope(res)).toMatchObject({ data: { cliType: 'UCON_HTTP', tadirObject: 'HTTP', channel: 'ICF' } });
    });
  });

  it('keeps the ICF node link across pull → push → pull', async () => {
    await withMock(async () => {
      const doc = { ...LOCAL, icfService: { icfName: 'ZNODE', icfParGuid: 'ABC123' } };
      writeDoc('zhttp_link', doc);
      let res = await runCli(['create', 'UCON_HTTP', 'ZHTTP_LINK', '--file', 'src/zhttp_link.ucon_http.json', '--package', '$TMP', '--yes', '--json']);
      expect(res.exit).toBe(0);

      res = await runCli(['pull', 'ZHTTP_LINK', '--type', 'UCON_HTTP', '--overwrite', '--json']);
      expect(res.exit).toBe(0);
      expect(readPulled('zhttp_link')).toEqual(doc);

      res = await runCli(['push', 'src/zhttp_link.ucon_http.json', '--yes', '--json']);
      expect(res.exit).toBe(0);
      res = await runCli(['pull', 'ZHTTP_LINK', '--type', 'UCON_HTTP', '--overwrite', '--json']);
      expect(res.exit).toBe(0);
      expect(readPulled('zhttp_link')).toEqual(doc);
    });
  });

  it('reports a missing handler class and rejects malformed documents locally', async () => {
    await withMock(async () => {
      writeDoc('zhttp_bad', { ...LOCAL, handlers: [{ order: '01', handlerClass: 'ZCL_HTTP_MISSING' }] });
      let res = await runCli(['create', 'UCON_HTTP', 'ZHTTP_BAD', '--file', 'src/zhttp_bad.ucon_http.json', '--package', '$TMP', '--yes', '--json']);
      expect(res.exit).toBe(7);
      expect(parseError(res).code).toBe('UCON_HTTP_HANDLER_NOT_FOUND');

      writeDoc('zhttp_empty', { formatVersion: '1', handlers: [] });
      res = await runCli(['create', 'UCON_HTTP', 'ZHTTP_EMPTY', '--file', 'src/zhttp_empty.ucon_http.json', '--package', '$TMP', '--yes', '--json']);
      expect(res.exit).toBe(7);
      expect(parseError(res).code).toBe('AFF_FIXTURE_INVALID');
    });
  });

  it('enforces the transport rule on create and delete', async () => {
    await withMock(async () => {
      writeDoc('zhttp_dev', LOCAL);
      let res = await runCli(['create', 'UCON_HTTP', 'ZHTTP_DEV', '--file', 'src/zhttp_dev.ucon_http.json', '--package', 'ZPKG_DEV', '--yes', '--json']);
      expect(res.exit).toBe(7);
      expect(parseError(res).code).toBe('VALIDATION_ERROR');

      res = await runCli([
        'create', 'UCON_HTTP', 'ZHTTP_DEV', '--file', 'src/zhttp_dev.ucon_http.json', '--package', 'ZPKG_DEV', '--tr', 'NDK900123', '--yes', '--json',
      ]);
      expect(res.exit).toBe(0);
      expect(parseEnvelope(res)).toMatchObject({ data: { package: 'ZPKG_DEV' } });

      res = await runCli(['delete', 'ZHTTP_DEV', '--type', 'UCON_HTTP', '--yes', '--json']);
      expect(res.exit).toBe(2);
      expect(parseError(res).code).toBe('MISSING_TRANSPORT');

      res = await runCli(['delete', 'ZHTTP_DEV', '--type', 'UCON_HTTP', '--tr', 'NDK900123', '--yes', '--json']);
      expect(res.exit).toBe(0);
    });
  });

  it('refuses to push a service that does not exist and validates --check-only without SAP', async () => {
    await withMock(async () => {
      writeDoc('zhttp_absent', LOCAL);
      let res = await runCli(['push', 'src/zhttp_absent.ucon_http.json', '--yes', '--json']);
      expect(res.exit).toBe(8);
      expect(parseError(res).code).toBe('OBJECT_NOT_FOUND');

      res = await runCli([
        'create', 'UCON_HTTP', 'ZHTTP_ABSENT', '--file', 'src/zhttp_absent.ucon_http.json', '--package', '$TMP', '--check-only', '--yes', '--json',
      ]);
      expect(res.exit).toBe(0);
      expect(parseEnvelope(res)).toMatchObject({ data: { checkOnly: true, valid: true } });
    });
  });
});
