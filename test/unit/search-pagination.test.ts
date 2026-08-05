import { describe, expect, it, vi, beforeEach } from 'vitest';
import { registerSearchCommand } from '../../src/abap_cli/commands/search.js';
import { makeProgram, runCommand } from './cli-helper.js';

// 25 synthetic matches so SC-001 (page 1 = 20, page 2 = 5) holds exactly.
const NAMES = [
  ...Array.from({ length: 24 }, (_, i) => `ZPAGE_${String(i + 1).padStart(2, '0')}`),
  'ZPAGE',
];

const searchObject = vi.fn(async (query: string, _type?: string, maxResults = 100) => {
  const q = (query || '').toUpperCase();
  let matches = NAMES.filter((n) => n.includes(q));
  if (q.startsWith('EXACT:')) matches = NAMES.filter((n) => n === q.slice(6));
  return matches.slice(0, maxResults).map((name, i) => ({
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

describe('abap search pagination (US1, SC-001/SC-002)', () => {
  beforeEach(() => searchObject.mockClear());

  it('default --limit 20 returns 20 items with truncated:true and a hint', async () => {
    const program = makeProgram();
    registerSearchCommand(program);
    const res = await runCommand(program, ['search', 'ZPAGE', '--json']);
    const { json, exitCode } = parseJsonOutput(res);
    expect(exitCode).toBeUndefined();
    expect(json.status).toBe('success');
    expect(json.data.items).toHaveLength(20);
    expect(json.data.page).toBe(1);
    expect(json.data.limit).toBe(20);
    expect(json.data.truncated).toBe(true);
    expect(typeof json.data.hint).toBe('string');
    expect(json.data.hint.length).toBeGreaterThan(0);
  });

  it('--page 2 returns the remaining 5 with truncated:false', async () => {
    const program = makeProgram();
    registerSearchCommand(program);
    const res = await runCommand(program, ['search', 'ZPAGE', '--page', '2', '--json']);
    const { json, exitCode } = parseJsonOutput(res);
    expect(exitCode).toBeUndefined();
    expect(json.data.items).toHaveLength(5);
    expect(json.data.page).toBe(2);
    expect(json.data.truncated).toBe(false);
    expect(json.data.items[0].name).toBe('ZPAGE_21');
  });

  it('--exact and --fuzzy are mutually exclusive (exit 2 INVALID_ARGUMENT)', async () => {
    const program = makeProgram();
    registerSearchCommand(program);
    const res = await runCommand(program, ['search', 'ZPAGE', '--exact', '--fuzzy', '--json']);
    expect(res.exitCode).toBe(2);
    const json = JSON.parse(res.stderr);
    expect(json.status).toBe('error');
    expect(json.error.code).toBe('INVALID_ARGUMENT');
  });

  it('--package filters results by packageName', async () => {
    const program = makeProgram();
    registerSearchCommand(program);
    const res = await runCommand(program, ['search', 'ZPAGE', '--package', 'ZPKG', '--json']);
    const { json, exitCode } = parseJsonOutput(res);
    expect(exitCode).toBeUndefined();
    expect(json.data.items.length).toBeGreaterThan(0);
    for (const item of json.data.items) expect(item.packageName).toBe('ZPKG');
  });

  it('--max is a deprecated alias for --limit (works + meta.warnings)', async () => {
    const program = makeProgram();
    registerSearchCommand(program);
    const res = await runCommand(program, ['search', 'ZPAGE', '--max', '5', '--json']);
    const { json, exitCode } = parseJsonOutput(res);
    expect(exitCode).toBeUndefined();
    expect(json.data.items).toHaveLength(5);
    expect(json.data.limit).toBe(5);
    expect(json.meta.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'DEPRECATED_OPTION' })]),
    );
  });
});
