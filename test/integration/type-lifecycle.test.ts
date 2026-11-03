/**
 * Type pool (TYPE) lifecycle against mock-adt.
 *
 * Pins the AFF pair (`<name>.type.json` + `<name>.type.abap`), the five-
 * character name rule, create → write source → activate, pull, push with
 * description sync, and the delete lifecycle. Real ADT exposes the same
 * resource at /sap/bc/adt/ddic/typegroups.
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

const TMP_HOME = mkdtempSync(join(os.tmpdir(), 'abap-type-home-'));
mkdirSync(join(TMP_HOME, '.abap-cli'), { recursive: true });
const TMP_PROJECT = mkdtempSync(join(os.tmpdir(), 'abap-type-project-'));
writeFileSync(join(TMP_PROJECT, '.abap.json'), JSON.stringify({ system: 'mock', transport: '', package: '$TMP' }, null, 2) + '\n');

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

const NAME = 'ZMYTY';
const SOURCE = 'TYPE-POOL ZMYTY.\n\nTYPES zmyt_char10 TYPE c LENGTH 10.\n';

function writePair(description: string, source: string): { json: string; abap: string } {
  mkdirSync(join(TMP_PROJECT, 'src'), { recursive: true });
  const json = `src/${NAME.toLowerCase()}.type.json`;
  const abap = `src/${NAME.toLowerCase()}.type.abap`;
  writeFileSync(join(TMP_PROJECT, json), JSON.stringify({ formatVersion: '1', header: { description, originalLanguage: 'en' } }, null, 2) + '\n');
  writeFileSync(join(TMP_PROJECT, abap), source);
  return { json, abap };
}

afterAll(() => {
  rmSync(TMP_HOME, { recursive: true, force: true });
  rmSync(TMP_PROJECT, { recursive: true, force: true });
});

describe.skipIf(!hasBuiltCli)('type pool lifecycle (mock ADT)', () => {
  it('creates, pulls, pushes and deletes a type pool', async () => {
    await withMock(async () => {
      const files = writePair('mock type pool', SOURCE);
      const create = await runCli(['create', 'TYPE', NAME, '--file', files.json, '--package', '$TMP', '--yes', '--json']);
      expect(create.exit, create.stderr || create.stdout).toBe(0);
      expect(parseEnvelope(create).data).toMatchObject({ object: NAME, type: 'TYPE', action: 'created', channel: 'adt', activated: true });

      // Pull writes the AFF pair.
      rmSync(join(TMP_PROJECT, files.json), { force: true });
      rmSync(join(TMP_PROJECT, files.abap), { force: true });
      const pull = await runCli(['pull', NAME, '--type', 'TYPE', '--json']);
      expect(pull.exit, pull.stderr || pull.stdout).toBe(0);
      expect(readFileSync(join(TMP_PROJECT, files.abap), 'utf8')).toBe(SOURCE);
      expect(JSON.parse(readFileSync(join(TMP_PROJECT, files.json), 'utf8')).header.description).toBe('mock type pool');

      // Edit description + source, push, re-pull: byte-identical.
      writePair('mock type pool v2', SOURCE.replace('LENGTH 10', 'LENGTH 20'));
      const push = await runCli(['push', files.json, '--yes', '--json']);
      expect(push.exit, push.stderr || push.stdout).toBe(0);
      expect((parseEnvelope(push).data as { results: Array<Record<string, unknown>> }).results[0]).toMatchObject({
        status: 'activated',
        stage: 'channel-adt',
      });
      const repull = await runCli(['pull', NAME, '--type', 'TYPE', '--json']);
      expect(repull.exit).toBe(0);
      expect(readFileSync(join(TMP_PROJECT, files.abap), 'utf8')).toBe(SOURCE.replace('LENGTH 10', 'LENGTH 20'));
      expect(JSON.parse(readFileSync(join(TMP_PROJECT, files.json), 'utf8')).header.description).toBe('mock type pool v2');

      // Deleting the `.type.abap` on its own is rejected.
      const badPush = await runCli(['push', files.abap, '--yes', '--json']);
      expect(badPush.exit).toBe(2);
      expect(parseEnvelope(badPush).error).toMatchObject({ code: 'INVALID_ARGUMENT' });

      const del = await runCli(['delete', NAME, '--type', 'TYPE', '--yes', '--json']);
      expect(del.exit, del.stderr || del.stdout).toBe(0);
      expect(parseEnvelope(del).data).toMatchObject({ object: NAME, type: 'TYPE', packageName: '$TMP', deleted: true });
      const gone = await runCli(['pull', NAME, '--type', 'TYPE', '--json']);
      expect(gone.exit).toBe(8);
      expect(parseEnvelope(gone).error).toMatchObject({ code: 'OBJECT_NOT_FOUND' });
    });
  });

  it('rejects invalid names and incomplete pairs before touching SAP', async () => {
    await withMock(async () => {
      const files = writePair('mock type pool', SOURCE);
      // Six-character type-pool name.
      const longName = await runCli(['create', 'TYPE', 'ZMYTYP', '--file', files.json, '--package', '$TMP', '--yes', '--json']);
      expect(longName.exit).toBe(7);
      expect(parseEnvelope(longName).error).toMatchObject({ code: 'VALIDATION_ERROR' });

      // Filename / object-name mismatch.
      const mismatch = await runCli(['create', 'TYPE', 'ZMYTS', '--file', files.json, '--package', '$TMP', '--yes', '--json']);
      expect(mismatch.exit).toBe(7);
      expect(parseEnvelope(mismatch).error).toMatchObject({ code: 'VALIDATION_ERROR' });

      // Missing companion source.
      rmSync(join(TMP_PROJECT, files.abap));
      const missing = await runCli(['create', 'TYPE', NAME, '--file', files.json, '--package', '$TMP', '--yes', '--json']);
      expect(missing.exit).toBe(7);
      expect(parseEnvelope(missing).error).toMatchObject({ code: 'VALIDATION_ERROR' });

      // Push of an unknown type pool (pair restored).
      writeFileSync(join(TMP_PROJECT, files.abap), SOURCE);
      const push = await runCli(['push', files.json, '--yes', '--json']);
      expect(push.exit).toBe(8);
      expect(parseEnvelope(push).error).toMatchObject({ code: 'OBJECT_NOT_FOUND' });
    });
  });
});
