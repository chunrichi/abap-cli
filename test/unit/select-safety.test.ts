/**
 * US3 safety / injection tests for `abap select`.
 *
 * These tests drive the real CLI binary against mock-adt (which mirrors the
 * ABAP handler's where grammar per research R8). The tests assert that:
 *   - read-only path: queries never write to the mock store
 *   - injection payloads are matched as literals (no SQL semantics)
 *   - MANDT, OR, parentheses, unsupported operators all return INVALID_WHERE
 *   - MOCK_QUERY_FAIL surfaces QUERY_FAILED
 *   - MOCK_AUTH_FAIL surfaces AUTH_ERROR (401 → exit 5)
 */
import { describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { writeFileSync, copyFileSync, unlinkSync, existsSync } from 'node:fs';

const ROOT = resolve(__dirname, '../..');
const CLI = resolve(ROOT, 'dist/src/abap_cli/index.js');
const MOCK = resolve(ROOT, 'test/mock-adt/server.js');
const ABAP_JSON = resolve(ROOT, '.abap.json');
const ABAP_JSON_BAK = `${ABAP_JSON}.bak-select-test`;

function startMock(env: Record<string, string> = {}): Promise<{ proc: ChildProcess; port: number }> {
  return new Promise((resolveP, rejectP) => {
    const port = 8080;
    const proc = spawn('node', [MOCK, String(port)], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const onData = (chunk: Buffer) => {
      const s = chunk.toString();
      if (s.includes('Mock ADT listening')) {
        proc.stdout?.off('data', onData);
        resolveP({ proc, port });
      }
    };
    proc.stdout?.on('data', onData);
    proc.on('error', rejectP);
    setTimeout(() => rejectP(new Error('mock-adt startup timeout')), 5000);
  });
}

function runCli(args: string[], port: number): Promise<{ stdout: string; stderr: string; exit: number }> {
  return new Promise((resolveP, rejectP) => {
    const proc = spawn('node', [CLI, ...args], {
      env: {
        ...process.env,
        SAP_PASSWORD: 'mockpw',
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

async function withMock<T>(env: Record<string, string>, fn: (port: number) => Promise<T>): Promise<T> {
  // Switch .abap.json to mock so IcfClient connects to local mock-adt.
  if (existsSync(ABAP_JSON)) {
    copyFileSync(ABAP_JSON, ABAP_JSON_BAK);
  }
  writeFileSync(ABAP_JSON, JSON.stringify({ system: 'mock', transport: '', package: '$TMP' }));
  const { proc, port } = await startMock(env);
  try {
    return await fn(port);
  } finally {
    proc.kill('SIGTERM');
    if (existsSync(ABAP_JSON_BAK)) {
      copyFileSync(ABAP_JSON_BAK, ABAP_JSON);
      unlinkSync(ABAP_JSON_BAK);
    } else {
      unlinkSync(ABAP_JSON);
    }
  }
}

describe('US3 — read-only safety contract', () => {
  it('basic select does not modify the mock table store', async () => {
    await withMock({}, async (port) => {
      await runCli(['select', '--table', 'ZTAB_FIXTURE', '--limit', '5', '--json'], port);
      // The mock doesn't expose a way to count rows, but we can verify that
      // a subsequent query returns the same row count (no hidden mutation).
      const a = await runCli(['select', '--table', 'ZTAB_FIXTURE', '--count-only', '--json'], port);
      const b = await runCli(['select', '--table', 'ZTAB_FIXTURE', '--count-only', '--json'], port);
      const aCount = JSON.parse(a.stdout).data.count;
      const bCount = JSON.parse(b.stdout).data.count;
      expect(aCount).toBe(bCount);
      expect(aCount).toBe(150);
    });
  });

  it('injection payload OR 1=1 is matched as literal (does not return all rows)', async () => {
    await withMock({}, async (port) => {
      const result = await runCli(
        ['select', '--table', 'ZTAB_FIXTURE', '--where', "STATUS = 'X' OR 1=1 --", '--json'],
        port,
      );
      const json = JSON.parse(result.stderr);
      expect(json.status).toBe('error');
      expect(json.error.code).toBe('INVALID_WHERE');
    });
  });

  it('injection payload with semicolon + DROP is matched as literal (no match, no harm)', async () => {
    await withMock({}, async (port) => {
      const result = await runCli(
        ['select', '--table', 'ZTAB_FIXTURE', '--where', "NAME = 'O''Brien; DROP TABLE ZTAB_FIXTURE --'", '--json'],
        port,
      );
      const json = JSON.parse(result.stdout);
      expect(json.status).toBe('success');
      expect(json.data.rowCount).toBe(0); // literal value, no rows match
    });
  });

  it('MANDT filter is rejected (implicit session client)', async () => {
    await withMock({}, async (port) => {
      const result = await runCli(
        ['select', '--table', 'ZTAB_FIXTURE', '--where', "MANDT = '001'", '--json'],
        port,
      );
      const json = JSON.parse(result.stderr);
      expect(json.status).toBe('error');
      expect(json.error.code).toBe('INVALID_WHERE');
      expect(json.error.message).toContain('MANDT');
    });
  });

  it('OR keyword without AND chaining is rejected', async () => {
    await withMock({}, async (port) => {
      const result = await runCli(
        ['select', '--table', 'ZTAB_FIXTURE', '--where', "STATUS = 'X' OR STATUS = 'Y'", '--json'],
        port,
      );
      const json = JSON.parse(result.stderr);
      expect(json.status).toBe('error');
      expect(json.error.code).toBe('INVALID_WHERE');
    });
  });

  it('LIKE on numeric field is rejected', async () => {
    await withMock({}, async (port) => {
      const result = await runCli(
        ['select', '--table', 'ZTAB_FIXTURE', '--where', "AMOUNT LIKE '1%'", '--json'],
        port,
      );
      const json = JSON.parse(result.stderr);
      expect(json.status).toBe('error');
      expect(json.error.code).toBe('INVALID_WHERE');
      expect(json.error.message).toContain('LIKE');
    });
  });

  it('numeric value on character field is rejected', async () => {
    await withMock({}, async (port) => {
      const result = await runCli(
        ['select', '--table', 'ZTAB_FIXTURE', '--where', "STATUS = 123", '--json'],
        port,
      );
      const json = JSON.parse(result.stderr);
      expect(json.status).toBe('error');
      expect(json.error.code).toBe('INVALID_WHERE');
    });
  });

  it('AND chain with both conditions returns intersection', async () => {
    await withMock({}, async (port) => {
      const result = await runCli(
        ['select', '--table', 'ZTAB_FIXTURE', '--where', "STATUS = 'Y' AND ID <= '0000000003'", '--json'],
        port,
      );
      const json = JSON.parse(result.stdout);
      expect(json.status).toBe('success');
      expect(json.data.rowCount).toBe(2);
      const ids = json.data.rows.map((r: { ID: string }) => r.ID);
      expect(ids).toEqual(['0000000001', '0000000003']);
    });
  });

  it('invalid offset via CLI rejects before SAP call', async () => {
    await withMock({}, async (port) => {
      const result = await runCli(
        ['select', '--table', 'ZTAB_FIXTURE', '--offset', '100001', '--json'],
        port,
      );
      const json = JSON.parse(result.stderr);
      expect(json.error.code).toBe('INVALID_ARGUMENT');
      expect(result.exit).toBe(2);
    });
  });

  it('AUTH failure surfaces AUTH_ERROR (exit 5)', async () => {
    await withMock({ MOCK_AUTH_FAIL: '1' }, async (port) => {
      const result = await runCli(
        ['select', '--table', 'ZTAB_FIXTURE', '--limit', '5', '--json'],
        port,
      );
      expect(result.exit).toBe(5);
      expect(result.stdout).toBe(''); // strict separation
      expect(result.stderr).toContain('AUTH_ERROR');
    });
  });

  it('QUERY_FAILED injection surfaces QUERY_FAILED (exit 6)', async () => {
    await withMock({ MOCK_QUERY_FAIL: '1' }, async (port) => {
      const result = await runCli(
        ['select', '--table', 'ZTAB_FIXTURE', '--json'],
        port,
      );
      const json = JSON.parse(result.stderr);
      expect(json.error.code).toBe('QUERY_FAILED');
      expect(result.exit).toBe(6);
    });
  });

  it('human-mode ASCII table renders with column widths', async () => {
    await withMock({}, async (port) => {
      const result = await runCli(
        ['select', '--table', 'ZTAB_FIXTURE', '--fields', 'ID,STATUS', '--limit', '3'],
        port,
      );
      expect(result.stdout).toContain('ID');
      expect(result.stdout).toContain('STATUS');
      expect(result.stdout).toMatch(/row\(s\)/);
      // With --fields, only requested columns are shown.
      expect(result.stdout).not.toContain('MANDT');
    });
  });
});