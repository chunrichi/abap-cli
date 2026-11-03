/**
 * Application jobs lifecycle: SAJC (catalog entry) / SAJT (template), ADT-only.
 *
 * Drives the built CLI against mock-adt's application-job resources. The mock
 * serves a `$schema` document (the release-model capability probe) and stores
 * the `source/main` JSON document verbatim, so the AFF projection and the
 * legacy ↔ nested translation stay on the CLI side — same split as real ADT.
 *
 * Pins:
 *   - create reads the AFF JSON, posts the collection, writes source/main under
 *     a lock and activates
 *   - pull translates the wire model back to the AFF document
 *   - push sends the translated document, syncs the metadata description and
 *     re-activates out of the same lock
 *   - a legacy-model system rejects AFF fields it cannot carry (no silent drop)
 *   - delete maps a missing object to OBJECT_NOT_FOUND
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

const TMP_HOME = mkdtempSync(join(os.tmpdir(), 'abap-appjob-home-'));
mkdirSync(join(TMP_HOME, '.abap-cli'), { recursive: true });
const TMP_PROJECT = mkdtempSync(join(os.tmpdir(), 'abap-appjob-project-'));
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

function startMock(port: number, env: Record<string, string> = {}): Promise<ChildProcess> {
  return new Promise((resolveP, rejectP) => {
    const proc = spawn('node', [MOCK, String(port)], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
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

async function withMock<T>(env: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const port = await getFreePort();
  writeSystemsConfig(port);
  const proc = await startMock(port, env);
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

const CATALOG = 'ZCLI_SAJC_DAILY';
const TEMPLATE = 'ZCLI_SAJT_DAILY';

function writeDocument(name: string, type: 'sajc' | 'sajt', doc: Record<string, unknown>): string {
  mkdirSync(join(TMP_PROJECT, 'src'), { recursive: true });
  const rel = `src/${name.toLowerCase()}.${type}.json`;
  writeFileSync(join(TMP_PROJECT, rel), JSON.stringify(doc, null, 2) + '\n');
  return rel;
}

function catalogDoc(description: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    formatVersion: '1',
    header: { description, originalLanguage: 'en' },
    generalInformation: { className: 'ZCL_MY_JOB' },
    exitClasses: { check: 'ZCL_MY_CHECK' },
    ...extra,
  };
}

function templateDoc(description: string): Record<string, unknown> {
  return {
    formatVersion: '1',
    header: { description, originalLanguage: 'en' },
    generalInformation: { catalogName: CATALOG },
    parameters: {
      valueRangesParameters: [
        { name: 'P_DATE', valueRanges: [{ sign: 'include', option: 'equals', low: '2026-11-03' }] },
      ],
    },
  };
}

afterAll(() => {
  rmSync(TMP_HOME, { recursive: true, force: true });
  rmSync(TMP_PROJECT, { recursive: true, force: true });
});

describe.skipIf(!hasBuiltCli)('application jobs lifecycle (mock ADT, legacy wire model)', () => {
  it('creates, pulls, pushes and deletes SAJC / SAJT', async () => {
    await withMock({ MOCK_APPJOB_MODEL: 'legacy' }, async () => {
      const catalogFile = writeDocument(CATALOG, 'sajc', catalogDoc('daily reminder catalog'));
      const templateFile = writeDocument(TEMPLATE, 'sajt', templateDoc('daily reminder template'));

      const createCatalog = await runCli([
        'create', 'SAJC', CATALOG, '--file', catalogFile, '--package', '$TMP', '--yes', '--json',
      ]);
      expect(createCatalog.exit, createCatalog.stderr || createCatalog.stdout).toBe(0);
      expect(parseEnvelope(createCatalog).data).toMatchObject({
        object: CATALOG, type: 'SAJC', action: 'created', channel: 'adt', activated: true,
      });

      const createTemplate = await runCli([
        'create', 'SAJT', TEMPLATE, '--file', templateFile, '--package', '$TMP', '--yes', '--json',
      ]);
      expect(createTemplate.exit, createTemplate.stderr || createTemplate.stdout).toBe(0);
      expect(parseEnvelope(createTemplate).data).toMatchObject({ object: TEMPLATE, type: 'SAJT' });

      // Pull: the legacy wire model is translated back to the AFF document.
      for (const [type, name] of [['SAJC', CATALOG], ['SAJT', TEMPLATE]] as const) {
        rmSync(join(TMP_PROJECT, `src/${name.toLowerCase()}.${type.toLowerCase()}.json`), { force: true });
        const pull = await runCli(['pull', name, '--type', type, '--json']);
        expect(pull.exit, pull.stderr || pull.stdout).toBe(0);
        expect(parseEnvelope(pull).data).toMatchObject({ type, channel: 'adt' });
      }
      const pulledCatalog = JSON.parse(readFileSync(join(TMP_PROJECT, `src/${CATALOG.toLowerCase()}.sajc.json`), 'utf8'));
      expect(pulledCatalog).toEqual(catalogDoc('daily reminder catalog'));
      const pulledTemplate = JSON.parse(readFileSync(join(TMP_PROJECT, `src/${TEMPLATE.toLowerCase()}.sajt.json`), 'utf8'));
      expect(pulledTemplate).toEqual(templateDoc('daily reminder template'));

      // Push: description + document update, then verify via re-pull.
      writeDocument(CATALOG, 'sajc', catalogDoc('daily reminder catalog v2'));
      const push = await runCli(['push', `src/${CATALOG.toLowerCase()}.sajc.json`, '--yes', '--json']);
      expect(push.exit, push.stderr || push.stdout).toBe(0);
      expect((parseEnvelope(push).data as { results: Array<Record<string, unknown>> }).results[0]).toMatchObject({
        status: 'activated',
        stage: 'channel-adt',
      });
      const repull = await runCli(['pull', CATALOG, '--type', 'SAJC', '--json']);
      expect(repull.exit).toBe(0);
      const repulled = JSON.parse(readFileSync(join(TMP_PROJECT, `src/${CATALOG.toLowerCase()}.sajc.json`), 'utf8'));
      expect(repulled.header.description).toBe('daily reminder catalog v2');

      // Delete in dependency order (template → catalog) and verify absence.
      for (const [type, name] of [['SAJT', TEMPLATE], ['SAJC', CATALOG]] as const) {
        const del = await runCli(['delete', name, '--type', type, '--yes', '--json']);
        expect(del.exit, del.stderr || del.stdout).toBe(0);
        expect(parseEnvelope(del).data).toMatchObject({ object: name, type, packageName: '$TMP', deleted: true });
        const gone = await runCli(['pull', name, '--type', type, '--json']);
        expect(gone.exit).toBe(8);
        expect(parseEnvelope(gone).error).toMatchObject({ code: 'OBJECT_NOT_FOUND' });
      }
    });
  });

  it('--check-only validates locally without writing SAP', async () => {
    await withMock({ MOCK_APPJOB_MODEL: 'legacy' }, async () => {
      const rel = writeDocument('ZCLI_SAJC_CHECK', 'sajc', catalogDoc('check only'));
      const check = await runCli([
        'create', 'SAJC', 'ZCLI_SAJC_CHECK', '--file', rel, '--package', '$TMP', '--check-only', '--yes', '--json',
      ]);
      expect(check.exit, check.stderr || check.stdout).toBe(0);
      expect(parseEnvelope(check).data).toMatchObject({ object: 'ZCLI_SAJC_CHECK', checkOnly: true });
      const gone = await runCli(['pull', 'ZCLI_SAJC_CHECK', '--type', 'SAJC', '--json']);
      expect(gone.exit).toBe(8);
    });
  });

  it('rejects object names above the 40-character application-job limit', async () => {
    await withMock({ MOCK_APPJOB_MODEL: 'legacy' }, async () => {
      const name = `ZCLI_SAJC_${'X'.repeat(32)}`;
      const rel = writeDocument(name, 'sajc', catalogDoc('too long'));
      const create = await runCli(['create', 'SAJC', name, '--file', rel, '--package', '$TMP', '--yes', '--json']);
      expect(create.exit).toBe(7);
      expect(parseEnvelope(create).error).toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(JSON.stringify(parseEnvelope(create).error)).toContain('40');
    });
  });

  it('rejects --no-activate (the JSON write activates in one step)', async () => {
    await withMock({ MOCK_APPJOB_MODEL: 'legacy' }, async () => {
      const rel = writeDocument('ZCLI_SAJC_NOACT', 'sajc', catalogDoc('no activate'));
      const create = await runCli([
        'create', 'SAJC', 'ZCLI_SAJC_NOACT', '--file', rel, '--package', '$TMP', '--no-activate', '--yes', '--json',
      ]);
      expect(create.exit).toBe(7);
      expect(parseEnvelope(create).error).toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(JSON.stringify(parseEnvelope(create).error)).toContain('--no-activate');
    });
  });

  it('rejects AFF fields the legacy wire model cannot carry', async () => {
    await withMock({ MOCK_APPJOB_MODEL: 'legacy' }, async () => {
      const rel = writeDocument(
        'ZCLI_SAJC_RICH',
        'sajc',
        catalogDoc('rich catalog', { sections: [{ name: '1', title: 'General' }] }),
      );
      const create = await runCli(['create', 'SAJC', 'ZCLI_SAJC_RICH', '--file', rel, '--package', '$TMP', '--yes', '--json']);
      expect(create.exit).toBe(7);
      const envelope = parseEnvelope(create);
      expect(envelope.error).toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(JSON.stringify(envelope.error)).toContain('sections');
    });
  });

  it('rejects invalid documents and unknown references before writing', async () => {
    await withMock({ MOCK_APPJOB_MODEL: 'legacy' }, async () => {
      // Unknown AFF field.
      const invalidRel = writeDocument('ZCLI_SAJC_BAD', 'sajc', catalogDoc('bad', { unexpected: true }));
      const invalid = await runCli(['create', 'SAJC', 'ZCLI_SAJC_BAD', '--file', invalidRel, '--package', '$TMP', '--yes', '--json']);
      expect(invalid.exit).toBe(7);
      expect(parseEnvelope(invalid).error).toMatchObject({ code: 'VALIDATION_ERROR' });

      // Filename / object-name mismatch.
      const mismatch = await runCli(['create', 'SAJC', 'ZCLI_SAJC_OTHER', '--file', invalidRel, '--package', '$TMP', '--yes', '--json']);
      expect(mismatch.exit).toBe(7);
      expect(parseEnvelope(mismatch).error).toMatchObject({ code: 'VALIDATION_ERROR' });

      // push of an unknown object must not create it.
      const unknownRel = writeDocument('ZCLI_SAJC_MISSING', 'sajc', catalogDoc('missing'));
      const push = await runCli(['push', unknownRel, '--yes', '--json']);
      expect(push.exit).toBe(8);
      expect(parseEnvelope(push).error).toMatchObject({ code: 'OBJECT_NOT_FOUND' });
    });
  });
});

describe.skipIf(!hasBuiltCli)('application jobs lifecycle (mock ADT, nested wire model)', () => {
  it('passes the AFF document through unchanged on a nested-model system', async () => {
    await withMock({ MOCK_APPJOB_MODEL: 'nested' }, async () => {
      const doc = catalogDoc('nested model catalog', {
        exitClasses: { check: 'ZCL_MY_CHECK', notification: 'ZCL_MY_NOTIFY' },
        sections: [{ name: '1', title: 'General' }],
      });
      const rel = writeDocument(CATALOG, 'sajc', doc);
      const create = await runCli(['create', 'SAJC', CATALOG, '--file', rel, '--package', '$TMP', '--yes', '--json']);
      expect(create.exit, create.stderr || create.stdout).toBe(0);

      rmSync(join(TMP_PROJECT, `src/${CATALOG.toLowerCase()}.sajc.json`), { force: true });
      const pull = await runCli(['pull', CATALOG, '--type', 'SAJC', '--json']);
      expect(pull.exit, pull.stderr || pull.stdout).toBe(0);
      const pulled = JSON.parse(readFileSync(join(TMP_PROJECT, `src/${CATALOG.toLowerCase()}.sajc.json`), 'utf8'));
      expect(pulled).toEqual(doc);

      const del = await runCli(['delete', CATALOG, '--type', 'SAJC', '--yes', '--json']);
      expect(del.exit, del.stderr || del.stdout).toBe(0);
    });
  });
});
