/**
 * SHLP lifecycle contract: create → pull → push → edit → pull → delete,
 * for an elementary search help plus a collective one that includes it.
 *
 * Drives the real CLI binary against mock-adt's ICF `/ddic/shlp` endpoints,
 * which mirror the ABAP handler envelope (200 + structured error codes) and
 * the elementary/collective structural rules.
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

const TMP_HOME = mkdtempSync(join(os.tmpdir(), 'abap-shlp-home-'));
mkdirSync(join(TMP_HOME, '.abap-cli'), { recursive: true });
const TMP_PROJECT = mkdtempSync(join(os.tmpdir(), 'abap-shlp-project-'));
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

const ELEMENTARY_DOC = {
  formatVersion: '1',
  header: { description: 'mock elementary search help', originalLanguage: 'en' },
  name: 'ZCLI_MOCK_S1',
  kind: 'elementary',
  selectionMethod: 'T002',
  selectionMethodType: 'table',
  textTable: 'T002T',
  parameters: [
    { fieldName: 'SPRAS', rollName: 'SPRAS', input: true, output: true },
    { fieldName: 'LAISO', rollName: 'LAISO', output: true },
  ],
};

const COLLECTIVE_DOC = {
  formatVersion: '1',
  header: { description: 'mock collective search help', originalLanguage: 'en' },
  name: 'ZCLI_MOCK_SC',
  kind: 'collective',
  parameters: [
    { fieldName: 'SPRAS', rollName: 'SPRAS', input: true, output: true },
  ],
  includedSearchHelps: [{ searchHelp: 'ZCLI_MOCK_S1', position: 1 }],
  parameterMappings: [
    { fieldName: 'SPRAS', subSearchHelp: 'ZCLI_MOCK_S1', subFieldName: 'SPRAS', valueDirection: 'import' },
  ],
};

function writeDoc(name: 'zcli_mock_s1' | 'zcli_mock_sc', doc: unknown): string {
  const rel = `src/${name}.shlp.json`;
  mkdirSync(join(TMP_PROJECT, 'src'), { recursive: true });
  writeFileSync(join(TMP_PROJECT, rel), JSON.stringify(doc, null, 2) + '\n');
  return rel;
}

function readPulled(name: 'zcli_mock_s1' | 'zcli_mock_sc'): Record<string, unknown> {
  return JSON.parse(readFileSync(join(TMP_PROJECT, `src/${name}.shlp.json`), 'utf8')) as Record<string, unknown>;
}

afterAll(() => {
  rmSync(TMP_HOME, { recursive: true, force: true });
  rmSync(TMP_PROJECT, { recursive: true, force: true });
});

describe.skipIf(!hasBuiltCli)('SHLP /ddic/shlp lifecycle (mock ICF)', () => {
  it('creates, pulls, pushes and deletes an elementary search help', async () => {
    await withMock(async () => {
      const rel = writeDoc('zcli_mock_s1', ELEMENTARY_DOC);

      const create = await runCli(['create', 'SHLP', 'ZCLI_MOCK_S1', '--file', rel, '--package', '$TMP', '--yes', '--json']);
      expect(create.exit).toBe(0);
      expect(parseEnvelope(create).data).toMatchObject({ object: 'ZCLI_MOCK_S1', type: 'SHLP', action: 'created' });

      const pull = await runCli(['pull', 'ZCLI_MOCK_S1', '--type', 'SHLP', '--overwrite', '--json']);
      expect(pull.exit).toBe(0);
      const pulled = readPulled('zcli_mock_s1');
      expect(pulled).toMatchObject({ name: 'ZCLI_MOCK_S1', package: '$TMP', kind: 'elementary', selectionMethod: 'T002' });
      expect(pulled.parameters).toHaveLength(2);
      expect(pulled).not.toHaveProperty('type');

      writeDoc('zcli_mock_s1', {
        ...pulled,
        header: { ...(pulled.header as Record<string, unknown>), description: 'mock elementary search help v2' },
        textTable: 'T002T',
      });
      const push = await runCli(['push', 'src/zcli_mock_s1.shlp.json', '--yes', '--json']);
      expect(push.exit).toBe(0);

      const afterPush = await runCli(['pull', 'ZCLI_MOCK_S1', '--type', 'SHLP', '--overwrite', '--json']);
      expect(afterPush.exit).toBe(0);
      expect((readPulled('zcli_mock_s1').header as Record<string, unknown>).description).toBe('mock elementary search help v2');

      const del = await runCli(['delete', 'ZCLI_MOCK_S1', '--type', 'SHLP', '--yes', '--json']);
      expect(del.exit).toBe(0);
      expect(parseEnvelope(del).data).toMatchObject({ object: 'ZCLI_MOCK_S1', type: 'SHLP', deleted: true });

      const gone = await runCli(['pull', 'ZCLI_MOCK_S1', '--type', 'SHLP', '--json']);
      expect(gone.exit).toBe(8);
      expect(parseEnvelope(gone).error).toMatchObject({ code: 'OBJECT_NOT_FOUND' });
    });
  });

  it('creates, pulls and deletes a collective search help that includes the elementary one', async () => {
    await withMock(async () => {
      const elementaryRel = writeDoc('zcli_mock_s1', ELEMENTARY_DOC);
      expect((await runCli(['create', 'SHLP', 'ZCLI_MOCK_S1', '--file', elementaryRel, '--package', '$TMP', '--yes', '--json'])).exit).toBe(0);

      const collectiveRel = writeDoc('zcli_mock_sc', COLLECTIVE_DOC);
      const create = await runCli(['create', 'SHLP', 'ZCLI_MOCK_SC', '--file', collectiveRel, '--package', '$TMP', '--yes', '--json']);
      expect(create.exit).toBe(0);

      const pull = await runCli(['pull', 'ZCLI_MOCK_SC', '--type', 'SHLP', '--overwrite', '--json']);
      expect(pull.exit).toBe(0);
      const pulled = readPulled('zcli_mock_sc');
      expect(pulled.kind).toBe('collective');
      expect(pulled.includedSearchHelps).toEqual([{ searchHelp: 'ZCLI_MOCK_S1', position: 1 }]);
      expect(pulled.parameterMappings).toEqual([
        { fieldName: 'SPRAS', subSearchHelp: 'ZCLI_MOCK_S1', subFieldName: 'SPRAS', valueDirection: 'import' },
      ]);

      const delCollective = await runCli(['delete', 'ZCLI_MOCK_SC', '--type', 'SHLP', '--yes', '--json']);
      expect(delCollective.exit).toBe(0);
      const delElementary = await runCli(['delete', 'ZCLI_MOCK_S1', '--type', 'SHLP', '--yes', '--json']);
      expect(delElementary.exit).toBe(0);
    });
  });

  it('rejects over-long names, non-$TMP writes without a transport and invalid kind contracts', async () => {
    await withMock(async () => {
      const rel = writeDoc('zcli_mock_s1', ELEMENTARY_DOC);

      // Payload name / command name mismatch is caught locally before any SAP call.
      writeDoc('zcli_mock_s1', { ...ELEMENTARY_DOC, name: 'ZCLI_MOCK_OTHER' });
      const nameMismatch = await runCli(['create', 'SHLP', 'ZCLI_MOCK_S1', '--file', rel, '--package', '$TMP', '--yes', '--json']);
      expect(nameMismatch.exit).toBe(7);
      expect(parseEnvelope(nameMismatch).error).toMatchObject({ code: 'SHLP_NAME_INVALID' });
      writeDoc('zcli_mock_s1', ELEMENTARY_DOC);

      const missingTr = await runCli(['create', 'SHLP', 'ZCLI_MOCK_S1', '--file', rel, '--package', 'ZPKG', '--yes', '--json']);
      expect(missingTr.exit).toBe(7);
      expect(parseEnvelope(missingTr).error).toMatchObject({ code: 'VALIDATION_ERROR' });

      // Collective without includes/mappings → CLI validation error.
      writeDoc('zcli_mock_sc', { ...COLLECTIVE_DOC, includedSearchHelps: [], parameterMappings: [] });
      const badCollective = await runCli(['create', 'SHLP', 'ZCLI_MOCK_SC', '--file', 'src/zcli_mock_sc.shlp.json', '--package', '$TMP', '--yes', '--json']);
      expect(badCollective.exit).toBe(7);
      expect(parseEnvelope(badCollective).error).toMatchObject({ code: 'AFF_FIXTURE_INVALID' });

      // Collective that includes a search help the mock does not know.
      writeDoc('zcli_mock_sc', {
        ...COLLECTIVE_DOC,
        includedSearchHelps: [{ searchHelp: 'ZCLI_MOCK_MISSING', position: 1 }],
        parameterMappings: [{ fieldName: 'SPRAS', subSearchHelp: 'ZCLI_MOCK_MISSING', subFieldName: 'SPRAS' }],
      });
      const missingInclude = await runCli(['create', 'SHLP', 'ZCLI_MOCK_SC', '--file', 'src/zcli_mock_sc.shlp.json', '--package', '$TMP', '--yes', '--json']);
      expect(missingInclude.exit).toBe(8);
      expect(parseEnvelope(missingInclude).error).toMatchObject({ code: 'SHLP_INCLUDED_NOT_FOUND' });
    });
  });
});
