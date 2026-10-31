/**
 * VIEW lifecycle contract: create → pull → push → edit → pull → delete.
 *
 * Drives the real CLI binary against mock-adt's ICF `/ddic/view` endpoints,
 * which mirror the ABAP handler envelope (200 + structured error codes) and
 * the 16-character / $TMP-only rules. Pins the CLI-side contract the DDIC
 * view write path depends on.
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

const TMP_HOME = mkdtempSync(join(os.tmpdir(), 'abap-view-home-'));
mkdirSync(join(TMP_HOME, '.abap-cli'), { recursive: true });
const TMP_PROJECT = mkdtempSync(join(os.tmpdir(), 'abap-view-project-'));
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

const VIEW_DOC = {
  formatVersion: '1',
  header: { description: 'mock database view', originalLanguage: 'en' },
  name: 'ZCLI_MOCK_V1',
  viewClass: 'databaseView',
  rootTable: 'MARA',
  tables: [
    { tableName: 'MARA', tablePosition: 1 },
    { tableName: 'MAKT', tablePosition: 2, foreignTableName: 'MARA' },
  ],
  fields: [
    { tableName: 'MARA', fieldName: 'MANDT', keyFlag: true },
    { tableName: 'MARA', fieldName: 'MATNR', keyFlag: true },
    { tableName: 'MAKT', fieldName: 'SPRAS', keyFlag: true },
    { tableName: 'MAKT', fieldName: 'MAKTX' },
  ],
  joinConditions: [
    { leftTable: 'MARA', leftField: 'MANDT', rightTable: 'MAKT', rightField: 'MANDT' },
    { leftTable: 'MARA', leftField: 'MATNR', rightTable: 'MAKT', rightField: 'MATNR' },
  ],
};

function writeDoc(doc: unknown): string {
  const rel = 'src/zcli_mock_v1.view.json';
  mkdirSync(join(TMP_PROJECT, 'src'), { recursive: true });
  writeFileSync(join(TMP_PROJECT, rel), JSON.stringify(doc, null, 2) + '\n');
  return rel;
}

function readPulled(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(TMP_PROJECT, 'src/zcli_mock_v1.view.json'), 'utf8')) as Record<string, unknown>;
}

afterAll(() => {
  rmSync(TMP_HOME, { recursive: true, force: true });
  rmSync(TMP_PROJECT, { recursive: true, force: true });
});

describe.skipIf(!hasBuiltCli)('VIEW /ddic/view lifecycle (mock ICF)', () => {
  it('creates, pulls, pushes, re-pulls and deletes a database view', async () => {
    await withMock(async () => {
      writeDoc(VIEW_DOC);

      const create = await runCli(['create', 'VIEW', 'ZCLI_MOCK_V1', '--file', 'src/zcli_mock_v1.view.json', '--package', '$TMP', '--yes', '--json']);
      expect(create.exit).toBe(0);
      expect(parseEnvelope(create).data).toMatchObject({ object: 'ZCLI_MOCK_V1', type: 'VIEW', action: 'created' });

      // Pull back: the local document must be self-contained (name, package,
      // viewClass, tables, fields, joins) so a later push lands unchanged.
      const pull = await runCli(['pull', 'ZCLI_MOCK_V1', '--type', 'VIEW', '--overwrite', '--json']);
      expect(pull.exit).toBe(0);
      const pulled = readPulled();
      expect(pulled).toMatchObject({ name: 'ZCLI_MOCK_V1', package: '$TMP', viewClass: 'databaseView', formatVersion: '1' });
      expect(pulled.tables).toHaveLength(2);
      expect(pulled.fields).toHaveLength(4);
      expect(pulled.joinConditions).toHaveLength(2);
      expect(pulled).not.toHaveProperty('type');

      // Push an edit (description + one extra field); mock reports the update.
      const header = { ...(pulled.header as Record<string, unknown>), description: 'mock database view v2' };
      const fields = [...(pulled.fields as Array<Record<string, unknown>>), { tableName: 'MAKT', fieldName: 'MAKTG' }];
      writeDoc({ ...pulled, header, fields });
      const push = await runCli(['push', 'src/zcli_mock_v1.view.json', '--yes', '--json']);
      expect(push.exit).toBe(0);

      const afterPush = await runCli(['pull', 'ZCLI_MOCK_V1', '--type', 'VIEW', '--overwrite', '--json']);
      expect(afterPush.exit).toBe(0);
      const repulled = readPulled();
      expect((repulled.header as Record<string, unknown>).description).toBe('mock database view v2');
      expect(repulled.fields).toHaveLength(5);

      const del = await runCli(['delete', 'ZCLI_MOCK_V1', '--type', 'VIEW', '--yes', '--json']);
      expect(del.exit).toBe(0);
      expect(parseEnvelope(del).data).toMatchObject({ object: 'ZCLI_MOCK_V1', type: 'VIEW', deleted: true });

      const gone = await runCli(['pull', 'ZCLI_MOCK_V1', '--type', 'VIEW', '--json']);
      expect(gone.exit).toBe(8);
      expect(parseEnvelope(gone).error).toMatchObject({ code: 'OBJECT_NOT_FOUND' });
    });
  });

  it('rejects over-long names, non-$TMP writes without a transport and push of a missing view', async () => {
    await withMock(async () => {
      writeDoc(VIEW_DOC);

      const tooLong = await runCli(['create', 'VIEW', 'ZCLI_MOCK_VIEW_TOO_LONG', '--file', 'src/zcli_mock_v1.view.json', '--package', '$TMP', '--yes', '--json']);
      expect(tooLong.exit).toBe(7);
      expect(parseEnvelope(tooLong).error).toMatchObject({ code: 'VIEW_NAME_INVALID' });

      const missingTr = await runCli(['create', 'VIEW', 'ZCLI_MOCK_V1', '--file', 'src/zcli_mock_v1.view.json', '--package', 'ZPKG', '--yes', '--json']);
      expect(missingTr.exit).toBe(7);
      expect(parseEnvelope(missingTr).error).toMatchObject({ code: 'VALIDATION_ERROR' });

      const missingView = await runCli(['push', 'src/zcli_mock_v1.view.json', '--yes', '--json']);
      expect(missingView.exit).toBe(8);
      expect(parseEnvelope(missingView).error).toMatchObject({ code: 'OBJECT_NOT_FOUND' });
    });
  });
});
