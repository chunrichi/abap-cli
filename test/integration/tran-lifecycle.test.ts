/**
 * TRAN lifecycle contract: create → pull → push → delete.
 *
 * Drives the real CLI binary against mock-adt's ICF `/tran/<tcode>` endpoints,
 * which mirror the ABAP handler envelope (200 + structured error codes). The
 * suite pins the CLI-side contract that the SE93 write path depends on:
 *   - create requires --file / --package, rejects OO transactions
 *   - pull writes a self-contained AFF document (name + package + one type block)
 *   - push updates an existing transaction and reports a transport
 *   - delete removes it through ICF and a follow-up pull maps to exit 8
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

const TMP_HOME = mkdtempSync(join(os.tmpdir(), 'abap-tran-home-'));
mkdirSync(join(TMP_HOME, '.abap-cli'), { recursive: true });
const TMP_PROJECT = mkdtempSync(join(os.tmpdir(), 'abap-tran-project-'));
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

const TRAN_DOC = {
  name: 'ZCLI_MOCK_T1',
  formatVersion: '1',
  package: '$TMP',
  header: { description: 'mock dialog transaction', originalLanguage: 'EN', abapLanguageVersion: 'standard' },
  generalInformation: {
    transactionType: 'dialogTransaction',
    lockStatus: 'notLocked',
    dialogTransaction: { programName: 'SAPLSETB', programDynnr: '0230', stvMaintenanceMode: 'notAllowed' },
  },
};

function writeDoc(doc: unknown): string {
  const rel = 'src/zcli_mock_t1.tran.json';
  mkdirSync(join(TMP_PROJECT, 'src'), { recursive: true });
  writeFileSync(join(TMP_PROJECT, rel), JSON.stringify(doc, null, 2) + '\n');
  return rel;
}

afterAll(() => {
  rmSync(TMP_HOME, { recursive: true, force: true });
  rmSync(TMP_PROJECT, { recursive: true, force: true });
});

describe.skipIf(!hasBuiltCli)('TRAN /tran lifecycle (mock ICF)', () => {
  it('creates, pulls, pushes and deletes a transaction code', async () => {
    await withMock(async () => {
      const rel = writeDoc(TRAN_DOC);

      const create = await runCli(['create', 'TRAN', 'ZCLI_MOCK_T1', '--file', rel, '--package', '$TMP', '--yes', '--json']);
      expect(create.exit).toBe(0);
      expect(parseEnvelope(create).data).toMatchObject({ object: 'ZCLI_MOCK_T1', type: 'TRAN', action: 'created' });

      // Pull back: the local document must carry the object name + package so a
      // later push lands in the same package without repeating --package.
      mkdirSync(join(TMP_PROJECT, 'src'), { recursive: true });
      const pull = await runCli(['pull', 'ZCLI_MOCK_T1', '--type', 'TRAN', '--overwrite', '--json']);
      expect(pull.exit).toBe(0);
      const pulled = JSON.parse(readFileSync(join(TMP_PROJECT, 'src/zcli_mock_t1.tran.json'), 'utf8'));
      expect(pulled).toMatchObject({ name: 'ZCLI_MOCK_T1', package: '$TMP', formatVersion: '1' });
      expect(pulled.generalInformation.transactionType).toBe('dialogTransaction');
      // Only the matching type block is written (the ICF GET carries all of them).
      expect(pulled.generalInformation.parameterTransaction).toBeUndefined();
      expect(pulled.authorizations).toBeUndefined();

      // Push an edit; the mock reports the update action.
      writeDoc({ ...pulled, header: { ...pulled.header, description: 'mock description v2' } });
      const push = await runCli(['push', 'src/zcli_mock_t1.tran.json', '--yes', '--json']);
      expect(push.exit).toBe(0);

      const afterPush = await runCli(['pull', 'ZCLI_MOCK_T1', '--type', 'TRAN', '--overwrite', '--json']);
      expect(afterPush.exit).toBe(0);
      const repulled = JSON.parse(readFileSync(join(TMP_PROJECT, 'src/zcli_mock_t1.tran.json'), 'utf8'));
      expect(repulled.header.description).toBe('mock description v2');

      const del = await runCli(['delete', 'ZCLI_MOCK_T1', '--type', 'TRAN', '--yes', '--json']);
      expect(del.exit).toBe(0);
      expect(parseEnvelope(del).data).toMatchObject({ object: 'ZCLI_MOCK_T1', type: 'TRAN', deleted: true });

      const gone = await runCli(['pull', 'ZCLI_MOCK_T1', '--type', 'TRAN', '--json']);
      expect(gone.exit).toBe(8);
      expect(parseEnvelope(gone).error).toMatchObject({ code: 'OBJECT_NOT_FOUND' });
    });
  });

  it('rejects OO transactions and non-$TMP writes without a transport', async () => {
    await withMock(async () => {
      const oo = writeDoc({
        ...TRAN_DOC,
        name: 'ZCLI_MOCK_T2',
        generalInformation: {
          transactionType: 'ooTransaction',
          lockStatus: 'notLocked',
          ooTransaction: { className: 'CL_ABAP_TYPEDESCR', methodName: 'NAME', updateMode: 'notSet' },
        },
      });
      const created = await runCli(['create', 'TRAN', 'ZCLI_MOCK_T2', '--file', oo, '--package', '$TMP', '--yes', '--json']);
      expect(created.exit).toBe(7);
      expect(parseEnvelope(created).error).toMatchObject({ code: 'TRAN_OO_NOT_SUPPORTED' });

      const missingTr = await runCli(['create', 'TRAN', 'ZCLI_MOCK_T2', '--file', oo, '--package', 'ZPKG', '--yes', '--json']);
      expect(missingTr.exit).toBe(7);
      expect(parseEnvelope(missingTr).error).toMatchObject({ code: 'VALIDATION_ERROR' });
    });
  });
});
