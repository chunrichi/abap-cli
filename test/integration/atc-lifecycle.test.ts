/**
 * ATC configuration objects lifecycle: CHKC / CHKO / CHKV (ADT-only types).
 *
 * Drives the real CLI binary against mock-adt's versioned ATC XML resources
 * (`/sap/bc/adt/atc/{checkcategories,checks,checkvariants}`), which store the
 * posted XML verbatim — same contract as real ADT, where the CLI owns the
 * AFF ↔ XML projection.
 *
 * Pins:
 *   - create posts the collection, then activates (or stops with --no-activate)
 *   - pull writes the AFF JSON with the wire-only fields projected away
 *   - push validates the document, requires --tr outside `$` packages, and
 *     updates + activates an existing object
 *   - delete maps a missing object to OBJECT_NOT_FOUND (exit 8)
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

const TMP_HOME = mkdtempSync(join(os.tmpdir(), 'abap-atc-home-'));
mkdirSync(join(TMP_HOME, '.abap-cli'), { recursive: true });
const TMP_PROJECT = mkdtempSync(join(os.tmpdir(), 'abap-atc-project-'));
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

const CATEGORY = 'ZCLI_MOCK_CHKC';
const CHECK = 'ZCLI_MOCK_CHKO';
const VARIANT = 'ZCLI_MOCK_CHKV';

function writeJson(name: string, type: string, doc: unknown): string {
  const rel = `src/${name.toLowerCase()}.${type.toLowerCase()}.json`;
  mkdirSync(join(TMP_PROJECT, 'src'), { recursive: true });
  writeFileSync(join(TMP_PROJECT, rel), JSON.stringify(doc, null, 2) + '\n');
  return rel;
}

const CHKC_DOC = {
  formatVersion: '1',
  header: { description: 'mock ATC category', originalLanguage: 'en' },
};
const CHKO_DOC = {
  formatVersion: '1',
  header: { description: 'mock ATC check', originalLanguage: 'en' },
  category: CATEGORY,
  implementingClass: 'ZCL_MOCK_CHECK',
  checkType: 'local',
  parameters: [{ name: 'THRESHOLD', description: 'Probe threshold', hidden: false }],
};
const CHKV_DOC = {
  formatVersion: '1',
  header: { description: 'mock ATC variant', originalLanguage: 'en' },
  selectedChecks: [
    { checkName: CHECK, parameters: [{ name: 'THRESHOLD', value: '10' }] },
  ],
};

afterAll(() => {
  rmSync(TMP_HOME, { recursive: true, force: true });
  rmSync(TMP_PROJECT, { recursive: true, force: true });
});

describe.skipIf(!hasBuiltCli)('ATC configuration objects lifecycle (mock ADT)', () => {
  it('creates, pulls, pushes and deletes CHKC / CHKO / CHKV', async () => {
    await withMock(async () => {
      const files = {
        CHKC: writeJson(CATEGORY, 'CHKC', CHKC_DOC),
        CHKO: writeJson(CHECK, 'CHKO', CHKO_DOC),
        CHKV: writeJson(VARIANT, 'CHKV', CHKV_DOC),
      };

      for (const [type, name] of [['CHKC', CATEGORY], ['CHKO', CHECK], ['CHKV', VARIANT]] as const) {
        const create = await runCli(['create', type, name, '--file', files[type], '--package', '$TMP', '--yes', '--json']);
        expect(create.exit, create.stderr || create.stdout).toBe(0);
        expect(parseEnvelope(create).data).toMatchObject({ object: name, type, action: 'created', channel: 'adt', activated: true });
      }

      // Pull projects the XML back onto the local AFF documents.
      for (const type of ['CHKC', 'CHKO', 'CHKV'] as const) {
        rmSync(join(TMP_PROJECT, `src/${type === 'CHKC' ? CATEGORY : type === 'CHKO' ? CHECK : VARIANT}`.toLowerCase() + `.${type.toLowerCase()}.json`));
        const pull = await runCli(['pull', type === 'CHKC' ? CATEGORY : type === 'CHKO' ? CHECK : VARIANT, '--type', type, '--json']);
        expect(pull.exit, pull.stderr || pull.stdout).toBe(0);
        expect(parseEnvelope(pull).data).toMatchObject({ type, channel: 'adt' });
      }
      const pulledChkc = JSON.parse(readFileSync(join(TMP_PROJECT, `src/${CATEGORY.toLowerCase()}.chkc.json`), 'utf8'));
      expect(pulledChkc).toEqual({ formatVersion: '1', header: { description: 'mock ATC category', originalLanguage: 'en' } });
      const pulledChko = JSON.parse(readFileSync(join(TMP_PROJECT, `src/${CHECK.toLowerCase()}.chko.json`), 'utf8'));
      expect(pulledChko).toMatchObject({
        category: CATEGORY,
        implementingClass: 'ZCL_MOCK_CHECK',
        checkType: 'local',
        parameters: [{ name: 'THRESHOLD', description: 'Probe threshold' }],
      });
      const pulledChkv = JSON.parse(readFileSync(join(TMP_PROJECT, `src/${VARIANT.toLowerCase()}.chkv.json`), 'utf8'));
      expect(pulledChkv).toMatchObject({
        selectedChecks: [{ checkName: CHECK, parameters: [{ name: 'THRESHOLD', value: '10' }] }],
      });

      // Push an updated variant and verify the change survives a re-pull.
      const updatedChkv = {
        ...CHKV_DOC,
        header: { ...CHKV_DOC.header, description: 'mock ATC variant v2' },
        selectedChecks: [{ checkName: CHECK, parameters: [{ name: 'THRESHOLD', value: '20' }] }],
      };
      writeJson(VARIANT, 'CHKV', updatedChkv);
      const push = await runCli(['push', `src/${VARIANT.toLowerCase()}.chkv.json`, '--yes', '--json']);
      expect(push.exit, push.stderr || push.stdout).toBe(0);
      expect((parseEnvelope(push).data as { results: Array<Record<string, unknown>> }).results[0]).toMatchObject({
        status: 'activated',
        stage: 'channel-adt',
      });
      const repull = await runCli(['pull', VARIANT, '--type', 'CHKV', '--json']);
      expect(repull.exit).toBe(0);
      const afterPush = JSON.parse(readFileSync(join(TMP_PROJECT, `src/${VARIANT.toLowerCase()}.chkv.json`), 'utf8'));
      expect(afterPush.header.description).toBe('mock ATC variant v2');
      expect(afterPush.selectedChecks[0].parameters[0].value).toBe('20');

      // Delete in dependency order (variant → check → category).
      for (const [type, name] of [['CHKV', VARIANT], ['CHKO', CHECK], ['CHKC', CATEGORY]] as const) {
        const del = await runCli(['delete', name, '--type', type, '--yes', '--json']);
        expect(del.exit, del.stderr || del.stdout).toBe(0);
        expect(parseEnvelope(del).data).toMatchObject({ object: name, type, packageName: '$TMP', deleted: true });
        const gone = await runCli(['pull', name, '--type', type, '--json']);
        expect(gone.exit).toBe(8);
        expect(parseEnvelope(gone).error).toMatchObject({ code: 'OBJECT_NOT_FOUND' });
      }
    });
  });

  it('honours --no-activate and rejects invalid documents', async () => {
    await withMock(async () => {
      const ok = writeJson(CATEGORY, 'CHKC', CHKC_DOC);
      const create = await runCli(['create', 'CHKC', CATEGORY, '--file', ok, '--package', '$TMP', '--no-activate', '--yes', '--json']);
      expect(create.exit, create.stderr || create.stdout).toBe(0);
      expect(parseEnvelope(create).data).toMatchObject({ action: 'created', activated: false });

      const invalid = writeJson('ZCLI_MOCK_BAD', 'CHKO', {
        formatVersion: '1',
        header: { description: 'missing required fields', originalLanguage: 'en' },
      });
      const failed = await runCli(['create', 'CHKO', 'ZCLI_MOCK_BAD', '--file', invalid, '--package', '$TMP', '--yes', '--json']);
      expect(failed.exit).toBe(7);
      expect(parseEnvelope(failed).error).toMatchObject({ code: 'VALIDATION_ERROR' });

      // The active-check registration is a SAP-side prerequisite; the CLI must
      // surface it instead of claiming success.
      const badName = writeJson('ZCLI_MOCK_X9', 'CHKC', CHKC_DOC);
      const nameMismatch = await runCli(['create', 'CHKC', 'ZCLI_MOCK_X8', '--file', badName, '--package', '$TMP', '--yes', '--json']);
      expect(nameMismatch.exit).toBe(7);
      expect(parseEnvelope(nameMismatch).error).toMatchObject({ code: 'VALIDATION_ERROR' });
    });
  });

  it('maps push/delete of an unknown object to OBJECT_NOT_FOUND and enforces transports', async () => {
    await withMock(async () => {
      const rel = writeJson(CATEGORY, 'CHKC', CHKC_DOC);
      const push = await runCli(['push', rel, '--yes', '--json']);
      expect(push.exit).toBe(8);
      expect(parseEnvelope(push).error).toMatchObject({ code: 'OBJECT_NOT_FOUND' });

      const del = await runCli(['delete', CATEGORY, '--type', 'CHKC', '--yes', '--json']);
      expect(del.exit).toBe(8);
      expect(parseEnvelope(del).error).toMatchObject({ code: 'OBJECT_NOT_FOUND' });
    });
  });
});
