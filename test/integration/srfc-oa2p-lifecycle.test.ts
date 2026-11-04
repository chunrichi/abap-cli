/**
 * SRFC / OA2P lifecycle contract against mock-adt's ICF routes.
 *
 * Drives the real CLI binary for both UCON object types:
 *   create → pull → push → re-pull → delete,
 * plus the error surface that only exists for TADIR-backed ICF types
 * (transport request required for non-local packages, missing-target push,
 * AFF validation, file-name mismatch) and the type catalog rows.
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

const TMP_HOME = mkdtempSync(join(os.tmpdir(), 'abap-ucon-home-'));
mkdirSync(join(TMP_HOME, '.abap-cli'), { recursive: true });
const TMP_PROJECT = mkdtempSync(join(os.tmpdir(), 'abap-ucon-project-'));
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

const SRFC_DOC = {
  formatVersion: '1',
  description: 'mock UCON RFC service',
  functionName: 'ZCLI_MOCK_RFC_FM',
  scope: 'E',
};

const OA2P_DOC = {
  formatVersion: '1',
  type: 'DEFAULT',
  noAuthCheck: false,
  scopes: ['scope-one', 'scope-two'],
};

function writeDoc(type: 'srfc' | 'oa2p', doc: unknown, name: string): string {
  const rel = `src/${name}.${type}.json`;
  mkdirSync(join(TMP_PROJECT, 'src'), { recursive: true });
  writeFileSync(join(TMP_PROJECT, rel), JSON.stringify(doc, null, 2) + '\n');
  return rel;
}

function readPulled(type: 'srfc' | 'oa2p', name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(TMP_PROJECT, 'src', `${name}.${type}.json`), 'utf8')) as Record<string, unknown>;
}

afterAll(() => {
  rmSync(TMP_HOME, { recursive: true, force: true });
  rmSync(TMP_PROJECT, { recursive: true, force: true });
});

describe.skipIf(!hasBuiltCli)('SRFC / OA2P ICF lifecycle (mock)', () => {
  it('creates, pulls, pushes, re-pulls and deletes a UCON RFC service', async () => {
    await withMock(async () => {
      const rel = writeDoc('srfc', SRFC_DOC, 'zcli_mock_srfc');

      const create = await runCli(['create', 'SRFC', 'ZCLI_MOCK_SRFC', '--file', rel, '--package', '$TMP', '--yes', '--json']);
      expect(create.exit, create.stderr || create.stdout).toBe(0);
      expect(parseEnvelope(create).data).toMatchObject({ object: 'ZCLI_MOCK_SRFC', type: 'SRFC', action: 'created', package: '$TMP' });

      const pull = await runCli(['pull', 'ZCLI_MOCK_SRFC', '--type', 'SRFC', '--overwrite', '--json']);
      expect(pull.exit, pull.stderr || pull.stdout).toBe(0);
      const pulled = readPulled('srfc', 'zcli_mock_srfc');
      expect(pulled).toEqual(SRFC_DOC);

      const validate = await runCli(['validate:aff', rel, '--json']);
      expect(validate.exit, validate.stderr || validate.stdout).toBe(0);

      writeDoc('srfc', { ...pulled, description: 'updated RFC service', scope: 'S' }, 'zcli_mock_srfc');
      const push = await runCli(['push', rel, '--yes', '--json']);
      expect(push.exit, push.stderr || push.stdout).toBe(0);

      const rePull = await runCli(['pull', 'ZCLI_MOCK_SRFC', '--type', 'SRFC', '--overwrite', '--json']);
      expect(rePull.exit, rePull.stderr || rePull.stdout).toBe(0);
      expect(readPulled('srfc', 'zcli_mock_srfc')).toMatchObject({ description: 'updated RFC service', scope: 'S' });

      const del = await runCli(['delete', 'ZCLI_MOCK_SRFC', '--type', 'SRFC', '--yes', '--json']);
      expect(del.exit, del.stderr || del.stdout).toBe(0);
      expect(parseEnvelope(del).data).toMatchObject({ object: 'ZCLI_MOCK_SRFC', type: 'SRFC', deleted: true });

      const gone = await runCli(['pull', 'ZCLI_MOCK_SRFC', '--type', 'SRFC', '--json']);
      expect(gone.exit).toBe(8);
      expect(parseEnvelope(gone).error).toMatchObject({ category: 'NOT_FOUND' });
    });
  });

  it('creates, pulls, pushes, re-pulls and deletes an OAuth 2.0 profile', async () => {
    await withMock(async () => {
      const rel = writeDoc('oa2p', OA2P_DOC, 'zcli_mock_oa2p');

      const create = await runCli(['create', 'OA2P', 'ZCLI_MOCK_OA2P', '--file', rel, '--package', '$TMP', '--yes', '--json']);
      expect(create.exit, create.stderr || create.stdout).toBe(0);

      const pull = await runCli(['pull', 'ZCLI_MOCK_OA2P', '--type', 'OA2P', '--overwrite', '--json']);
      expect(pull.exit, pull.stderr || pull.stdout).toBe(0);
      expect(readPulled('oa2p', 'zcli_mock_oa2p')).toEqual(OA2P_DOC);

      writeDoc('oa2p', { ...OA2P_DOC, noAuthCheck: true, scopes: ['scope-three'] }, 'zcli_mock_oa2p');
      const push = await runCli(['push', rel, '--yes', '--json']);
      expect(push.exit, push.stderr || push.stdout).toBe(0);

      const rePull = await runCli(['pull', 'ZCLI_MOCK_OA2P', '--type', 'OA2P', '--overwrite', '--json']);
      expect(rePull.exit, rePull.stderr || rePull.stdout).toBe(0);
      expect(readPulled('oa2p', 'zcli_mock_oa2p')).toMatchObject({ noAuthCheck: true, scopes: ['scope-three'] });

      const del = await runCli(['delete', 'ZCLI_MOCK_OA2P', '--type', 'OA2P', '--yes', '--json']);
      expect(del.exit, del.stderr || del.stdout).toBe(0);
    });
  });

  it('rejects local input errors before any SAP call', async () => {
    await withMock(async () => {
      const rel = writeDoc('srfc', SRFC_DOC, 'zcli_mock_srfc');

      // --check-only validates locally and must not create the service.
      const checkOnly = await runCli(['create', 'SRFC', 'ZCLI_MOCK_SRFC', '--file', rel, '--package', '$TMP', '--check-only', '--yes', '--json']);
      expect(checkOnly.exit, checkOnly.stderr || checkOnly.stdout).toBe(0);
      const notCreated = await runCli(['pull', 'ZCLI_MOCK_SRFC', '--type', 'SRFC', '--json']);
      expect(notCreated.exit).toBe(8);

      // Missing --file is a usage error.
      const noFile = await runCli(['create', 'SRFC', 'ZCLI_MOCK_SRFC_NF', '--yes', '--json']);
      expect(noFile.exit).toBe(2);

      // Transportable package without --tr is rejected locally.
      const noTr = await runCli(['create', 'SRFC', 'ZCLI_MOCK_SRFC', '--file', rel, '--package', 'ZPKG_DEV', '--yes', '--json']);
      expect(noTr.exit).toBe(7);
      expect(parseEnvelope(noTr).error).toMatchObject({ code: 'VALIDATION_ERROR' });

      // Structurally invalid document fails AFF validation.
      const badSchemaRel = writeDoc('srfc', { formatVersion: '1', scope: 'Z' }, 'zcli_mock_srfc_bad');
      const badSchema = await runCli(['create', 'SRFC', 'ZCLI_MOCK_SRFC_BAD', '--file', badSchemaRel, '--package', '$TMP', '--yes', '--json']);
      expect(badSchema.exit).toBe(7);

      // File name that does not match the service name is rejected locally.
      const mismatch = await runCli(['create', 'SRFC', 'ZCLI_MOCK_SRFC_OTHER', '--file', rel, '--package', '$TMP', '--yes', '--json']);
      expect(mismatch.exit).toBe(2);

      // push updates existing objects only: a local file without a SAP
      // counterpart fails with NOT_FOUND and tells the caller to create first.
      const createReal = await runCli(['create', 'SRFC', 'ZCLI_MOCK_SRFC', '--file', rel, '--package', '$TMP', '--yes', '--json']);
      expect(createReal.exit, createReal.stderr || createReal.stdout).toBe(0);
      const newRel = writeDoc('srfc', SRFC_DOC, 'zcli_mock_srfc_new');
      const pushMissing = await runCli(['push', newRel, '--yes', '--json']);
      expect(pushMissing.exit).toBe(8);
      expect(parseEnvelope(pushMissing).error).toMatchObject({ category: 'NOT_FOUND' });

      // delete without --yes is a usage error.
      const noYes = await runCli(['delete', 'ZCLI_MOCK_SRFC', '--type', 'SRFC', '--json']);
      expect(noYes.exit).toBe(2);
    });
  });

  it('lists both UCON types in the local type catalog', async () => {
    const types = await runCli(['types', '--json']);
    expect(types.exit).toBe(0);
    const rows = parseEnvelope(types).data as Array<Record<string, unknown>>;
    expect(rows.find((entry) => entry.cliType === 'SRFC')).toMatchObject({ cliType: 'SRFC', channel: 'ICF', tadirObject: 'SRFC' });
    expect(rows.find((entry) => entry.cliType === 'OA2P')).toMatchObject({ cliType: 'OA2P', channel: 'ICF', tadirObject: 'OA2P' });
  });
});
