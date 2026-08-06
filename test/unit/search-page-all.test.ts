import { describe, expect, it, vi, beforeEach } from 'vitest';
import { registerSearchCommand } from '../../src/abap_cli/commands/search.js';
import { makeProgram, runCommand } from './cli-helper.js';

/**
 * `--page-all` — real ADT quickSearch has no offset: every call returns the
 * same leading slice, so the command fetches ONCE with maxResults = limit ×
 * pageAllMax and reports whether the server may still have more. The mock
 * mirrors that contract (slice(0, max) per call).
 */

// 53 synthetic matches. Default --limit 20 × --page-all-max 50 = 1000 requested
// covers them all; a tight cap (e.g. 2 pages × 20 = 40) forces truncation.
const NAMES = Array.from({ length: 53 }, (_, i) => `ZPG_${String(i + 1).padStart(3, '0')}`);

const searchObject = vi.fn(async (query: string, _type?: string, maxResults = 100) => {
  // Real ADT: `*` wildcards are stripped server-side for substring matching.
  const q = (query || '').replace(/\*/g, '').toUpperCase();
  return NAMES.filter((n) => n.includes(q))
    .slice(0, maxResults)
    .map((name, i) => ({
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

describe('abap search --page-all', () => {
  beforeEach(() => searchObject.mockClear());

  it('fetches once with requested = limit × pageAllMax and returns the full set', async () => {
    const program = makeProgram();
    registerSearchCommand(program);
    const res = await runCommand(program, ['search', 'ZPG', '--page-all', '--json']);
    const { json, exitCode } = parseJsonOutput(res);
    expect(exitCode).toBeUndefined();
    expect(json.status).toBe('success');
    expect(searchObject).toHaveBeenCalledTimes(1);
    expect(searchObject).toHaveBeenCalledWith('ZPG', undefined, 1000);
    expect(json.data.pageAll).toBe(true);
    expect(json.data.requested).toBe(1000);
    expect(json.data.items).toHaveLength(53);
    expect(json.data.total).toBe(53);
    expect(json.data.truncated).toBeUndefined();
  });

  it('sizes the single request from a custom --limit', async () => {
    const program = makeProgram();
    registerSearchCommand(program);
    const res = await runCommand(program, ['search', 'ZPG', '--page-all', '--limit', '10', '--json']);
    const { json, exitCode } = parseJsonOutput(res);
    expect(exitCode).toBeUndefined();
    expect(searchObject).toHaveBeenCalledWith('ZPG', undefined, 500);
    expect(json.data.requested).toBe(500);
    expect(json.data.items).toHaveLength(53);
  });

  it('emits PAGINATION_LIMITED and sets truncated:true when the request hits the cap', async () => {
    const program = makeProgram();
    registerSearchCommand(program);
    // 2 pages × 20 = 40 requested; the server has 53 → truncated.
    const res = await runCommand(program, ['search', 'ZPG', '--page-all', '--page-all-max', '2', '--json']);
    const { json, exitCode } = parseJsonOutput(res);
    expect(exitCode).toBeUndefined();
    expect(searchObject).toHaveBeenCalledWith('ZPG', undefined, 40);
    expect(json.data.pageAll).toBe(true);
    expect(json.data.requested).toBe(40);
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

  it('--page-all with --exact applies the exact filter on the fetched set', async () => {
    const program = makeProgram();
    registerSearchCommand(program);
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
