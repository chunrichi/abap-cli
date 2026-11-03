/**
 * SM59 (HTTP destination) lifecycle contract: create → pull → push → re-pull →
 * delete, plus the error surface that only exists for this type.
 *
 * Drives the real CLI binary against mock-adt's ICF `/sm59/<name>` endpoints.
 * SM59 destinations are `RFCDES` rows (client-independent system table), so the
 * type has no package / transport envelope: create is `--file`-only, push
 * overwrites the whole definition and only updates existing destinations, and
 * delete needs `--yes`. The route only manages `RFCTYPE='G'` (HTTP connection to
 * external server) destinations.
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

const TMP_HOME = mkdtempSync(join(os.tmpdir(), 'abap-sm59-home-'));
mkdirSync(join(TMP_HOME, '.abap-cli'), { recursive: true });
const TMP_PROJECT = mkdtempSync(join(os.tmpdir(), 'abap-sm59-project-'));
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

/**
 * Local `sm59-v1` document (local extension): the SM59 HTTP destination main
 * screen. `RFCTYPE` is implied by the type code and never written locally;
 * `name` lives in the file name / command argument like HTTP / TRAN.
 */
const SM59_DOC = {
  formatVersion: '1',
  description: 'mock HTTP destination',
  targetHost: 'example.com',
  port: 443,
  protocol: 'HTTPS',
  pathPrefix: '/api',
};

function writeDoc(doc: unknown, name = 'zcli_mock_sm59'): string {
  const rel = `src/${name}.sm59.json`;
  mkdirSync(join(TMP_PROJECT, 'src'), { recursive: true });
  writeFileSync(join(TMP_PROJECT, rel), JSON.stringify(doc, null, 2) + '\n');
  return rel;
}

function writeRawFile(content: string, rel: string): string {
  mkdirSync(join(TMP_PROJECT, 'src'), { recursive: true });
  writeFileSync(join(TMP_PROJECT, rel), content);
  return rel;
}

function readPulled(name = 'zcli_mock_sm59'): Record<string, unknown> {
  return JSON.parse(readFileSync(join(TMP_PROJECT, 'src', `${name}.sm59.json`), 'utf8')) as Record<string, unknown>;
}

afterAll(() => {
  rmSync(TMP_HOME, { recursive: true, force: true });
  rmSync(TMP_PROJECT, { recursive: true, force: true });
});

describe.skipIf(!hasBuiltCli)('SM59 /sm59 lifecycle (mock ICF)', () => {
  it('creates, pulls, pushes, re-pulls and deletes an HTTP destination', async () => {
    await withMock(async () => {
      const rel = writeDoc(SM59_DOC);

      const create = await runCli(['create', 'SM59', 'ZCLI_MOCK_SM59', '--file', rel, '--yes', '--json']);
      expect(create.exit, create.stderr || create.stdout).toBe(0);
      expect(parseEnvelope(create).data).toMatchObject({ object: 'ZCLI_MOCK_SM59', type: 'SM59', action: 'created' });

      // Pull back: the local file is a plain sm59-v1 document (no CLI name
      // envelope, no RFCTYPE), so it is reusable as a create / push template.
      const pull = await runCli(['pull', 'ZCLI_MOCK_SM59', '--type', 'SM59', '--overwrite', '--json']);
      expect(pull.exit, pull.stderr || pull.stdout).toBe(0);
      const pulled = readPulled();
      expect(pulled).toMatchObject({
        formatVersion: '1',
        description: 'mock HTTP destination',
        targetHost: 'example.com',
        port: 443,
        protocol: 'HTTPS',
        pathPrefix: '/api',
      });
      expect(pulled).not.toHaveProperty('name');
      expect(pulled).not.toHaveProperty('type');

      // A freshly pulled file validates as AFF (local-extension schema).
      const validate = await runCli(['validate:aff', rel, '--json']);
      expect(validate.exit, validate.stderr || validate.stdout).toBe(0);

      // Edit the destination and push it back; the re-pull must show the change.
      writeDoc({ ...pulled, description: 'updated destination', pathPrefix: '/v2' });
      const push = await runCli(['push', rel, '--yes', '--json']);
      expect(push.exit, push.stderr || push.stdout).toBe(0);

      const rePull = await runCli(['pull', 'ZCLI_MOCK_SM59', '--type', 'SM59', '--overwrite', '--json']);
      expect(rePull.exit, rePull.stderr || rePull.stdout).toBe(0);
      expect(readPulled()).toMatchObject({ description: 'updated destination', pathPrefix: '/v2' });

      const del = await runCli(['delete', 'ZCLI_MOCK_SM59', '--type', 'SM59', '--yes', '--json']);
      expect(del.exit, del.stderr || del.stdout).toBe(0);
      expect(parseEnvelope(del).data).toMatchObject({ object: 'ZCLI_MOCK_SM59', type: 'SM59', deleted: true });

      const gone = await runCli(['pull', 'ZCLI_MOCK_SM59', '--type', 'SM59', '--json']);
      expect(gone.exit).toBe(8);
      expect(parseEnvelope(gone).error).toMatchObject({ category: 'NOT_FOUND' });
    });
  });

  it('rejects bad input and keeps --check-only / --dry-run read-only', async () => {
    await withMock(async () => {
      const rel = writeDoc(SM59_DOC);

      // create --check-only validates locally and must not create the destination.
      const chkRel = writeDoc(SM59_DOC, 'zcli_mock_sm59_chk');
      const checkOnly = await runCli(['create', 'SM59', 'ZCLI_MOCK_SM59_CHK', '--file', chkRel, '--check-only', '--yes', '--json']);
      expect(checkOnly.exit, checkOnly.stderr || checkOnly.stdout).toBe(0);
      const notCreated = await runCli(['pull', 'ZCLI_MOCK_SM59_CHK', '--type', 'SM59', '--json']);
      expect(notCreated.exit).toBe(8);

      // Create a real destination so push has an update target.
      const createReal = await runCli(['create', 'SM59', 'ZCLI_MOCK_SM59', '--file', rel, '--yes', '--json']);
      expect(createReal.exit, createReal.stderr || createReal.stdout).toBe(0);

      // push --dry-run plans only: the SAP-side definition must stay unchanged.
      writeDoc({ ...SM59_DOC, description: 'dry-run must not persist' });
      const pushDry = await runCli(['push', rel, '--dry-run', '--json']);
      expect(pushDry.exit, pushDry.stderr || pushDry.stdout).toBe(0);
      const afterDry = await runCli(['pull', 'ZCLI_MOCK_SM59', '--type', 'SM59', '--overwrite', '--json']);
      expect(afterDry.exit).toBe(0);
      expect(readPulled().description).toBe('mock HTTP destination');

      // Missing --file is a usage error.
      const noFile = await runCli(['create', 'SM59', 'ZCLI_MOCK_SM59_NF', '--yes', '--json']);
      expect(noFile.exit).toBe(2);

      // Malformed JSON is rejected before any SAP call (USAGE: file parse).
      writeRawFile('{ not json', 'src/zcli_mock_sm59_bad.sm59.json');
      const badJson = await runCli(['create', 'SM59', 'ZCLI_MOCK_SM59_BAD', '--file', 'src/zcli_mock_sm59_bad.sm59.json', '--yes', '--json']);
      expect(badJson.exit).toBe(2);

      // A structurally invalid document fails AFF validation (VALIDATION_ERROR).
      const badSchemaRel = writeDoc(
        { formatVersion: '1', targetHost: 'example.com', protocol: 'SMTP' },
        'zcli_mock_sm59_bad_schema',
      );
      const badSchema = await runCli(['create', 'SM59', 'ZCLI_MOCK_SM59_BAD_SCHEMA', '--file', badSchemaRel, '--yes', '--json']);
      expect(badSchema.exit).toBe(7);

      // A file name that does not match the destination is rejected locally.
      const mismatch = await runCli(['create', 'SM59', 'ZCLI_MOCK_SM59_OTHER', '--file', rel, '--yes', '--json']);
      expect(mismatch.exit).toBe(2);

      // RFCDEST is CHAR 32: longer names are rejected before any write.
      const tooLong = `ZCLI_MOCK_SM59_${'X'.repeat(24)}`;
      const longName = await runCli(['create', 'SM59', tooLong, '--file', rel, '--yes', '--json']);
      expect(longName.exit).toBe(7);
      expect(parseEnvelope(longName).error).toMatchObject({ code: 'SM59_NAME_INVALID' });

      // delete without --yes is a usage error.
      const noYes = await runCli(['delete', 'ZCLI_MOCK_SM59', '--type', 'SM59', '--json']);
      expect(noYes.exit).toBe(2);

      // Non-HTTP destinations (RFCTYPE != 'G') are refused, not touched.
      const nonHttp = await runCli(['pull', 'ZCLI_MOCK_SM59_RFC', '--type', 'SM59', '--json']);
      expect(nonHttp.exit).toBe(7);
      expect(parseEnvelope(nonHttp).error).toMatchObject({ code: 'SM59_TYPE_NOT_SUPPORTED' });

      // Pull of a missing destination maps to exit 8 / NOT_FOUND.
      const missing = await runCli(['pull', 'ZCLI_MOCK_SM59_GONE', '--type', 'SM59', '--json']);
      expect(missing.exit).toBe(8);
      expect(parseEnvelope(missing).error).toMatchObject({ category: 'NOT_FOUND' });

      // Delete of a missing destination maps to exit 8 / NOT_FOUND.
      const missingDelete = await runCli(['delete', 'ZCLI_MOCK_SM59_GONE', '--type', 'SM59', '--yes', '--json']);
      expect(missingDelete.exit).toBe(8);

      // push updates existing destinations only: a local file without a SAP
      // counterpart fails with NOT_FOUND and tells the caller to create first.
      const newRel = writeDoc(SM59_DOC, 'zcli_mock_sm59_new');
      const pushMissing = await runCli(['push', newRel, '--yes', '--json']);
      expect(pushMissing.exit).toBe(8);

      // The handler resolves an omitted port by protocol (80 for HTTP) and GET
      // reports it as an integer, so the pulled document carries the default.
      const defaultsRel = writeDoc(
        { formatVersion: '1', description: 'port default', targetHost: 'example.com', protocol: 'HTTP' },
        'zcli_mock_sm59_defaults',
      );
      const defaultsCreate = await runCli(['create', 'SM59', 'ZCLI_MOCK_SM59_DEFAULTS', '--file', defaultsRel, '--yes', '--json']);
      expect(defaultsCreate.exit, defaultsCreate.stderr || defaultsCreate.stdout).toBe(0);
      const defaultsPull = await runCli(['pull', 'ZCLI_MOCK_SM59_DEFAULTS', '--type', 'SM59', '--overwrite', '--json']);
      expect(defaultsPull.exit, defaultsPull.stderr || defaultsPull.stdout).toBe(0);
      expect(readPulled('zcli_mock_sm59_defaults').port).toBe(80);
      const defaultsDelete = await runCli(['delete', 'ZCLI_MOCK_SM59_DEFAULTS', '--type', 'SM59', '--yes', '--json']);
      expect(defaultsDelete.exit, defaultsDelete.stderr || defaultsDelete.stdout).toBe(0);
    });
  });

  it('rejects --package / --tr (no package, no CTS transport for SM59)', async () => {
    await withMock(async () => {
      const rel = writeDoc(SM59_DOC);

      const withPackage = await runCli([
        'create', 'SM59', 'ZCLI_MOCK_SM59', '--file', rel, '--package', '$TMP', '--yes', '--json',
      ]);
      expect(withPackage.exit).toBe(7);
      expect(parseEnvelope(withPackage).error).toMatchObject({ code: 'TYPE_NOT_SUPPORTED' });

      const withTransport = await runCli([
        'create', 'SM59', 'ZCLI_MOCK_SM59', '--file', rel, '--tr', 'TRN001', '--yes', '--json',
      ]);
      expect(withTransport.exit).toBe(7);
      expect(parseEnvelope(withTransport).error).toMatchObject({ code: 'TYPE_NOT_SUPPORTED' });

      // The rejections happened before any write.
      const missing = await runCli(['pull', 'ZCLI_MOCK_SM59', '--type', 'SM59', '--json']);
      expect(missing.exit).toBe(8);
    });
  });

  it('lists SM59 in the local type catalog', async () => {
    const types = await runCli(['types', '--json']);
    expect(types.exit).toBe(0);
    const rows = parseEnvelope(types).data as Array<Record<string, unknown>>;
    const row = rows.find((entry) => entry.cliType === 'SM59');
    expect(row).toBeTruthy();
    expect(row).toMatchObject({ cliType: 'SM59', channel: 'ICF' });
  });
});
