/**
 * DOMA/DTEL long-text companion lifecycle against the mock ICF service.
 *
 * Drives the real built CLI (`dist/index.js`) through create → pull → push →
 * delete of the 0..1 `<name>.doma.docu.json` companion, plus the invalid-
 * companion guard. The mock serves `/sap/abap_cli/ddic/<doma|dtel>/<name>/docu`
 * with the same envelope as the ABAP handler (`DOCU_NOT_FOUND` on GET for an
 * object without text; POST with `lines: []` deletes it).
 *
 * Pinned contract:
 *   - pull writes the companion next to the main document and reports it
 *   - push sends an existing companion after the main document (`docu: saved`)
 *   - `lines: []` deletes the remote text and the next pull drops the stale file
 *   - line > 72 chars → AFF_FIXTURE_INVALID before the main object is written
 *   - `abap validate:aff` accepts the pulled companion
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

const TMP_HOME = mkdtempSync(join(os.tmpdir(), 'abap-docu-home-'));
mkdirSync(join(TMP_HOME, '.abap-cli'), { recursive: true });
const TMP_PROJECT = mkdtempSync(join(os.tmpdir(), 'abap-docu-project-'));
writeFileSync(
  join(TMP_PROJECT, '.abap.json'),
  JSON.stringify({ system: 'mock', transport: '', package: '$TMP' }, null, 2) + '\n',
);
mkdirSync(join(TMP_PROJECT, 'src'), { recursive: true });

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

function parseEnvelope(result: { stdout: string; stderr: string }): Record<string, any> {
  const text = result.stdout.trim() ? result.stdout : result.stderr;
  return JSON.parse(text.slice(text.indexOf('{')));
}

const DOMA_NAME = 'ZCLI_MOCK_DOCU';
const DOMA_MAIN = 'src/zcli_mock_docu.doma.json';
const DOMA_DOCU = 'src/zcli_mock_docu.doma.docu.json';

/** 72-char boundary line + SAPscript markers kept verbatim. */
const DOCU_LINES = [
  { format: 'H1', line: 'Domain long text' },
  { format: '', line: 'SAPscript markers stay as-is: <b>bold</b> & tab -> kept' },
  { format: '', line: 'x'.repeat(72) },
];

const DOMA_DOC = {
  name: DOMA_NAME,
  description: 'mock domain with long text',
  package: '$TMP',
  format: { dataType: 'CHAR', length: 10 },
};

function writeDomaMain(description = DOMA_DOC.description): void {
  writeFileSync(
    join(TMP_PROJECT, DOMA_MAIN),
    JSON.stringify({ ...DOMA_DOC, description }, null, 2) + '\n',
  );
}

function writeDomaDocu(lines: unknown): void {
  writeFileSync(join(TMP_PROJECT, DOMA_DOCU), JSON.stringify({ formatVersion: '1', lines }, null, 2) + '\n');
}

function readDomaDocu(): { formatVersion: string; lines: Array<{ format: string; line: string }> } {
  return JSON.parse(readFileSync(join(TMP_PROJECT, DOMA_DOCU), 'utf8'));
}

afterAll(() => {
  rmSync(TMP_HOME, { recursive: true, force: true });
  rmSync(TMP_PROJECT, { recursive: true, force: true });
});

describe.skipIf(!hasBuiltCli)('DOMA/DTEL .docu.json companion lifecycle (mock ICF)', () => {
  it('creates, pulls, pushes and deletes a DOMA long text', async () => {
    await withMock(async () => {
      writeDomaMain();
      // create the object without a companion: no docu write is triggered.
      const create = await runCli([
        'create', 'DOMA', DOMA_NAME, '--file', DOMA_MAIN, '--package', '$TMP', '--yes', '--json',
      ]);
      expect(create.exit).toBe(0);
      expect(parseEnvelope(create).data).toMatchObject({ object: DOMA_NAME, type: 'DOMA', action: 'created' });

      // pull without a companion on SAP: main file only, no docu file written.
      const pullEmpty = await runCli(['pull', DOMA_NAME, '--type', 'DOMA', '--overwrite', '--json']);
      expect(pullEmpty.exit).toBe(0);
      expect(existsSync(join(TMP_PROJECT, DOMA_MAIN))).toBe(true);
      expect(existsSync(join(TMP_PROJECT, DOMA_DOCU))).toBe(false);

      // local companion → push sends main object then long text.
      writeDomaDocu(DOCU_LINES);
      const push1 = await runCli(['push', DOMA_MAIN, '--yes', '--json']);
      expect(push1.exit).toBe(0);
      expect(parseEnvelope(push1).data.results[0]).toMatchObject({ status: 'written', docu: 'saved' });

      // pull back: companion written next to the main document, byte content
      // preserves format codes, 72-char boundary and SAPscript markers.
      const pull1 = await runCli(['pull', DOMA_NAME, '--type', 'DOMA', '--overwrite', '--json']);
      expect(pull1.exit).toBe(0);
      expect(parseEnvelope(pull1).data.entries).toEqual([
        { file: DOMA_MAIN, status: 'written' },
        { file: DOMA_DOCU, status: 'written', kind: 'docu' },
      ]);
      expect(readDomaDocu()).toEqual({ formatVersion: '1', lines: DOCU_LINES });

      // validate:aff accepts the companion via the docu-v1 schema.
      const validate = await runCli(['validate:aff', DOMA_DOCU, '--json']);
      expect(validate.exit).toBe(0);
      expect(parseEnvelope(validate).data.files[0]).toMatchObject({ status: 'pass', type: 'DOCU' });

      // edit + push again: the changed text round-trips.
      const edited = [
        { format: 'H1', line: 'Domain long text v2' },
        { format: '', line: 'second version' },
      ];
      writeDomaDocu(edited);
      const push2 = await runCli(['push', DOMA_MAIN, '--yes', '--json']);
      expect(push2.exit).toBe(0);
      expect(parseEnvelope(push2).data.results[0]).toMatchObject({ docu: 'saved' });
      const pull2 = await runCli(['pull', DOMA_NAME, '--type', 'DOMA', '--overwrite', '--json']);
      expect(pull2.exit).toBe(0);
      expect(readDomaDocu().lines).toEqual(edited);

      // delete: lines: [] → server deletes the long text; the next pull drops
      // the stale local companion (with --overwrite) and warns.
      writeDomaDocu([]);
      const push3 = await runCli(['push', DOMA_MAIN, '--yes', '--json']);
      expect(push3.exit).toBe(0);
      expect(parseEnvelope(push3).data.results[0]).toMatchObject({ docu: 'deleted' });

      const pull3 = await runCli(['pull', DOMA_NAME, '--type', 'DOMA', '--overwrite', '--json']);
      expect(pull3.exit).toBe(0);
      expect(existsSync(join(TMP_PROJECT, DOMA_DOCU))).toBe(false);
      const pull3Envelope = parseEnvelope(pull3);
      expect(pull3Envelope.data.deleted).toEqual([DOMA_DOCU]);
      expect(pull3Envelope.meta.warnings.map((w: { code: string }) => w.code)).toContain(
        'DOCU_LOCAL_STALE_REMOVED',
      );
    });
  });

  it('rejects an invalid companion before writing the main object', async () => {
    await withMock(async () => {
      writeDomaMain('description before invalid docu');
      const created = await runCli([
        'create', 'DOMA', DOMA_NAME, '--file', DOMA_MAIN, '--package', '$TMP', '--yes', '--json',
      ]);
      expect(created.exit).toBe(0);

      // 73-char line: the CLI must reject, and the main object must not be written.
      writeDomaMain('description after invalid docu');
      writeDomaDocu([{ format: '', line: 'x'.repeat(73) }]);
      const push = await runCli(['push', DOMA_MAIN, '--yes', '--json']);
      expect(push.exit).toBe(7);
      expect(parseEnvelope(push).error.code).toBe('AFF_FIXTURE_INVALID');

      const pull = await runCli(['pull', DOMA_NAME, '--type', 'DOMA', '--overwrite', '--json']);
      expect(pull.exit).toBe(0);
      const main = JSON.parse(readFileSync(join(TMP_PROJECT, DOMA_MAIN), 'utf8'));
      expect(main.description).toBe('description before invalid docu');
    });
  });

  it('roundtrips a DTEL long text through /ddic/dtel/<name>/docu', async () => {
    await withMock(async () => {
      const dtelName = 'ZCLI_MOCK_DTELDOCU';
      const dtelMain = 'src/zcli_mock_dteldocu.dtel.json';
      const dtelDocu = 'src/zcli_mock_dteldocu.dtel.docu.json';
      writeFileSync(
        join(TMP_PROJECT, dtelMain),
        JSON.stringify(
          {
            name: dtelName,
            description: 'mock data element with long text',
            package: '$TMP',
            dataTypeInformation: { category: 'predefinedType', predefinedType: { dataType: 'CHAR', length: 10 } },
          },
          null,
          2,
        ) + '\n',
      );
      const create = await runCli([
        'create', 'DTEL', dtelName, '--file', dtelMain, '--package', '$TMP', '--yes', '--json',
      ]);
      expect(create.exit).toBe(0);

      writeFileSync(
        join(TMP_PROJECT, dtelDocu),
        JSON.stringify({ formatVersion: '1', lines: DOCU_LINES }, null, 2) + '\n',
      );
      const push = await runCli(['push', dtelMain, '--yes', '--json']);
      expect(push.exit).toBe(0);
      expect(parseEnvelope(push).data.results[0]).toMatchObject({ docu: 'saved' });

      const pull = await runCli(['pull', dtelName, '--type', 'DTEL', '--overwrite', '--json']);
      expect(pull.exit).toBe(0);
      const pulled = JSON.parse(readFileSync(join(TMP_PROJECT, dtelDocu), 'utf8'));
      expect(pulled.lines).toEqual(DOCU_LINES);
    });
  });
});
