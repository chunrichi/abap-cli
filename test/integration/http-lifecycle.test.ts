/**
 * HTTP (SICF node) lifecycle contract: create → pull → delete → 404.
 *
 * Drives the real CLI binary against mock-adt's ICF `/http/<name>` endpoints,
 * which mirror the ABAP handler envelope: the node name is derived from the
 * AFF `generalInformation.url`, writes are local-package-only and delete
 * refuses missing nodes. Also pins the AFF round-trip: `abap pull` writes a
 * strictly AFF-shaped document (no CLI `name` envelope) and that file is a
 * valid `push`/`create` template.
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

const TMP_HOME = mkdtempSync(join(os.tmpdir(), 'abap-http-home-'));
mkdirSync(join(TMP_HOME, '.abap-cli'), { recursive: true });
const TMP_PROJECT = mkdtempSync(join(os.tmpdir(), 'abap-http-project-'));
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

/** Strictly AFF-shaped document: the object name lives in the file name only. */
const HTTP_DOC = {
  formatVersion: '1',
  header: { description: 'mock SICF node', originalLanguage: 'EN' },
  generalInformation: { handlerClass: 'ZCL_ABAP_VIBE_ICF', servicePath: '/sap/zcli_mock_http1' },
};

const DOC_REL = 'src/zcli_mock_http1.http.json';

function writeDoc(doc: unknown): string {
  mkdirSync(join(TMP_PROJECT, 'src'), { recursive: true });
  writeFileSync(join(TMP_PROJECT, DOC_REL), JSON.stringify(doc, null, 2) + '\n');
  return DOC_REL;
}

function readPulled(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(TMP_PROJECT, DOC_REL), 'utf8')) as Record<string, unknown>;
}

afterAll(() => {
  rmSync(TMP_HOME, { recursive: true, force: true });
  rmSync(TMP_PROJECT, { recursive: true, force: true });
});

describe.skipIf(!hasBuiltCli)('HTTP /http lifecycle (mock ICF)', () => {
  it('creates, pulls and deletes an SICF node', async () => {
    await withMock(async () => {
      writeDoc(HTTP_DOC);

      // Create from a strictly AFF-shaped file (no `name` envelope).
      const create = await runCli(['create', 'HTTP', 'ZCLI_MOCK_HTTP1', '--file', DOC_REL, '--package', '$TMP', '--yes', '--json']);
      expect(create.exit).toBe(0);
      expect(parseEnvelope(create).data).toMatchObject({ object: 'zcli_mock_http1', type: 'HTTP', action: 'created' });

      // Pull back: the local document stays AFF-shaped and reusable as a push
      // template (this failed before the pull→push name fix).
      const pull = await runCli(['pull', 'ZCLI_MOCK_HTTP1', '--type', 'HTTP', '--overwrite', '--json']);
      expect(pull.exit).toBe(0);
      const pulled = readPulled();
      expect(pulled).toMatchObject({
        formatVersion: '1',
        generalInformation: { handlerClass: 'ZCL_ABAP_VIBE_ICF', servicePath: '/sap/zcli_mock_http1' },
      });
      expect(pulled).not.toHaveProperty('name');

      const push = await runCli(['push', DOC_REL, '--yes', '--json']);
      expect(push.exit).toBe(0);

      const del = await runCli(['delete', 'ZCLI_MOCK_HTTP1', '--type', 'HTTP', '--yes', '--json']);
      expect(del.exit).toBe(0);
      expect(parseEnvelope(del).data).toMatchObject({ object: 'zcli_mock_http1', type: 'HTTP', deleted: true });

      const gone = await runCli(['pull', 'ZCLI_MOCK_HTTP1', '--type', 'HTTP', '--json']);
      expect(gone.exit).toBe(8);
      expect(parseEnvelope(gone).error).toMatchObject({ code: 'OBJECT_NOT_FOUND' });
    });
  });

  it('rejects deletion of a node that does not exist, and non-local creates without a transport', async () => {
    await withMock(async () => {
      writeDoc(HTTP_DOC);

      const missing = await runCli(['delete', 'ZMISSING', '--type', 'HTTP', '--yes', '--json']);
      expect(missing.exit).toBe(8);
      expect(parseEnvelope(missing).error).toMatchObject({ code: 'OBJECT_NOT_FOUND' });

      const transportable = await runCli(['create', 'HTTP', 'ZCLI_MOCK_HTTP1', '--file', DOC_REL, '--package', 'ZPKG', '--yes', '--json']);
      expect(transportable.exit).toBe(7);
      expect(parseEnvelope(transportable).error).toMatchObject({ code: 'HTTP_PACKAGE_NOT_SUPPORTED' });

      const tooLong = await runCli(['delete', 'ZCLI_MOCK_HTTP_TOO_LONG', '--type', 'HTTP', '--yes', '--json']);
      expect(tooLong.exit).toBe(7);
      expect(parseEnvelope(tooLong).error).toMatchObject({ code: 'HTTP_SERVICE_INVALID' });
    });
  });
});
