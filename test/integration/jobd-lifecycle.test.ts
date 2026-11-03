/**
 * JOBD lifecycle contract: create → pull → push → pull → delete.
 *
 * Drives the real CLI binary against mock-adt's ICF `/jobd/<name>` endpoints,
 * which mirror the ABAP handler envelope (200 + structured error codes), the
 * 32-character name limit and the package/transport rules. Pins the CLI-side
 * contract the JOBD write path depends on.
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

const TMP_HOME = mkdtempSync(join(os.tmpdir(), 'abap-jobd-home-'));
mkdirSync(join(TMP_HOME, '.abap-cli'), { recursive: true });
const TMP_PROJECT = mkdtempSync(join(os.tmpdir(), 'abap-jobd-project-'));
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

const JOB_DOC = {
  formatVersion: '1',
  name: 'ZCLI_MOCK_JOBD',
  btcjobName: 'ZCLI_MOCK_JOBD',
  isTimeBased: 'X',
  startTime: '06:00:00',
  recurCode: 'D',
  recurValue: 1,
  reportName: 'ZCLI_MOCK_REPORT',
  variantName: '',
};

function writeDoc(doc: unknown, rel = 'src/zcli_mock_jobd.jobd.json'): string {
  mkdirSync(join(TMP_PROJECT, 'src'), { recursive: true });
  writeFileSync(join(TMP_PROJECT, rel), JSON.stringify(doc, null, 2) + '\n');
  return rel;
}

function readPulled(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(TMP_PROJECT, 'src/zcli_mock_jobd.jobd.json'), 'utf8')) as Record<string, unknown>;
}

afterAll(() => {
  rmSync(TMP_HOME, { recursive: true, force: true });
  rmSync(TMP_PROJECT, { recursive: true, force: true });
});

describe.skipIf(!hasBuiltCli)('JOBD /jobd lifecycle (mock ICF)', () => {
  it('creates, pulls, pushes, re-pulls and deletes a job definition', async () => {
    await withMock(async () => {
      writeDoc(JOB_DOC);

      const create = await runCli(['create', 'JOBD', 'ZCLI_MOCK_JOBD', '--file', 'src/zcli_mock_jobd.jobd.json', '--package', '$TMP', '--yes', '--json']);
      expect(create.exit, create.stderr || create.stdout).toBe(0);
      expect(parseEnvelope(create).data).toMatchObject({ object: 'ZCLI_MOCK_JOBD', type: 'JOBD', action: 'created', package: '$TMP' });

      const pull = await runCli(['pull', 'ZCLI_MOCK_JOBD', '--type', 'JOBD', '--overwrite', '--json']);
      expect(pull.exit).toBe(0);
      const pulled = readPulled();
      expect(pulled).toMatchObject({ formatVersion: '1', name: 'ZCLI_MOCK_JOBD', package: '$TMP', isTimeBased: 'X', reportName: 'ZCLI_MOCK_REPORT' });

      // Push an edit; the mock reports the update and the re-pull shows it.
      writeDoc({ ...JOB_DOC, recurCode: 'M', recurValue: 2 });
      const push = await runCli(['push', 'src/zcli_mock_jobd.jobd.json', '--yes', '--json']);
      expect(push.exit, push.stderr || push.stdout).toBe(0);
      expect(parseEnvelope(push).data).toMatchObject({ failed: 0 });
      const rePull = await runCli(['pull', 'ZCLI_MOCK_JOBD', '--type', 'JOBD', '--overwrite', '--json']);
      expect(rePull.exit).toBe(0);
      expect(readPulled()).toMatchObject({ recurCode: 'M', recurValue: 2 });

      const del = await runCli(['delete', 'ZCLI_MOCK_JOBD', '--type', 'JOBD', '--yes', '--json']);
      expect(del.exit, del.stderr || del.stdout).toBe(0);
      expect(parseEnvelope(del).data).toMatchObject({ object: 'ZCLI_MOCK_JOBD', deleted: true });

      const gone = await runCli(['pull', 'ZCLI_MOCK_JOBD', '--type', 'JOBD', '--json']);
      expect(gone.exit).toBe(8);
      expect(parseEnvelope(gone).error).toMatchObject({ code: 'OBJECT_NOT_FOUND', category: 'NOT_FOUND' });
    });
  });

  it('rejects invalid names, transport-less writes and unsupported flags', async () => {
    await withMock(async () => {
      const tooLong = `ZCLI_JOBD_${'X'.repeat(30)}`;
      writeDoc({ ...JOB_DOC, name: tooLong }, 'src/too_long.jobd.json');
      const longName = await runCli(['create', 'JOBD', tooLong, '--file', 'src/too_long.jobd.json', '--package', '$TMP', '--yes', '--json']);
      expect(longName.exit).toBe(7);

      writeDoc({ ...JOB_DOC, name: 'ZCLI_MOCK_JOBD2' });
      const noTransport = await runCli(['create', 'JOBD', 'ZCLI_MOCK_JOBD2', '--file', 'src/zcli_mock_jobd.jobd.json', '--package', 'ZTEST', '--yes', '--json']);
      expect(noTransport.exit).toBe(7);
      expect(JSON.stringify(parseEnvelope(noTransport).error)).toContain('transport');

      const noActivate = await runCli(['create', 'JOBD', 'ZCLI_MOCK_JOBD2', '--file', 'src/zcli_mock_jobd.jobd.json', '--package', '$TMP', '--no-activate', '--yes', '--json']);
      expect(noActivate.exit).toBe(7);

      const pushMissing = await runCli(['push', 'src/zcli_mock_jobd.jobd.json', '--yes', '--json']);
      expect(pushMissing.exit).toBe(8);

      const badName = await runCli(['create', 'JOBD', 'zcli bad', '--file', 'src/zcli_mock_jobd.jobd.json', '--package', '$TMP', '--yes', '--json']);
      expect(badName.exit, badName.stderr || badName.stdout).toBe(7);
    });
  });
});
