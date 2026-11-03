/**
 * DDIC push of a pulled abap-file-format three-piece must stay transport-free
 * when the existing object lives in a `$`-prefixed local package.
 *
 * `abap pull` emits header-only main JSON + `.tabl.ddic` / `.tabl.settings.json`
 * sidecars (the AFF schema has no `package`), so push has to read the target
 * object's package back from SAP. The mock runs with MOCK_NO_TRANSPORTS=1: a
 * package-less file is only pushable when the object is recognised as local.
 * Transportable targets keep the normal rule (--tr required).
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

const TMP_HOME = mkdtempSync(join(os.tmpdir(), 'abap-ddic-local-home-'));
mkdirSync(join(TMP_HOME, '.abap-cli'), { recursive: true });
const TMP_PROJECT = mkdtempSync(join(os.tmpdir(), 'abap-ddic-local-project-'));
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
    const proc = spawn('node', [MOCK, String(port)], {
      stdio: ['ignore', 'pipe', 'pipe'],
      // No open requests: the reporter's environment. A local target must not
      // need one; a transportable target must still fail with NO_TRANSPORT.
      env: { ...process.env, MOCK_NO_TRANSPORTS: '1' },
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

async function withMock<T>(fn: (port: number) => Promise<T>): Promise<T> {
  const port = await getFreePort();
  writeSystemsConfig(port);
  const proc = await startMock(port);
  try {
    return await fn(port);
  } finally {
    proc.kill('SIGTERM');
  }
}

function parseEnvelope(result: { stdout: string; stderr: string }): Record<string, any> {
  const text = result.stdout.trim() ? result.stdout : result.stderr;
  return JSON.parse(text.slice(text.indexOf('{'))) as Record<string, any>;
}

/** Write the three-piece abap-file-format artifact for one table. */
function writeTableArtifact(name: string, fields: string[]): string {
  const token = name.toLowerCase();
  mkdirSync(join(TMP_PROJECT, 'src'), { recursive: true });
  const rel = `src/${token}.tabl.json`;
  writeFileSync(join(TMP_PROJECT, rel), JSON.stringify({
    formatVersion: '1',
    header: { description: 'DDIC local-package push fixture', originalLanguage: 'en' },
  }, null, 2) + '\n');
  writeFileSync(join(TMP_PROJECT, `src/${token}.tabl.ddic`), [
    `define table ${token} {`,
    ...fields,
    '}',
    '',
  ].join('\n'));
  return rel;
}

function writeTableSettings(name: string): void {
  const token = name.toLowerCase();
  writeFileSync(join(TMP_PROJECT, `src/${token}.tabl.settings.json`), JSON.stringify({
    formatVersion: '1',
    generalInformation: { dataClassCategory: 'APPL0', sizeCategory: '0' },
  }, null, 2) + '\n');
}

async function fetchDdic(port: number, type: string, name: string): Promise<Record<string, any>> {
  const resp = await fetch(`http://localhost:${port}/sap/abap_cli/ddic/${type}/${name}`);
  return await resp.json() as Record<string, any>;
}

afterAll(() => {
  rmSync(TMP_HOME, { recursive: true, force: true });
  rmSync(TMP_PROJECT, { recursive: true, force: true });
});

describe.skipIf(!hasBuiltCli)('DDIC push: pulled artifact into a local package', () => {
  it('updates a $CRW table without --tr (transport-free) and keeps the package', async () => {
    await withMock(async (port) => {
      const name = 'ZCLI_MOCK_L1';
      const createRel = writeTableArtifact(name, [
        '  key mandt : abap.clnt not null;',
        '  key id    : abap.char(10) not null;',
        '  note      : abap.char(40);',
      ]);
      writeTableSettings(name);

      const create = await runCli(['create', 'TABL', name, '--file', createRel, '--package', '$CRW', '--description', 'DDIC local push fixture', '--yes', '--json']);
      expect(create.exit).toBe(0);
      expect(parseEnvelope(create).data).toMatchObject({ object: name, type: 'TABL', action: 'created' });

      // pull → edit → push: the local artifact has no package field, the
      // SAP-side object does. Rewrite the DDL with an added field.
      const pushRel = writeTableArtifact(name, [
        '  key mandt : abap.clnt not null;',
        '  key id    : abap.char(10) not null;',
        '  note      : abap.char(40);',
        '  status    : abap.char(10);',
      ]);
      const push = await runCli(['push', pushRel, '--yes', '--json']);
      expect(push.exit).toBe(0);
      const pushed = parseEnvelope(push);
      expect(pushed.data.results[0]).toMatchObject({ status: 'written', transport: '', written: true });

      const stored = await fetchDdic(port, 'tabl', name);
      expect(stored.status).toBe('success');
      expect(stored.data.package).toBe('$CRW');
      expect(stored.data.transportRequest).toBeUndefined();
      expect(stored.data.fields.map((f: { fieldName: string }) => f.fieldName)).toContain('STATUS');

      // Round-trip: pull again and the new field is in the local artifact.
      const pullRel = `src/${name.toLowerCase()}.tabl.json`;
      const pull = await runCli(['pull', name, '--type', 'TABL', '--overwrite', '--json']);
      expect(pull.exit).toBe(0);
      const pulled = JSON.parse(readFileSync(join(TMP_PROJECT, pullRel), 'utf8')) as {
        package?: string;
        fields: Array<{ fieldName: string }>;
      };
      expect(pulled.package).toBe('$CRW');
      expect(pulled.fields.map((f) => f.fieldName)).toContain('STATUS');
    });
  });

  it('requires --tr for a package-less artifact whose target is in a transportable package', async () => {
    await withMock(async (port) => {
      const name = 'ZCLI_MOCK_L2';
      const createRel = writeTableArtifact(name, [
        '  key mandt : abap.clnt not null;',
        '  key id    : abap.char(10) not null;',
      ]);
      writeTableSettings(name);
      const create = await runCli(['create', 'TABL', name, '--file', createRel, '--package', 'ZPKG', '--tr', 'TRN001', '--yes', '--json']);
      expect(create.exit).toBe(0);

      const pushRel = writeTableArtifact(name, [
        '  key mandt : abap.clnt not null;',
        '  key id    : abap.char(10) not null;',
        '  status    : abap.char(10);',
      ]);
      const missing = await runCli(['push', pushRel, '--yes', '--json']);
      expect(missing.exit).toBe(7);
      expect(parseEnvelope(missing).error).toMatchObject({ code: 'NO_TRANSPORT' });
      // Nothing was written: the mock still reports the create-time definition.
      const unchanged = await fetchDdic(port, 'tabl', name);
      expect(unchanged.data.transportRequest).toBe('TRN001');
      expect(unchanged.data.fields.map((f: { fieldName: string }) => f.fieldName)).not.toContain('STATUS');

      const explicit = await runCli(['push', pushRel, '--tr', 'TRN001', '--yes', '--json']);
      expect(explicit.exit).toBe(0);
      expect(parseEnvelope(explicit).data.results[0]).toMatchObject({ status: 'written', transport: 'TRN001' });
      const stored = await fetchDdic(port, 'tabl', name);
      expect(stored.data.package).toBe('ZPKG');
      expect(stored.data.transportRequest).toBe('TRN001');
      expect(stored.data.fields.map((f: { fieldName: string }) => f.fieldName)).toContain('STATUS');
    });
  });
});
