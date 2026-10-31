/**
 * XSLT lifecycle contract: create → pull → push (modify) → pull → delete.
 *
 * Drives the real CLI binary against mock-adt's ICF `/xslt/<name>` endpoint,
 * which mirrors the ABAP handler envelope (200 + structured error codes) and
 * the CL_O2_API_XSLTDESC read-back behaviour (CRLF-joined source with one
 * extra trailing line break). The suite pins the CLI-side contract:
 *   - create needs the AFF pair (`.xslt.json` + `.xslt.xml`) and --package
 *   - pull writes both files, normalising line endings
 *   - push validates the metadata JSON first and updates an existing object
 *   - the pair is de-duplicated when both files are pushed explicitly
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

const TMP_HOME = mkdtempSync(join(os.tmpdir(), 'abap-xslt-home-'));
mkdirSync(join(TMP_HOME, '.abap-cli'), { recursive: true });
const TMP_PROJECT = mkdtempSync(join(os.tmpdir(), 'abap-xslt-project-'));
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

const XSLT_SOURCE = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<xsl:transform version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">',
  '  <xsl:template match="/">',
  '    <probe><xsl:value-of select="/root/value"/></probe>',
  '  </xsl:template>',
  '</xsl:transform>',
].join('\n');

const XSLT_JSON = {
  formatVersion: '1',
  header: { description: 'mock transformation', originalLanguage: 'EN' },
};

/** Write the AFF pair under src/ and return the JSON file's project-relative path. */
function writePair(name: string, opts: { description?: string; source?: string; omitXml?: boolean } = {}): string {
  const token = name.toLowerCase();
  const rel = `src/${token}.xslt.json`;
  mkdirSync(join(TMP_PROJECT, 'src'), { recursive: true });
  const doc = { ...XSLT_JSON, header: { ...XSLT_JSON.header, description: opts.description ?? XSLT_JSON.header.description } };
  writeFileSync(join(TMP_PROJECT, rel), JSON.stringify(doc, null, 2) + '\n');
  if (!opts.omitXml) {
    writeFileSync(join(TMP_PROJECT, `src/${token}.xslt.xml`), `${(opts.source ?? XSLT_SOURCE).replace(/\n+$/, '')}\n`);
  }
  return rel;
}

afterAll(() => {
  rmSync(TMP_HOME, { recursive: true, force: true });
  rmSync(TMP_PROJECT, { recursive: true, force: true });
});

describe.skipIf(!hasBuiltCli)('XSLT /xslt lifecycle (mock ICF)', () => {
  it('creates, pulls, pushes and deletes the AFF pair', async () => {
    await withMock(async () => {
      const rel = writePair('ZCLI_MOCK_X1');

      const create = await runCli(['create', 'XSLT', 'ZCLI_MOCK_X1', '--file', rel, '--package', '$TMP', '--yes', '--json']);
      expect(create.exit, create.stderr || create.stdout).toBe(0);
      expect(parseEnvelope(create).data).toMatchObject({ object: 'ZCLI_MOCK_X1', type: 'XSLT', action: 'created' });

      // Pull writes both files. The mock returns CRLF + one trailing break, so
      // this asserts the normalisation contract: LF + exactly one final newline.
      rmSync(join(TMP_PROJECT, 'src/zcli_mock_x1.xslt.json'));
      rmSync(join(TMP_PROJECT, 'src/zcli_mock_x1.xslt.xml'));
      const pull = await runCli(['pull', 'ZCLI_MOCK_X1', '--type', 'XSLT', '--json']);
      expect(pull.exit, pull.stderr || pull.stdout).toBe(0);
      const pulledJson = JSON.parse(readFileSync(join(TMP_PROJECT, 'src/zcli_mock_x1.xslt.json'), 'utf8'));
      expect(pulledJson).toEqual({ formatVersion: '1', header: { description: 'mock transformation', originalLanguage: 'EN' } });
      const pulledXml = readFileSync(join(TMP_PROJECT, 'src/zcli_mock_x1.xslt.xml'), 'utf8');
      expect(pulledXml).toBe(`${XSLT_SOURCE}\n`);
      expect(pulledXml.includes('\r')).toBe(false);

      // Push a modified source + description.
      const modifiedSource = XSLT_SOURCE.replace('<probe>', '<probe xmlns:extra="urn:extra">');
      writePair('ZCLI_MOCK_X1', { description: 'mock transformation v2', source: modifiedSource });
      const push = await runCli(['push', 'src/zcli_mock_x1.xslt.json', '--yes', '--json']);
      expect(push.exit, push.stderr || push.stdout).toBe(0);

      const afterPush = await runCli(['pull', 'ZCLI_MOCK_X1', '--type', 'XSLT', '--overwrite', '--json']);
      expect(afterPush.exit).toBe(0);
      expect(readFileSync(join(TMP_PROJECT, 'src/zcli_mock_x1.xslt.xml'), 'utf8')).toBe(`${modifiedSource}\n`);
      const repulledJson = JSON.parse(readFileSync(join(TMP_PROJECT, 'src/zcli_mock_x1.xslt.json'), 'utf8'));
      expect(repulledJson.header.description).toBe('mock transformation v2');

      // Pushing both sides of the pair writes the object once.
      const dedup = await runCli(['push', 'src/zcli_mock_x1.xslt.json', 'src/zcli_mock_x1.xslt.xml', '--yes', '--json']);
      expect(dedup.exit, dedup.stderr || dedup.stdout).toBe(0);
      expect((parseEnvelope(dedup).data as { results: unknown[] }).results).toHaveLength(1);

      const del = await runCli(['delete', 'ZCLI_MOCK_X1', '--type', 'XSLT', '--yes', '--json']);
      expect(del.exit, del.stderr || del.stdout).toBe(0);
      expect(parseEnvelope(del).data).toMatchObject({ object: 'ZCLI_MOCK_X1', type: 'XSLT', deleted: true });

      const gone = await runCli(['pull', 'ZCLI_MOCK_X1', '--type', 'XSLT', '--json']);
      expect(gone.exit).toBe(8);
      expect(parseEnvelope(gone).error).toMatchObject({ code: 'OBJECT_NOT_FOUND' });
    });
  });

  it('rejects a create without the XML companion and a non-$TMP create without a transport', async () => {
    await withMock(async () => {
      const noXml = writePair('ZCLI_MOCK_X2', { omitXml: true });
      const failed = await runCli(['create', 'XSLT', 'ZCLI_MOCK_X2', '--file', noXml, '--package', '$TMP', '--yes', '--json']);
      expect(failed.exit).toBe(7);
      expect(parseEnvelope(failed).error).toMatchObject({ code: 'VALIDATION_ERROR' });

      const withXml = writePair('ZCLI_MOCK_X3');
      const missingTr = await runCli(['create', 'XSLT', 'ZCLI_MOCK_X3', '--file', withXml, '--package', 'ZPKG', '--yes', '--json']);
      expect(missingTr.exit).toBe(7);
      expect(parseEnvelope(missingTr).error).toMatchObject({ code: 'VALIDATION_ERROR' });

      // AFF ties the object name to the file name.
      const wrongName = writePair('ZCLI_MOCK_WRONG');
      const mismatch = await runCli(['create', 'XSLT', 'ZCLI_MOCK_X6', '--file', wrongName, '--package', '$TMP', '--yes', '--json']);
      expect(mismatch.exit).toBe(2);
      expect(parseEnvelope(mismatch).error).toMatchObject({ code: 'INVALID_ARGUMENT' });
    });
  });

  it('push/delete of an unknown transformation map to OBJECT_NOT_FOUND', async () => {
    await withMock(async () => {
      const rel = writePair('ZCLI_MOCK_X4');
      const push = await runCli(['push', rel, '--yes', '--json']);
      expect(push.exit).toBe(8);
      expect(parseEnvelope(push).error).toMatchObject({ code: 'OBJECT_NOT_FOUND' });

      const del = await runCli(['delete', 'ZCLI_MOCK_X4', '--type', 'XSLT', '--yes', '--json']);
      expect(del.exit).toBe(8);
      expect(parseEnvelope(del).error).toMatchObject({ code: 'OBJECT_NOT_FOUND' });
    });
  });

  it('create --check-only validates the pair without calling SAP', async () => {
    await withMock(async () => {
      const rel = writePair('ZCLI_MOCK_X5');
      const check = await runCli(['create', 'XSLT', 'ZCLI_MOCK_X5', '--file', rel, '--package', '$TMP', '--check-only', '--yes', '--json']);
      expect(check.exit, check.stderr || check.stdout).toBe(0);
      expect(parseEnvelope(check).data).toMatchObject({ object: 'ZCLI_MOCK_X5', type: 'XSLT', checkOnly: true, valid: true });

      const pull = await runCli(['pull', 'ZCLI_MOCK_X5', '--type', 'XSLT', '--json']);
      expect(pull.exit).toBe(8);
    });
  });
});
