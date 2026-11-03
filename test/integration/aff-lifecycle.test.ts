/**
 * Generic AFF channel lifecycle against mock-adt.
 *
 * Two transports back the six types:
 *   - APLO / CHDO / EVTB / SMBC: ADT blueSource resources whose `source/main`
 *     is the official AFF JSON (create/pull/push/delete through the standard
 *     ADT lock/corrNr lifecycle);
 *   - ENHO / ENHS: read-only ICF `/aff/<TYPE>/<NAME>` endpoint (pull only;
 *     create/push/delete are rejected locally).
 *
 * The suite also pins the transport rules, dry-run/no-write guarantee, 404/409
 * error paths and the `abap types` channel output. It self-skips while
 * `dist/index.js` is missing or was built before the mixed-channel wiring.
 */
import { describe, expect, it, afterAll } from 'vitest';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import * as net from 'node:net';
import { join, resolve } from 'node:path';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';

const ROOT = resolve(__dirname, '../..');
const CLI = resolve(ROOT, 'dist/index.js');
const MOCK = resolve(ROOT, 'test/integration/mock-adt/server.js');

/** Whether the built CLI carries the mixed-channel wiring (stale dist skips). */
function builtCliHasMixedAffChannels(): boolean {
  if (!existsSync(CLI)) return false;
  try {
    const out = execFileSync(process.execPath, [CLI, 'types', 'APLO', '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.includes('"channel":"ADT"');
  } catch {
    return false;
  }
}

const hasMixedAffCli = builtCliHasMixedAffChannels();

const TMP_HOME = mkdtempSync(join(os.tmpdir(), 'abap-aff-home-'));
mkdirSync(join(TMP_HOME, '.abap-cli'), { recursive: true });
const TMP_PROJECT = mkdtempSync(join(os.tmpdir(), 'abap-aff-project-'));
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

async function withMock<T>(fn: (port: number) => Promise<T>): Promise<T> {
  const port = await getFreePort();
  writeSystemsConfig(port);
  const proc = await startMock(port);
  try {
    return await fn(port);
  } finally {
    proc.kill('SIGTERM');
  }
}

function parseEnvelope(result: { stdout: string; stderr: string }): Record<string, any> {
  const text = result.stdout.trim() ? result.stdout : result.stderr;
  return JSON.parse(text.slice(text.indexOf('{')));
}

const HEADER = { description: 'mock AFF object', originalLanguage: 'en' };

/** Minimal schema-valid document per AFF type. */
const DOCS: Record<string, Record<string, unknown>> = {
  APLO: { formatVersion: '1', header: HEADER, subobjects: [] },
  CHDO: {
    formatVersion: '1',
    header: HEADER,
    tablesAndStructures: [],
    errorMessage: { id: 'MOCK', number: '001' },
  },
  EVTB: {
    formatVersion: '1',
    header: HEADER,
    producerNamespace: 'MOCK',
    boName: 'MOCK',
    boOperation: 'mock',
    events: [],
  },
  SMBC: {
    formatVersion: '1',
    header: HEADER,
    serviceConfiguration: {
      serviceBinding: 'MOCK',
      serviceName: 'MOCK',
      serviceVersion: '1',
      rootEntitySet: 'MOCK',
      name: 'MOCK',
    },
  },
  ENHO: { formatVersion: '1', header: HEADER, generalInformation: { enhancementSpot: 'MOCK' } },
  ENHS: { formatVersion: '1', header: HEADER, configuration: { tool: 'badiDefinition' } },
};

function srcPath(name: string): string {
  return join(TMP_PROJECT, 'src', name);
}

function writeDoc(type: string, objectName: string, doc: Record<string, unknown> = DOCS[type]!): string {
  mkdirSync(join(TMP_PROJECT, 'src'), { recursive: true });
  const fileName = `${objectName.toLowerCase()}.${type.toLowerCase()}.json`;
  writeFileSync(srcPath(fileName), JSON.stringify(doc, null, 2) + '\n', 'utf8');
  return `src/${fileName}`;
}

function readDoc(fileName: string): Record<string, any> {
  return JSON.parse(readFileSync(srcPath(fileName), 'utf8'));
}

function pull(type: string, name: string, extra: string[] = []) {
  return runCli(['pull', name, '--type', type, '--json', ...extra]);
}

function create(type: string, name: string, file: string, extra: string[] = []) {
  return runCli(['create', type, name, '--file', file, '--package', '$TMP', '--yes', '--json', ...extra]);
}

/** Seed the mock ICF `/aff` store for the read-only types (pull-only test). */
async function seedIcfAff(port: number, type: string, name: string): Promise<void> {
  const fileName = `${name.toLowerCase()}.${type.toLowerCase()}.json`;
  const res = await fetch(`http://localhost:${port}/sap/abap_cli/aff/${type}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      package: '$TMP',
      files: [{ name: fileName, content: JSON.stringify(DOCS[type]) }],
    }),
  });
  expect(res.status).toBe(200);
}

afterAll(() => {
  rmSync(TMP_HOME, { recursive: true, force: true });
  rmSync(TMP_PROJECT, { recursive: true, force: true });
});

describe.skipIf(!hasMixedAffCli)('AFF channel lifecycle (mock ADT + ICF)', () => {
  it('complete APLO lifecycle: create → pull → push → dry-run → delete', async () => {
    await withMock(async () => {
      const mainRel = writeDoc('APLO', 'ZCLI_MOCK_APLO');

      const createRes = await create('APLO', 'ZCLI_MOCK_APLO', mainRel);
      expect(createRes.exit).toBe(0);
      expect(parseEnvelope(createRes).data).toMatchObject({
        object: 'ZCLI_MOCK_APLO',
        type: 'APLO',
        channel: 'adt',
        action: 'created',
        package: '$TMP',
      });

      const pulled = await pull('APLO', 'ZCLI_MOCK_APLO', ['--overwrite']);
      expect(pulled.exit).toBe(0);
      expect(parseEnvelope(pulled).data.written).toEqual(['src/zcli_mock_aplo.aplo.json']);
      expect(readDoc('zcli_mock_aplo.aplo.json').header.description).toBe('mock AFF object');

      // Edit → push → pull verifies the write and activation round-trip.
      writeFileSync(srcPath('zcli_mock_aplo.aplo.json'), JSON.stringify({
        ...DOCS.APLO!,
        header: { ...HEADER, description: 'edited AFF object' },
      }, null, 2) + '\n', 'utf8');
      const push = await runCli(['push', mainRel, '--yes', '--json']);
      expect(push.exit).toBe(0);
      expect(parseEnvelope(push).data.results[0]).toMatchObject({ status: 'written', channel: 'adt' });
      const repulled = await pull('APLO', 'ZCLI_MOCK_APLO', ['--overwrite']);
      expect(repulled.exit).toBe(0);
      expect(readDoc('zcli_mock_aplo.aplo.json').header.description).toBe('edited AFF object');

      // --dry-run must not write: edit, dry-run, re-pull keeps the old state.
      writeFileSync(srcPath('zcli_mock_aplo.aplo.json'), JSON.stringify({
        ...DOCS.APLO!,
        header: { ...HEADER, description: 'dry-run edit' },
      }, null, 2) + '\n', 'utf8');
      const dryRun = await runCli(['push', mainRel, '--dry-run', '--yes', '--json']);
      expect(dryRun.exit).toBe(0);
      expect(parseEnvelope(dryRun).data.dryRun).toBe(true);
      const afterDryRun = await pull('APLO', 'ZCLI_MOCK_APLO', ['--overwrite']);
      expect(afterDryRun.exit).toBe(0);
      expect(readDoc('zcli_mock_aplo.aplo.json').header.description).toBe('edited AFF object');

      const del = await runCli(['delete', 'ZCLI_MOCK_APLO', '--type', 'APLO', '--yes', '--json']);
      expect(del.exit).toBe(0);
      expect(parseEnvelope(del).data).toMatchObject({ object: 'ZCLI_MOCK_APLO', type: 'APLO', deleted: true });

      const gone = await pull('APLO', 'ZCLI_MOCK_APLO');
      expect(gone.exit).toBe(8);
      expect(parseEnvelope(gone).error).toMatchObject({ code: 'OBJECT_NOT_FOUND' });
    });
  });

  it('round-trips APLO/CHDO/EVTB/SMBC through the ADT blueSource channel', async () => {
    await withMock(async () => {
      for (const type of ['APLO', 'CHDO', 'EVTB', 'SMBC']) {
        const objectName = `ZCLI_MOCK_${type}`;
        const rel = writeDoc(type, objectName);

        const created = await create(type, objectName, rel, ['--no-pull']);
        expect(created.exit, `create ${type}`).toBe(0);
        expect(parseEnvelope(created).data).toMatchObject({ object: objectName, type, channel: 'adt', action: 'created' });

        const pulled = await pull(type, objectName, ['--overwrite']);
        expect(pulled.exit, `pull ${type}`).toBe(0);
        const fileName = `${objectName.toLowerCase()}.${type.toLowerCase()}.json`;
        expect(readDoc(fileName)).toMatchObject({ formatVersion: '1' });

        // Content edit round-trip (mock AFF write accepts the document as-is).
        writeFileSync(srcPath(fileName), JSON.stringify({
          ...DOCS[type]!,
          header: { ...HEADER, description: `${type} edited` },
        }, null, 2) + '\n', 'utf8');
        const pushed = await runCli(['push', `src/${fileName}`, '--yes', '--json']);
        expect(pushed.exit, `push ${type}`).toBe(0);
        const repulled = await pull(type, objectName, ['--overwrite']);
        expect(repulled.exit, `re-pull ${type}`).toBe(0);
        expect(readDoc(fileName).header.description).toBe(`${type} edited`);

        const deleted = await runCli(['delete', objectName, '--type', type, '--yes', '--json']);
        expect(deleted.exit, `delete ${type}`).toBe(0);
      }
    });
  });

  it('pulls ENHO/ENHS read-only and rejects their writes locally', async () => {
    await withMock(async (port) => {
      for (const type of ['ENHO', 'ENHS']) {
        const objectName = `ZCLI_MOCK_${type}`;
        await seedIcfAff(port, type, objectName);

        const pulled = await pull(type, objectName, ['--overwrite']);
        expect(pulled.exit, `pull ${type}`).toBe(0);
        const data = parseEnvelope(pulled).data;
        expect(data).toMatchObject({ object: objectName, type, channel: 'icf' });
        expect(readDoc(`${objectName.toLowerCase()}.${type.toLowerCase()}.json`)).toMatchObject({ formatVersion: '1' });

        const rel = `src/${objectName.toLowerCase()}.${type.toLowerCase()}.json`;
        const created = await create(type, objectName, rel);
        expect(created.exit, `create ${type}`).toBe(7);
        expect(parseEnvelope(created).error).toMatchObject({ code: 'VALIDATION_ERROR' });
        expect(String(parseEnvelope(created).error.message)).toMatch(/read-only/i);

        const pushed = await runCli(['push', rel, '--yes', '--json']);
        expect(pushed.exit, `push ${type}`).toBe(7);
        expect(parseEnvelope(pushed).error).toMatchObject({ code: 'VALIDATION_ERROR' });

        const deleted = await runCli(['delete', objectName, '--type', type, '--yes', '--json']);
        expect(deleted.exit, `delete ${type}`).toBe(7);
        expect(parseEnvelope(deleted).error).toMatchObject({ code: 'VALIDATION_ERROR' });
      }
    });
  });

  it('enforces transport rules and the endpoint error paths', async () => {
    await withMock(async () => {
      const rel = writeDoc('APLO', 'ZCLI_MOCK_TRANSPORT');

      // Transportable create without --tr is rejected locally, nothing written.
      const missingTr = await runCli([
        'create', 'APLO', 'ZCLI_MOCK_TRANSPORT', '--file', rel, '--package', 'ZPKG', '--yes', '--json',
      ]);
      expect(missingTr.exit).toBe(7);
      expect(parseEnvelope(missingTr).error).toMatchObject({ code: 'AFF_TRANSPORT_REQUIRED' });
      expect((await pull('APLO', 'ZCLI_MOCK_TRANSPORT')).exit).toBe(8);

      // With a request it lands and the transport travels through the envelope.
      const created = await runCli([
        'create', 'APLO', 'ZCLI_MOCK_TRANSPORT', '--file', rel, '--package', 'ZPKG', '--tr', 'NDK900123',
        '--no-pull', '--yes', '--json',
      ]);
      expect(created.exit).toBe(0);
      expect(parseEnvelope(created).data).toMatchObject({ package: 'ZPKG', transport: 'NDK900123' });

      const pulled = await pull('APLO', 'ZCLI_MOCK_TRANSPORT', ['--overwrite']);
      expect(pulled.exit).toBe(0);
      expect(parseEnvelope(pulled).data.package).toBe('ZPKG');

      // push/delete of a transportable object need --tr.
      const pushNoTr = await runCli(['push', rel, '--yes', '--json']);
      expect(pushNoTr.exit).toBe(7);
      expect(parseEnvelope(pushNoTr).error).toMatchObject({ code: 'AFF_TRANSPORT_REQUIRED' });

      const delNoTr = await runCli(['delete', 'ZCLI_MOCK_TRANSPORT', '--type', 'APLO', '--yes', '--json']);
      expect(delNoTr.exit).toBe(7);
      expect(parseEnvelope(delNoTr).error).toMatchObject({ code: 'AFF_TRANSPORT_REQUIRED' });

      const delWithTr = await runCli([
        'delete', 'ZCLI_MOCK_TRANSPORT', '--type', 'APLO', '--tr', 'NDK900123', '--yes', '--json',
      ]);
      expect(delWithTr.exit).toBe(0);

      // Duplicate create → AFF_ALREADY_EXISTS (exit 7).
      const localRel = writeDoc('APLO', 'ZCLI_MOCK_DUP');
      expect((await create('APLO', 'ZCLI_MOCK_DUP', localRel)).exit).toBe(0);
      const dup = await create('APLO', 'ZCLI_MOCK_DUP', localRel);
      expect(dup.exit).toBe(7);
      expect(parseEnvelope(dup).error).toMatchObject({ code: 'AFF_ALREADY_EXISTS' });

      // push/delete a missing object → OBJECT_NOT_FOUND (exit 8).
      const ghostRel = writeDoc('APLO', 'ZCLI_MOCK_GHOST');
      const ghostPush = await runCli(['push', ghostRel, '--yes', '--json']);
      expect(ghostPush.exit).toBe(8);
      expect(parseEnvelope(ghostPush).error).toMatchObject({ code: 'OBJECT_NOT_FOUND' });
      const ghostDelete = await runCli(['delete', 'ZCLI_MOCK_GHOST', '--type', 'APLO', '--yes', '--json']);
      expect(ghostDelete.exit).toBe(8);
      expect(parseEnvelope(ghostDelete).error).toMatchObject({ code: 'OBJECT_NOT_FOUND' });

      // Schema-invalid document → VALIDATION_ERROR (exit 7).
      const badRel = writeDoc('APLO', 'ZCLI_MOCK_BAD', { formatVersion: '2' });
      const bad = await create('APLO', 'ZCLI_MOCK_BAD', badRel);
      expect(bad.exit).toBe(7);
      expect(parseEnvelope(bad).error).toMatchObject({ code: 'VALIDATION_ERROR' });

      // CHDO rejects names above 16 characters.
      const chdoRel = writeDoc('CHDO', 'ZCLI_MOCK_CHDO');
      const tooLong = await create('CHDO', 'ZCLI_MOCK_CHDO_T17', chdoRel);
      expect(tooLong.exit).toBe(7);
      expect(parseEnvelope(tooLong).error).toMatchObject({ code: 'VALIDATION_ERROR' });
    });
  });

  it('lists the six AFF types with their real transport channel', async () => {
    const all = await runCli(['types', '--json']);
    expect(all.exit).toBe(0);
    const rows = parseEnvelope(all).data as Array<Record<string, any>>;
    for (const type of ['APLO', 'CHDO', 'EVTB', 'SMBC']) {
      expect(rows.find((entry) => entry.cliType === type), type).toMatchObject({
        cliType: type,
        tadirObject: type,
        channel: 'ADT',
        affSchema: `${type.toLowerCase()}-v1.json`,
      });
    }
    for (const type of ['ENHO', 'ENHS']) {
      expect(rows.find((entry) => entry.cliType === type), type).toMatchObject({
        cliType: type,
        tadirObject: type,
        channel: 'ICF',
        affSchema: `${type.toLowerCase()}-v1.json`,
      });
    }

    const single = await runCli(['types', 'APLO', '--json']);
    expect(single.exit).toBe(0);
    expect(parseEnvelope(single).data).toMatchObject({ cliType: 'APLO', tadirObject: 'APLO', channel: 'ADT' });
  });
});
