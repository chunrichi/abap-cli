/**
 * Authorization-object family lifecycle: AUTH / SUSC / SUCU / SUSH / SUSO.
 *
 * The five types have no ADT resource; they are served by the hand-written ICF
 * routes `/sap/abap_cli/auth/<sub>/<name>` (the same service as the DDIC
 * writes). This suite drives the built CLI against mock-adt's family routes:
 *
 *   - create posts the local JSON document and answers action=created
 *     (`$`-prefixed packages are transport-free)
 *   - pull writes the canonical AFF file name (`<token>.<sub>.json`) and strips
 *     the read-side `name` / `package` wire metadata
 *   - push updates an existing object only (GET probe → PUT) and a dry run
 *     writes nothing
 *   - delete removes the object; a follow-up pull maps to OBJECT_NOT_FOUND
 *   - the `--regenerate-profiles` opt-in is SUSO-only and the write answers
 *     `profilesRegenerated` only when the request asked for it (default: off)
 *   - the read-side standard-object fixtures (VKORG / CV / CMMFDOR~S_TABU_DIS /
 *     OCS_GET_INSTALLED_COMPS / /AIF/CDLOG) exercise pull and the where-used
 *     delete refusal
 *
 * Error mapping: server-side family errors surface their `<TYPE>_*` code,
 * except `<TYPE>_NOT_FOUND` which the flows re-map to OBJECT_NOT_FOUND (exit 8)
 * so a pull/push/delete of a missing object keeps the generic not-found exit.
 */
import { describe, expect, it, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import * as net from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';

const ROOT = resolve(__dirname, '../..');
const CLI = resolve(ROOT, 'dist/index.js');
const hasBuiltCli = existsSync(CLI);
const MOCK = resolve(ROOT, 'test/integration/mock-adt/server.js');

const TMP_HOME = mkdtempSync(join(os.tmpdir(), 'abap-auth-family-home-'));
mkdirSync(join(TMP_HOME, '.abap-cli'), { recursive: true });
const TMP_PROJECT = mkdtempSync(join(os.tmpdir(), 'abap-auth-family-project-'));
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

function errorOf(result: { stdout: string; stderr: string }): Record<string, unknown> {
  return (parseEnvelope(result).error ?? {}) as Record<string, unknown>;
}

/** Assert one CLI failure: exit code + error code + optional message fragment. */
function expectFailure(
  result: { stdout: string; stderr: string; exit: number },
  exit: number,
  code: string,
  message?: string,
): void {
  expect(result.exit, result.stderr || result.stdout).toBe(exit);
  const error = errorOf(result);
  expect(error.code).toBe(code);
  if (message) expect(String(error.message ?? '')).toContain(message);
}

/** Write one local family document under the project directory. */
function writeSrc(relPath: string, document: Record<string, unknown>): string {
  const target = join(TMP_PROJECT, relPath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(document, null, 2) + '\n');
  return relPath;
}

/** Remove one local file (a stale pull target or the create input). */
function rmSrc(relPath: string): void {
  rmSync(join(TMP_PROJECT, relPath), { force: true });
}

/** Read back one local family document. */
function readSrc(relPath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(TMP_PROJECT, relPath), 'utf8')) as Record<string, unknown>;
}

/** Pull one family object into its canonical file name (after removing the stale file). */
async function pullFamily(
  type: string,
  name: string,
  relPath: string,
  extra: string[] = [],
): Promise<Record<string, unknown>> {
  rmSrc(relPath);
  const pull = await runCli(['pull', name, '--type', type, '--json', ...extra]);
  expect(pull.exit, pull.stderr || pull.stdout).toBe(0);
  return readSrc(relPath);
}

const AUTH_DOC = {
  formatVersion: '1',
  generalInformation: { dataElement: 'ACTIV_AUTH', activityField: true },
  alternativeSearchHelp: { checkTable: 'TACT' },
};

const SUSC_DOC = {
  formatVersion: '1',
  header: { description: 'CLI test authorization object class', originalLanguage: 'en' },
};

const SUCU_GROUP = 'ZCLI_TC_SUCU_A';
const SUCU_OBJECT = 'S_TABU_DIS';
const SUCU_NAME = `${SUCU_GROUP}~${SUCU_OBJECT}`;
const SUCU_TOKEN = 'zcli_tc_sucu_a~s_tabu_dis';

const SUCU_DOC = {
  formatVersion: '1',
  header: { description: 'CLI test authorization group', originalLanguage: 'EN' },
  generalInformation: { authorizationGroup: SUCU_GROUP, authorizationObject: SUCU_OBJECT },
  texts: [{ language: 'DE', description: 'CLI-Test-Berechtigungsgruppe' }],
};

const SUSH_NAME = 'ZCLI_TC_SUSH_FM.RF';
const SUSH_TOKEN = 'zcli_tc_sush_fm_rf';

const SUSH_DOC = {
  formatVersion: '1',
  header: { description: 'R3TR FUNC ZCLI_TC_SUSH_FM', originalLanguage: 'en', abapLanguageVersion: 'standard' },
  generalInformation: {
    applicationName: 'ZCLI_TC_SUSH_FM',
    applicationType: 'FUNC',
    maintenanceMode: 'manual',
    defaultValuesRequired: 'yes',
  },
  authorizationObjects: [
    {
      authObjectName: 'S_RFC',
      maintenanceStatus: 'defaultWithValues',
      authObjectFieldValues: [
        { authFieldName: 'RFC_TYPE', authFieldLowValue: 'FUGR' },
        { authFieldName: 'RFC_NAME', authFieldLowValue: 'ZCLI_TC_SUSH_FM' },
        { authFieldName: 'ACTVT', authFieldLowValue: '16' },
      ],
    },
  ],
};

const SUSO_NAME = 'ZCLI_SUSO1';
const SUSO_TOKEN = 'zcli_suso1';

const SUSO_DOC = {
  formatVersion: '1',
  header: { description: 'CLI test authorization object', originalLanguage: 'en' },
  generalInformation: { objectClass: 'AAAT' },
  authorizationFields: [{ authorizationField: 'ACTVT' }],
  permittedActivities: [{ activity: '03' }],
  longText: '&DEFINITION&\nCLI test long text',
};

afterAll(() => {
  rmSync(TMP_HOME, { recursive: true, force: true });
  rmSync(TMP_PROJECT, { recursive: true, force: true });
});

describe.skipIf(!hasBuiltCli)('authorization-object family lifecycle (mock ICF routes)', () => {
  it('AUTH: create → pull → push → pull → delete', async () => {
    await withMock(async () => {
      const input = writeSrc('auth-x1-input.auth.json', AUTH_DOC);
      const created = await runCli([
        'create', 'AUTH', 'ZCLI_TC_AUTH_X1', '--package', '$TMP', '--file', input, '--yes', '--json',
      ]);
      expect(created.exit, created.stderr || created.stdout).toBe(0);
      expect(parseEnvelope(created).data).toMatchObject({
        object: 'ZCLI_TC_AUTH_X1', type: 'AUTH', action: 'created', package: '$TMP', file: input,
      });

      // Pull writes the canonical file name and strips the read-side metadata.
      rmSrc(input);
      const rel = 'src/zcli_tc_auth_x1.auth.json';
      const pulled = await pullFamily('AUTH', 'ZCLI_TC_AUTH_X1', rel);
      expect(pulled).toMatchObject({
        formatVersion: '1',
        generalInformation: { dataElement: 'ACTIV_AUTH', activityField: true },
        alternativeSearchHelp: { checkTable: 'TACT' },
      });
      expect(pulled).not.toHaveProperty('name');
      expect(pulled).not.toHaveProperty('package');

      // Push updates the object through PUT; the second pull sees the change.
      writeSrc(rel, {
        ...pulled,
        generalInformation: { dataElement: 'ACTIV_AUTH', activityField: false },
      });
      const pushed = await runCli(['push', rel, '--yes', '--json']);
      expect(pushed.exit, pushed.stderr || pushed.stdout).toBe(0);
      const results = (parseEnvelope(pushed).data as { results: Array<Record<string, unknown>> }).results;
      expect(results[0]).toMatchObject({ file: rel, status: 'written', written: true, activated: false });

      const repulled = await pullFamily('AUTH', 'ZCLI_TC_AUTH_X1', rel);
      expect(repulled.generalInformation).toMatchObject({ dataElement: 'ACTIV_AUTH' });
      expect((repulled.generalInformation as Record<string, unknown>).activityField ?? false).toBe(false);
      expect(repulled).not.toHaveProperty('name');

      // Duplicate create is refused by the server (409 → AUTH_ALREADY_EXISTS).
      const duplicate = await runCli([
        'create', 'AUTH', 'ZCLI_TC_AUTH_X1', '--package', '$TMP', '--file', writeSrc('auth-x1-dup.auth.json', AUTH_DOC), '--yes', '--json',
      ]);
      expectFailure(duplicate, 7, 'AUTH_ALREADY_EXISTS');

      const deleted = await runCli(['delete', 'ZCLI_TC_AUTH_X1', '--type', 'AUTH', '--yes', '--json']);
      expect(deleted.exit, deleted.stderr || deleted.stdout).toBe(0);
      expect(parseEnvelope(deleted).data).toMatchObject({
        object: 'ZCLI_TC_AUTH_X1', type: 'AUTH', packageName: '$TMP', deleted: true,
      });
      const gone = await runCli(['pull', 'ZCLI_TC_AUTH_X1', '--type', 'AUTH', '--json']);
      expectFailure(gone, 8, 'OBJECT_NOT_FOUND');
    });
  });

  it('SUSC: create → pull → push → pull → delete', async () => {
    await withMock(async () => {
      const input = writeSrc('susc-zt01-input.susc.json', SUSC_DOC);
      const created = await runCli([
        'create', 'SUSC', 'ZT01', '--package', '$TMP', '--file', input, '--yes', '--json',
      ]);
      expect(created.exit, created.stderr || created.stdout).toBe(0);
      expect(parseEnvelope(created).data).toMatchObject({ object: 'ZT01', type: 'SUSC', action: 'created', package: '$TMP' });

      const rel = 'src/zt01.susc.json';
      const pulled = await pullFamily('SUSC', 'ZT01', rel);
      expect(pulled).toMatchObject({
        formatVersion: '1',
        header: { description: 'CLI test authorization object class', originalLanguage: 'en' },
      });
      expect(pulled).not.toHaveProperty('name');

      writeSrc(rel, { ...pulled, header: { description: 'CLI test class v2', originalLanguage: 'en' } });
      const pushed = await runCli(['push', rel, '--yes', '--json']);
      expect(pushed.exit, pushed.stderr || pushed.stdout).toBe(0);

      const repulled = await pullFamily('SUSC', 'ZT01', rel);
      expect(repulled.header).toMatchObject({ description: 'CLI test class v2', originalLanguage: 'en' });

      const deleted = await runCli(['delete', 'ZT01', '--type', 'SUSC', '--yes', '--json']);
      expect(deleted.exit, deleted.stderr || deleted.stdout).toBe(0);
      expectFailure(await runCli(['pull', 'ZT01', '--type', 'SUSC', '--json']), 8, 'OBJECT_NOT_FOUND');
    });
  });

  it('SUCU: create → pull → push → pull → delete (compact composite key)', async () => {
    await withMock(async () => {
      const input = writeSrc('sucu-input.sucu.json', SUCU_DOC);
      const created = await runCli([
        'create', 'SUCU', SUCU_NAME, '--package', '$TMP', '--file', input, '--yes', '--json',
      ]);
      expect(created.exit, created.stderr || created.stdout).toBe(0);
      expect(parseEnvelope(created).data).toMatchObject({
        object: SUCU_NAME, type: 'SUCU', action: 'created', package: '$TMP',
      });

      // A single `/` is not a key separator (OBJECT may itself be namespaced):
      // only the compact `~` form and the raw 40-character TADIR name are valid.
      expectFailure(
        await runCli(['pull', `${SUCU_GROUP}/${SUCU_OBJECT}`, '--type', 'SUCU', '--json']),
        7,
        'SUCU_NAME_INVALID',
      );

      // The pull token keeps the group/object split reversible (`~` separator,
      // no dot because the generic AFF resolver splits the stem on `.`).
      const rel = `src/${SUCU_TOKEN}.sucu.json`;
      const pulled = await pullFamily('SUCU', SUCU_NAME, rel);
      expect(pulled).toMatchObject({
        formatVersion: '1',
        header: { description: 'CLI test authorization group', originalLanguage: 'en' },
        generalInformation: { authorizationGroup: SUCU_GROUP, authorizationObject: SUCU_OBJECT },
      });
      expect(pulled.texts).toEqual([{ language: 'de', description: 'CLI-Test-Berechtigungsgruppe' }]);
      expect(pulled).not.toHaveProperty('name');
      expect(pulled).not.toHaveProperty('package');

      writeSrc(rel, {
        ...pulled,
        header: { description: 'CLI test authorization group v2', originalLanguage: 'EN' },
      });
      const pushed = await runCli(['push', rel, '--yes', '--json']);
      expect(pushed.exit, pushed.stderr || pushed.stdout).toBe(0);

      const repulled = await pullFamily('SUCU', SUCU_NAME, rel);
      expect(repulled.header).toMatchObject({ description: 'CLI test authorization group v2' });

      const deleted = await runCli(['delete', SUCU_NAME, '--type', 'SUCU', '--yes', '--json']);
      expect(deleted.exit, deleted.stderr || deleted.stdout).toBe(0);
      expect(parseEnvelope(deleted).data).toMatchObject({ object: SUCU_NAME, type: 'SUCU', deleted: true });
      expectFailure(await runCli(['pull', SUCU_NAME, '--type', 'SUCU', '--json']), 8, 'OBJECT_NOT_FOUND');
    });
  });

  it('SUSH: create → pull → push → pull → delete (RF application)', async () => {
    await withMock(async () => {
      const input = writeSrc('sush-input.sush.json', SUSH_DOC);
      const created = await runCli([
        'create', 'SUSH', SUSH_NAME, '--package', '$TMP', '--file', input, '--yes', '--json',
      ]);
      expect(created.exit, created.stderr || created.stdout).toBe(0);
      expect(parseEnvelope(created).data).toMatchObject({ object: SUSH_NAME, type: 'SUSH', action: 'created' });

      const rel = `src/${SUSH_TOKEN}.sush.json`;
      const pulled = await pullFamily('SUSH', SUSH_NAME, rel);
      expect(pulled).toMatchObject({
        formatVersion: '1',
        generalInformation: {
          applicationName: 'ZCLI_TC_SUSH_FM', applicationType: 'FUNC', maintenanceMode: 'manual',
        },
      });
      expect(pulled.authorizationObjects).toHaveLength(1);
      expect(pulled).not.toHaveProperty('package');

      // The leading application is immutable; only the SU22 payload changes.
      writeSrc(rel, {
        ...pulled,
        generalInformation: { ...(pulled.generalInformation as Record<string, unknown>), maintenanceMode: 'noDefaultValues' },
        authorizationObjects: [
          ...(pulled.authorizationObjects as unknown[]),
          { authObjectName: 'S_TCODE', maintenanceStatus: 'noDefault' },
        ],
      });
      const pushed = await runCli(['push', rel, '--yes', '--json']);
      expect(pushed.exit, pushed.stderr || pushed.stdout).toBe(0);

      const repulled = await pullFamily('SUSH', SUSH_NAME, rel);
      expect((repulled.generalInformation as Record<string, unknown>).maintenanceMode).toBe('noDefaultValues');
      expect(repulled.authorizationObjects).toHaveLength(2);

      const deleted = await runCli(['delete', SUSH_NAME, '--type', 'SUSH', '--yes', '--json']);
      expect(deleted.exit, deleted.stderr || deleted.stdout).toBe(0);
      expectFailure(await runCli(['pull', SUSH_NAME, '--type', 'SUSH', '--json']), 8, 'OBJECT_NOT_FOUND');
    });
  });

  it('SUSH: create is limited to RF applications (other key types are SAP-computed)', async () => {
    await withMock(async () => {
      const tranDoc = {
        formatVersion: '1',
        header: { description: 'R3TR TRAN SMICM', originalLanguage: 'en' },
        generalInformation: {
          applicationName: 'SMICM', applicationType: 'TRAN', maintenanceMode: 'manual', defaultValuesRequired: 'yes',
        },
      };
      const input = writeSrc('sush-tran-input.sush.json', tranDoc);
      const created = await runCli(['create', 'SUSH', 'SMICM.TR', '--package', '$TMP', '--file', input, '--yes', '--json']);
      expectFailure(created, 7, 'SUSH_UNSUPPORTED', 'RF');
    });
  });

  it('SUSO: create/pull/push/delete + profile regeneration is opt-in', async () => {
    await withMock(async () => {
      const input = writeSrc('suso-input.suso.json', SUSO_DOC);
      // Default: no regeneration, so no `profilesRegenerated` in the result.
      const created = await runCli(['create', 'SUSO', SUSO_NAME, '--package', '$TMP', '--file', input, '--yes', '--json']);
      expect(created.exit, created.stderr || created.stdout).toBe(0);
      const createdData = parseEnvelope(created).data as Record<string, unknown>;
      expect(createdData).toMatchObject({ object: SUSO_NAME, type: 'SUSO', action: 'created' });
      expect(createdData).not.toHaveProperty('profilesRegenerated');

      const rel = `src/${SUSO_TOKEN}.suso.json`;
      const pulled = await pullFamily('SUSO', SUSO_NAME, rel);
      expect(pulled).toMatchObject({
        formatVersion: '1',
        generalInformation: { objectClass: 'AAAT' },
        longText: '&DEFINITION&\nCLI test long text',
      });
      expect(pulled).not.toHaveProperty('name');
      expect(pulled).not.toHaveProperty('package');

      // Push with the explicit opt-in: the mock answers profilesRegenerated=true.
      writeSrc(rel, { ...pulled, header: { description: 'CLI test authorization object v2', originalLanguage: 'en' } });
      const pushed = await runCli(['push', rel, '--regenerate-profiles', '--yes', '--json']);
      expect(pushed.exit, pushed.stderr || pushed.stdout).toBe(0);
      const pushResults = (parseEnvelope(pushed).data as { results: Array<Record<string, unknown>> }).results;
      expect(pushResults[0]).toMatchObject({ status: 'written', profilesRegenerated: true });

      const repulled = await pullFamily('SUSO', SUSO_NAME, rel);
      expect(repulled.header).toMatchObject({ description: 'CLI test authorization object v2' });

      // Delete with the opt-in reports the regeneration too.
      const deleted = await runCli(['delete', SUSO_NAME, '--type', 'SUSO', '--regenerate-profiles', '--yes', '--json']);
      expect(deleted.exit, deleted.stderr || deleted.stdout).toBe(0);
      expect(parseEnvelope(deleted).data).toMatchObject({ deleted: true, profilesRegenerated: true });
      expectFailure(await runCli(['pull', SUSO_NAME, '--type', 'SUSO', '--json']), 8, 'OBJECT_NOT_FOUND');
    });
  });

  it('--regenerate-profiles is SUSO-only', async () => {
    await withMock(async () => {
      const input = writeSrc('auth-regen.auth.json', AUTH_DOC);
      expectFailure(
        await runCli(['create', 'AUTH', 'ZCLI_TC_AUTH_REGEN', '--package', '$TMP', '--file', input, '--regenerate-profiles', '--yes', '--json']),
        7,
        'VALIDATION_ERROR',
        'SUSO',
      );
      // Create without the flag (the object is needed for the push/delete checks).
      const created = await runCli(['create', 'AUTH', 'ZCLI_TC_AUTH_REGEN', '--package', '$TMP', '--file', input, '--yes', '--json']);
      expect(created.exit, created.stderr || created.stdout).toBe(0);
      const rel = 'src/zcli_tc_auth_regen.auth.json';
      await pullFamily('AUTH', 'ZCLI_TC_AUTH_REGEN', rel);
      expectFailure(await runCli(['push', rel, '--regenerate-profiles', '--yes', '--json']), 7, 'VALIDATION_ERROR', 'SUSO');
      expectFailure(
        await runCli(['delete', 'ZCLI_TC_AUTH_REGEN', '--type', 'AUTH', '--regenerate-profiles', '--yes', '--json']),
        7,
        'VALIDATION_ERROR',
        'SUSO',
      );
    });
  });

  it('rejects invalid create input before any SAP write', async () => {
    await withMock(async () => {
      // --file is mandatory for the family (the document carries every field).
      expectFailure(
        await runCli(['create', 'AUTH', 'ZCLI_TC_AUTH_NOFILE', '--package', '$TMP', '--description', 'x', '--yes', '--json']),
        2,
        'USAGE',
        '--file',
      );
      // Invalid document fails local schema validation.
      const bad = writeSrc('auth-bad.auth.json', { formatVersion: '1' });
      expectFailure(
        await runCli(['create', 'AUTH', 'ZCLI_TC_AUTH_BAD', '--package', '$TMP', '--file', bad, '--yes', '--json']),
        7,
        'AFF_FIXTURE_INVALID',
      );
      // Wrong document suffix is caught before the request.
      const wrongSuffix = writeSrc('auth-wrong.json', AUTH_DOC);
      expectFailure(
        await runCli(['create', 'AUTH', 'ZCLI_TC_AUTH_SUFFIX', '--package', '$TMP', '--file', wrongSuffix, '--yes', '--json']),
        7,
        'VALIDATION_ERROR',
        '.auth.json',
      );
      // The family has no separate activation step and no separate description.
      const good = writeSrc('auth-good.auth.json', AUTH_DOC);
      expectFailure(
        await runCli(['create', 'AUTH', 'ZCLI_TC_AUTH_NA', '--package', '$TMP', '--file', good, '--no-activate', '--yes', '--json']),
        7,
        'VALIDATION_ERROR',
        '--no-activate',
      );
      expectFailure(
        await runCli(['create', 'AUTH', 'ZCLI_TC_AUTH_DESC', '--package', '$TMP', '--file', good, '--description', 'x', '--yes', '--json']),
        7,
        'VALIDATION_ERROR',
        '--description',
      );
    });
  });

  it('non-local package writes require --tr and unknown objects map to OBJECT_NOT_FOUND', async () => {
    await withMock(async () => {
      const input = writeSrc('auth-nonlocal.auth.json', AUTH_DOC);
      expectFailure(
        await runCli(['create', 'AUTH', 'ZCLI_TC_AUTH_ZPKG', '--package', 'ZPKG', '--file', input, '--yes', '--json']),
        7,
        'AUTH_TRANSPORT_REQUIRED',
      );

      expectFailure(await runCli(['pull', 'ZCLI_TC_AUTH_MISSING', '--type', 'AUTH', '--json']), 8, 'OBJECT_NOT_FOUND');
      const missingFile = writeSrc('src/zcli_tc_auth_missing.auth.json', AUTH_DOC);
      expectFailure(await runCli(['push', missingFile, '--yes', '--json']), 8, 'OBJECT_NOT_FOUND');
      expectFailure(await runCli(['delete', 'ZCLI_TC_AUTH_MISSING', '--type', 'AUTH', '--yes', '--json']), 8, 'OBJECT_NOT_FOUND');
    });
  });

  it('push --dry-run plans without writing SAP', async () => {
    await withMock(async () => {
      const input = writeSrc('auth-dry.auth.json', AUTH_DOC);
      expect(
        (await runCli(['create', 'AUTH', 'ZCLI_TC_AUTH_DRY', '--package', '$TMP', '--file', input, '--yes', '--json'])).exit,
      ).toBe(0);
      const rel = 'src/zcli_tc_auth_dry.auth.json';
      const pulled = await pullFamily('AUTH', 'ZCLI_TC_AUTH_DRY', rel);
      writeSrc(rel, { ...pulled, alternativeSearchHelp: { checkTable: 'TVKO' } });

      const dryRun = await runCli(['push', rel, '--dry-run', '--json']);
      expect(dryRun.exit, dryRun.stderr || dryRun.stdout).toBe(0);
      const data = parseEnvelope(dryRun).data as { dryRun: boolean; results: Array<Record<string, unknown>> };
      expect(data.dryRun).toBe(true);
      expect(data.results[0]).toMatchObject({ status: 'dry-run', written: false });

      // SAP still carries the previous document.
      const repulled = await pullFamily('AUTH', 'ZCLI_TC_AUTH_DRY', rel);
      expect(repulled.alternativeSearchHelp).toMatchObject({ checkTable: 'TACT' });
    });
  });

  it('pulls standard objects and refuses where-used / unsupported deletes', async () => {
    await withMock(async () => {
      // Read path for every family member (the fixtures mirror standard objects).
      const authFixture = await pullFamily('AUTH', 'VKORG', 'src/fixtures/vkorg.auth.json', ['--dir', 'src/fixtures']);
      expect(authFixture.generalInformation).toMatchObject({ dataElement: 'VKORG' });
      const suscFixture = await pullFamily('SUSC', 'CV', 'src/fixtures/cv.susc.json', ['--dir', 'src/fixtures']);
      expect(suscFixture.header).toMatchObject({ originalLanguage: 'en' });
      const sucuFixture = await pullFamily('SUCU', 'CMMFDOR~S_TABU_DIS', 'src/fixtures/cmmfdor~s_tabu_dis.sucu.json', ['--dir', 'src/fixtures']);
      expect(sucuFixture.generalInformation).toMatchObject({ authorizationGroup: 'CMMFDOR', authorizationObject: SUCU_OBJECT });
      const sushFixture = await pullFamily('SUSH', 'OCS_GET_INSTALLED_COMPS.RF', 'src/fixtures/ocs_get_installed_comps_rf.sush.json', ['--dir', 'src/fixtures']);
      expect(sushFixture.generalInformation).toMatchObject({ applicationName: 'OCS_GET_INSTALLED_COMPS', applicationType: 'FUNC' });
      const susoFixture = await pullFamily('SUSO', '/AIF/CDLOG', 'src/fixtures/(aif)cdlog.suso.json', ['--dir', 'src/fixtures']);
      expect(susoFixture.generalInformation).toMatchObject({ objectClass: 'AAAT' });

      // Delete guards: referenced / delivered objects are never deleted.
      expectFailure(
        await runCli(['delete', 'VKORG', '--type', 'AUTH', '--tr', 'TRN001', '--yes', '--json']),
        7,
        'AUTH_DELETE_REFUSED',
      );
      expectFailure(
        await runCli(['delete', 'CV', '--type', 'SUSC', '--tr', 'TRN001', '--yes', '--json']),
        7,
        'SUSC_DELETE_REFUSED',
      );
      // Non-local SUCU objects cannot record the CTS delete from the ICF session.
      expectFailure(
        await runCli(['delete', 'CMMFDOR~S_TABU_DIS', '--type', 'SUCU', '--tr', 'TRN001', '--yes', '--json']),
        7,
        'SUCU_DELETE_UNSUPPORTED',
      );
      expectFailure(
        await runCli(['delete', '/AIF/CDLOG', '--type', 'SUSO', '--tr', 'TRN001', '--yes', '--json']),
        7,
        'SUSO_DELETE_REFUSED',
      );
    });
  });
});
