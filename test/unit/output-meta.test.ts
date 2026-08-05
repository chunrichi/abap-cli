import { afterEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { CliError, renderError, renderResult } from '../../src/abap_cli/output/json.js';
import {
  buildMeta,
  collectWarning,
  getWarnings,
  resetWarnings,
  setProgram,
} from '../../src/abap_cli/output/meta.js';

function makeTree(): Command {
  const program = new Command().name('abap');
  program.command('pull');
  const connection = program.command('connection');
  connection.command('test');
  connection.command('set');
  return program;
}

describe('output meta (FR-003, FR-004, US-1)', () => {
  afterEach(() => {
    resetWarnings();
    vi.restoreAllMocks();
  });

  it('buildMeta returns complete meta fields', () => {
    const meta = buildMeta();
    expect(typeof meta.command).toBe('string');
    expect(typeof meta.version).toBe('string');
    expect(meta.version.length).toBeGreaterThan(0);
    expect(meta.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Number.isInteger(meta.durationMs)).toBe(true);
    expect(meta.durationMs).toBeGreaterThanOrEqual(0);
    expect(meta.warnings).toEqual([]);
  });

  it('derives a nested command name from argv + command tree', () => {
    setProgram(makeTree());
    vi.spyOn(process, 'argv', 'get').mockReturnValue(
      ['node', 'index.js', 'connection', 'test', 'dev'] as never,
    );
    expect(buildMeta().command).toBe('abap connection test');
  });

  it('derives a top-level command name', () => {
    setProgram(makeTree());
    vi.spyOn(process, 'argv', 'get').mockReturnValue(
      ['node', 'index.js', 'pull', 'Z_CLASS', '--json'] as never,
    );
    expect(buildMeta().command).toBe('abap pull');
  });

  it('falls back to abap when no command matches', () => {
    setProgram(makeTree());
    vi.spyOn(process, 'argv', 'get').mockReturnValue(['node', 'index.js', '--json'] as never);
    expect(buildMeta().command).toBe('abap');
  });

  it('collectWarning appends in order and getWarnings returns a copy', () => {
    collectWarning('DEPRECATED_OPTION', 'first');
    collectWarning('FORCE_BYPASSED', 'second', { opt: true });
    const snap = getWarnings();
    expect(snap).toHaveLength(2);
    expect(snap[0]).toEqual({ code: 'DEPRECATED_OPTION', message: 'first' });
    expect(snap[1]).toEqual({ code: 'FORCE_BYPASSED', message: 'second', details: { opt: true } });
    snap.push({ code: 'UNLOCK_WARNING', message: 'x' });
    expect(getWarnings()).toHaveLength(2);
    expect(buildMeta().warnings).toHaveLength(2);
  });

  it('resetWarnings clears the store', () => {
    collectWarning('UNLOCK_WARNING', 'x');
    resetWarnings();
    expect(getWarnings()).toEqual([]);
    expect(buildMeta().warnings).toEqual([]);
  });

  it('envelope top-level keys are identical across heterogeneous commands (US-1)', () => {
    setProgram(makeTree());
    const payloads = [
      { object: 'ZCL_DEMO', type: 'CLAS', entries: [] }, // pull
      { results: [{ name: 'ZCL_FOO' }], total: 1 }, // search
      { objectName: 'ZCL_NEW', type: 'CLAS', file: 'src/zcl_new.clas.abap' }, // create
      { environment: [], config: [], connection: [], nextSteps: [] }, // doctor
      { status: 'in-sync', changedParts: [] }, // sync
    ];
    for (const payload of payloads) {
      const out = renderResult(true, payload, '', buildMeta());
      expect(Object.keys(JSON.parse(out.stdout[0]!)).sort()).toEqual(['data', 'meta', 'status']);
    }
    const failOut = renderError(true, new CliError('USAGE', 'bad'), buildMeta());
    expect(Object.keys(JSON.parse(failOut.stderr[0]!)).sort()).toEqual(['error', 'meta', 'status']);
  });

  it('warnings live only in meta.warnings and never affect exit codes (US-2, FR-009)', () => {
    collectWarning('DEPRECATED_OPTION', '--max is deprecated');
    const success = renderResult(true, { ok: 1 }, '', buildMeta());
    const successJson = JSON.parse(success.stdout[0]!);
    expect(successJson.meta.warnings).toHaveLength(1);
    expect(successJson.meta.warnings[0]!.code).toBe('DEPRECATED_OPTION');
    expect(success.exitCode).toBeUndefined(); // exit 0

    const fail = renderError(true, new CliError('USAGE', 'bad flag'), buildMeta());
    const failJson = JSON.parse(fail.stderr[0]!);
    expect(failJson.meta.warnings).toHaveLength(1);
    expect(failJson.error).not.toHaveProperty('warnings');
    expect(failJson.error).not.toHaveProperty('UNLOCK_WARNING');
    expect(fail.exitCode).toBe(2); // USAGE → 2, unaffected by the warning
  });

  it('every WarningCode is collectable and surfaces in meta.warnings (US-5)', () => {
    const codes = [
      'UNLOCK_WARNING',
      'DEPRECATED_OPTION',
      'PASSWORD_EXPORT',
      'KEYCHAIN_WARNING',
      'FORCE_BYPASSED',
      'PROFILE_MISMATCH',
      'STUCK_REPORT_DEGRADED',
    ] as const;
    for (const code of codes) {
      collectWarning(code, `msg for ${code}`);
    }
    const warnings = buildMeta().warnings;
    expect(warnings).toHaveLength(codes.length);
    for (const code of codes) {
      expect(warnings).toContainEqual({ code, message: `msg for ${code}` });
    }
  });
});
