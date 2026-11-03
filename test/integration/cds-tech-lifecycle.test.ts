/**
 * CDS technical objects lifecycle: DTDC / DTEB / DSFD / DSFI (ADT-only).
 *
 * Drives the real CLI binary against mock-adt's CDS technical resources. The
 * mock stores the metadata XML verbatim and the `.acds` / DSFI-JSON source
 * separately — the AFF projection and the local file layout stay on the CLI
 * side, same as real ADT.
 *
 * Pins:
 *   - create reads the AFF JSON + `.acds` sidecar, posts the collection, writes
 *     the source and activates (DSFI: single JSON, referenced DSFD preflight)
 *   - pull writes the pair / the single DSFI document
 *   - push validates, syncs the description through the metadata resource and
 *     re-activates; a `.acds` pushed on its own is rejected
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

const TMP_HOME = mkdtempSync(join(os.tmpdir(), 'abap-cdstech-home-'));
mkdirSync(join(TMP_HOME, '.abap-cli'), { recursive: true });
const TMP_PROJECT = mkdtempSync(join(os.tmpdir(), 'abap-cdstech-project-'));
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

const DTDC = 'ZCLI_MOCK_DTDC';
const DTEB = 'ZCLI_MOCK_DTEB';
const DSFD = 'ZCLI_MOCK_FUNC';
const DSFI = 'ZCLI_MOCK_FUNC_ANA';

const DTDC_SOURCE = 'define dynamic cache ZCLI_MOCK_DTDC on spfli\n{\n   sum(fltime)\n}\n\ncreation configurable default off\n';
const DTEB_SOURCE = 'define view entity buffer on ZCLI_MOCK_VIEW\n  layer core\n  type single\n';
const DSFD_SOURCE = 'define scalar function zcli_mock_func\n  with parameters\n    p1 : abap.int1\n  returns abap.int4;\n';

function writeSourcePair(name: string, type: string, description: string, source: string): string {
  const token = name.toLowerCase();
  mkdirSync(join(TMP_PROJECT, 'src'), { recursive: true });
  const rel = `src/${token}.${type.toLowerCase()}.json`;
  writeFileSync(
    join(TMP_PROJECT, rel),
    JSON.stringify({ formatVersion: '1', header: { description, originalLanguage: 'en' } }, null, 2) + '\n',
  );
  writeFileSync(join(TMP_PROJECT, `src/${token}.${type.toLowerCase()}.acds`), source);
  return rel;
}

function writeDsfi(name: string, description: string, scalarFunctionName: string, engine?: string): string {
  const rel = `src/${name.toLowerCase()}.dsfi.json`;
  mkdirSync(join(TMP_PROJECT, 'src'), { recursive: true });
  writeFileSync(
    join(TMP_PROJECT, rel),
    JSON.stringify(
      {
        formatVersion: '1',
        header: { description, originalLanguage: 'en' },
        scalarFunctionName,
        ...(engine ? { engine } : {}),
      },
      null,
      2,
    ) + '\n',
  );
  return rel;
}

afterAll(() => {
  rmSync(TMP_HOME, { recursive: true, force: true });
  rmSync(TMP_PROJECT, { recursive: true, force: true });
});

describe.skipIf(!hasBuiltCli)('CDS technical objects lifecycle (mock ADT)', () => {
  it('creates, pulls, pushes and deletes DTDC / DTEB / DSFD / DSFI', async () => {
    await withMock(async () => {
      const files = {
        DTDC: writeSourcePair(DTDC, 'DTDC', 'mock dynamic cache', DTDC_SOURCE),
        DTEB: writeSourcePair(DTEB, 'DTEB', 'mock entity buffer', DTEB_SOURCE),
        DSFD: writeSourcePair(DSFD, 'DSFD', 'mock scalar function', DSFD_SOURCE),
        DSFI: writeDsfi(DSFI, 'mock scalar function impl', DSFD, 'analyticalEngine'),
      };

      // DSFI references DSFD: create DSFD first.
      for (const [type, name] of [['DTDC', DTDC], ['DTEB', DTEB], ['DSFD', DSFD], ['DSFI', DSFI]] as const) {
        const create = await runCli(['create', type, name, '--file', files[type], '--package', '$TMP', '--yes', '--json']);
        expect(create.exit, create.stderr || create.stdout).toBe(0);
        expect(parseEnvelope(create).data).toMatchObject({ object: name, type, action: 'created', channel: 'adt', activated: true });
      }

      // Pull: source types write the pair, DSFI a single document.
      for (const [type, name] of [['DTDC', DTDC], ['DTEB', DTEB], ['DSFD', DSFD], ['DSFI', DSFI]] as const) {
        const token = name.toLowerCase();
        rmSync(join(TMP_PROJECT, `src/${token}.${type.toLowerCase()}.json`), { force: true });
        rmSync(join(TMP_PROJECT, `src/${token}.${type.toLowerCase()}.acds`), { force: true });
        const pull = await runCli(['pull', name, '--type', type, '--json']);
        expect(pull.exit, pull.stderr || pull.stdout).toBe(0);
        expect(parseEnvelope(pull).data).toMatchObject({ type, channel: 'adt' });
      }
      expect(readFileSync(join(TMP_PROJECT, `src/${DTDC.toLowerCase()}.dtdc.acds`), 'utf8')).toBe(DTDC_SOURCE);
      const pulledDsfi = JSON.parse(readFileSync(join(TMP_PROJECT, `src/${DSFI.toLowerCase()}.dsfi.json`), 'utf8'));
      expect(pulledDsfi).toMatchObject({ scalarFunctionName: DSFD, engine: 'analyticalEngine' });

      // Push modified description + source, then verify via re-pull.
      writeSourcePair(DTDC, 'DTDC', 'mock dynamic cache v2', DTDC_SOURCE.replace('sum(fltime)', 'sum(fltime),\n   count(*)'));
      const push = await runCli(['push', files.DTDC, '--yes', '--json']);
      expect(push.exit, push.stderr || push.stdout).toBe(0);
      expect((parseEnvelope(push).data as { results: Array<Record<string, unknown>> }).results[0]).toMatchObject({
        status: 'activated',
        stage: 'channel-adt',
      });
      const repull = await runCli(['pull', DTDC, '--type', 'DTDC', '--json']);
      expect(repull.exit).toBe(0);
      const repulled = JSON.parse(readFileSync(join(TMP_PROJECT, `src/${DTDC.toLowerCase()}.dtdc.json`), 'utf8'));
      expect(repulled.header.description).toBe('mock dynamic cache v2');
      expect(readFileSync(join(TMP_PROJECT, `src/${DTDC.toLowerCase()}.dtdc.acds`), 'utf8')).toContain('count(*)');

      // Pushing the `.acds` on its own is rejected with a pointer to the JSON.
      const sidecarPush = await runCli(['push', `src/${DTDC.toLowerCase()}.dtdc.acds`, '--yes', '--json']);
      expect(sidecarPush.exit).not.toBe(0);
      expect(parseEnvelope(sidecarPush).error).toMatchObject({ code: 'INVALID_ARGUMENT' });

      // Delete in dependency order (DSFI → DSFD, DTEB/DTDC independent).
      for (const [type, name] of [['DSFI', DSFI], ['DSFD', DSFD], ['DTEB', DTEB], ['DTDC', DTDC]] as const) {
        const del = await runCli(['delete', name, '--type', type, '--yes', '--json']);
        expect(del.exit, del.stderr || del.stdout).toBe(0);
        expect(parseEnvelope(del).data).toMatchObject({ object: name, type, packageName: '$TMP', deleted: true });
        const gone = await runCli(['pull', name, '--type', type, '--json']);
        expect(gone.exit).toBe(8);
        expect(parseEnvelope(gone).error).toMatchObject({ code: 'OBJECT_NOT_FOUND' });
      }
    });
  });

  it('rejects invalid documents and unknown references before writing', async () => {
    await withMock(async () => {
      // Missing .acds sidecar.
      const rel = writeSourcePair(DTDC, 'DTDC', 'mock dynamic cache', DTDC_SOURCE);
      rmSync(join(TMP_PROJECT, `src/${DTDC.toLowerCase()}.dtdc.acds`));
      const missingSidecar = await runCli(['create', 'DTDC', DTDC, '--file', rel, '--package', '$TMP', '--yes', '--json']);
      expect(missingSidecar.exit).toBe(7);
      expect(parseEnvelope(missingSidecar).error).toMatchObject({ code: 'VALIDATION_ERROR' });

      // Filename / object-name mismatch.
      const mismatch = await runCli(['create', 'DTDC', 'ZCLI_MOCK_OTHER', '--file', rel, '--package', '$TMP', '--yes', '--json']);
      expect(mismatch.exit).toBe(7);
      expect(parseEnvelope(mismatch).error).toMatchObject({ code: 'VALIDATION_ERROR' });

      // DSFI without the engine suffix / with a wrong referenced function.
      const badSuffix = writeDsfi('ZCLI_MOCK_FUNC', 'bad suffix', 'ZCLI_MOCK_FUNC');
      const suffix = await runCli(['create', 'DSFI', 'ZCLI_MOCK_FUNC', '--file', badSuffix, '--package', '$TMP', '--yes', '--json']);
      expect(suffix.exit).toBe(7);
      expect(parseEnvelope(suffix).error).toMatchObject({ code: 'VALIDATION_ERROR' });

      // DSFI references a scalar function definition that does not exist.
      const missingRef = writeDsfi('ZCLI_MOCK_MISSING_ANA', 'missing ref', 'ZCLI_MOCK_MISSING');
      const ref = await runCli(['create', 'DSFI', 'ZCLI_MOCK_MISSING_ANA', '--file', missingRef, '--package', '$TMP', '--yes', '--json']);
      expect(ref.exit).toBe(8);
      expect(parseEnvelope(ref).error).toMatchObject({ code: 'OBJECT_NOT_FOUND' });

      // push of an unknown object (with a complete local pair).
      const unknownRel = writeSourcePair('ZCLI_MOCK_UNKNOWN', 'DTDC', 'unknown cache', DTDC_SOURCE);
      const push = await runCli(['push', unknownRel, '--yes', '--json']);
      expect(push.exit).toBe(8);
      expect(parseEnvelope(push).error).toMatchObject({ code: 'OBJECT_NOT_FOUND' });
    });
  });
});
