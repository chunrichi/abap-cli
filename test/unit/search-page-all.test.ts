import { describe, expect, it, vi, beforeEach } from 'vitest';
import { registerSearchCommand } from '../../src/abap_cli/commands/search.js';
import { makeProgram, runCommand } from './cli-helper.js';

/**
 * P1.8 — `abap search --page-all`. Auto-page through every result until the
 * server returns strictly fewer than `--limit` rows (the "last page"). The
 * mock client here mirrors that contract: pages of exactly `limit` until the
 * tail.
 */

// 53 synthetic matches: page size 20 → pages 1 (20), 2 (20), 3 (13).
// That gives us 3 pages exactly with the default cap (50), exercising both the
// "stop on short page" and "stop on dedup-progress" code paths.
const NAMES = Array.from({ length: 53 }, (_, i) => `ZPG_${String(i + 1).padStart(3, '0')}`);

let callIndex = 0;
const searchObject = vi.fn(async (query: string, _type?: string, maxResults = 100) => {
  const q = (query || '').toUpperCase();
  callIndex++;
  const all = NAMES.filter((n) => n.includes(q));
  // Simulate an SAP backend that returns the next slice every call.
  const start = ((callIndex - 1) % Math.ceil(all.length / maxResults)) * maxResults;
  return all.slice(start, start + maxResults).map((name, i) => ({
    'adtcore:name': name,
    'adtcore:type': 'PROG/P',
    'adtcore:uri': `/sap/bc/adt/programs/programs/${name.toLowerCase()}`,
    'adtcore:description': `Object ${i}`,
    'adtcore:packageName': i % 3 === 0 ? 'ZPKG' : '$TMP',
  }));
});

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: { create: async () => ({ searchObject }) },
}));

function parseJsonOutput(res: { stdout: string; stderr: string; exitCode?: number }) {
  const json = JSON.parse(res.stdout || res.stderr);
  return { json, exitCode: res.exitCode };
}

describe('abap search --page-all (P1.8)', () => {
  beforeEach(() => {
    searchObject.mockClear();
    callIndex = 0;
  });

  it('fetches every page and returns the full set with pageAll:true', async () => {
    const program = makeProgram();
    registerSearchCommand(program);
    const res = await runCommand(program, ['search', 'ZPG', '--page-all', '--json']);
    const { json, exitCode } = parseJsonOutput(res);
    expect(exitCode).toBeUndefined();
    expect(json.status).toBe('success');
    expect(json.data.pageAll).toBe(true);
    expect(json.data.items).toHaveLength(53);
    expect(json.data.total).toBe(53);
    expect(json.data.pagesFetched).toBe(3);
    expect(json.data.truncated).toBeUndefined();
  });

  it('still works with a custom --limit and computes pagesFetched accordingly', async () => {
    const program = makeProgram();
    registerSearchCommand(program);
    const res = await runCommand(program, ['search', 'ZPG', '--page-all', '--limit', '10', '--json']);
    const { json, exitCode } = parseJsonOutput(res);
    expect(exitCode).toBeUndefined();
    expect(json.data.pageAll).toBe(true);
    expect(json.data.limit).toBe(10);
    expect(json.data.items).toHaveLength(53);
    expect(json.data.pagesFetched).toBe(6);
  });

  it('emits PAGINATION_LIMITED warning and sets truncated:true when the cap is hit', async () => {
    const program = makeProgram();
    registerSearchCommand(program);
    // Default cap is 50 pages × 20 = 1000 items; 53 fits but a tight cap
    // forces the warning.
    const res = await runCommand(program, ['search', 'ZPG', '--page-all', '--page-all-max', '2', '--json']);
    const { json, exitCode } = parseJsonOutput(res);
    expect(exitCode).toBeUndefined();
    expect(json.data.pageAll).toBe(true);
    // 2 pages × 20 = 40 items, truncated
    expect(json.data.items).toHaveLength(40);
    expect(json.data.truncated).toBe(true);
    expect(json.meta.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'PAGINATION_LIMITED' })]),
    );
  });

  it('--page-all with --page (non-default) is rejected as INVALID_ARGUMENT', async () => {
    const program = makeProgram();
    registerSearchCommand(program);
    const res = await runCommand(program, ['search', 'ZPG', '--page-all', '--page', '2', '--json']);
    expect(res.exitCode).toBe(2);
    const json = JSON.parse(res.stderr);
    expect(json.status).toBe('error');
    expect(json.error.code).toBe('INVALID_ARGUMENT');
    expect(json.error.message).toMatch(/--page-all/);
  });

  it('--page 1 alone still works (back-compat with the single-page path)', async () => {
    const program = makeProgram();
    registerSearchCommand(program);
    const res = await runCommand(program, ['search', 'ZPG', '--page', '1', '--json']);
    const { json, exitCode } = parseJsonOutput(res);
    expect(exitCode).toBeUndefined();
    expect(json.data.pageAll).toBeUndefined();
    expect(json.data.page).toBe(1);
    expect(json.data.items).toHaveLength(20);
    expect(json.data.truncated).toBe(true);
  });

  it('--page-all with --exact applies the exact filter on the accumulated set', async () => {
    const program = makeProgram();
    registerSearchCommand(program);
    // Search for ZPG_007 — exact match should yield exactly 1.
    const res = await runCommand(program, ['search', 'ZPG_007', '--page-all', '--exact', '--json']);
    const { json, exitCode } = parseJsonOutput(res);
    expect(exitCode).toBeUndefined();
    expect(json.data.items.map((i: { name: string }) => i.name)).toEqual(['ZPG_007']);
  });

  it('human mode prints every item on its own line', async () => {
    const program = makeProgram();
    registerSearchCommand(program);
    const res = await runCommand(program, ['search', 'ZPG_001', '--page-all']);
    expect(res.exitCode).toBeUndefined();
    expect(res.stdout).toContain('Found 1 object(s)');
    expect(res.stdout).toContain('ZPG_001');
  });
});
