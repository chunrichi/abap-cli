import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Command } from 'commander';
import { runCommand } from './cli-helper.js';
import { registerValidateAffCommand, runValidateAff, SCHEMA } from '../../src/abap_cli/commands/validate-aff.js';
import { CliError } from '../../src/abap_cli/output/json.js';

/**
 * Machine contract for `abap validate:aff`:
 *   - missing argument / nonexistent path / non-JSON target → USAGE (exit 2),
 *     never a success envelope with `files: []`
 *   - a file that fails schema validation (or misses a required companion) →
 *     VALIDATION_ERROR (exit 7) through the unified output layer, with
 *     `error.details` carrying `summary` + `files[]`
 *   - `--json` is compact, `--pretty-json` indents
 *   - `data.files[].path` is cwd-relative POSIX
 */

const ROOT = process.cwd();
const TMP = path.join(ROOT, 'tmp', '_validate-aff-contract');
const TMP_REL = path.posix.join('tmp', '_validate-aff-contract');

const GOOD_DOMA = {
  formatVersion: '1',
  header: { description: 'ok', originalLanguage: 'EN' },
  format: { dataType: 'CHAR', length: 3 },
  outputCharacteristics: { length: 3 },
};
const BAD_DOMA = {
  header: { description: 'missing formatVersion', originalLanguage: 'EN' },
  format: { dataType: 'CHAR', length: 3 },
  outputCharacteristics: { length: 3 },
};
const MAIN_ONLY_TABL = {
  formatVersion: '1',
  header: { description: 'no .ddic / .settings.json companions', originalLanguage: 'EN' },
};

function writeJson(name: string, doc: unknown): string {
  const abs = path.join(TMP, name);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(doc));
  return abs;
}

/** Root program with the two global output flags (mirrors index.ts). */
function makeProgramWithJsonFlags(): Command {
  return new Command()
    .option('--json', 'Output in JSON format')
    .option('--pretty-json', 'Output in pretty JSON format');
}

async function run(args: string[]) {
  const program = makeProgramWithJsonFlags();
  registerValidateAffCommand(program);
  return runCommand(program, args, { isTTY: false });
}

beforeEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
});
afterEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe('validate:aff usage contract', () => {
  it('missing target → USAGE exit 2 on stderr, not a success envelope', async () => {
    const res = await run(['validate:aff', '--json']);
    expect(res.exitCode).toBe(2);
    expect(res.stdout).toBe('');
    const parsed = JSON.parse(res.stderr);
    expect(parsed.status).toBe('error');
    expect(parsed.error.code).toBe('USAGE');
    expect(parsed.error.category).toBe('USAGE');
    expect(parsed.error.nextSteps.length).toBeGreaterThan(0);
  });

  it('nonexistent path → USAGE exit 2 and echoes the path', async () => {
    const res = await run(['validate:aff', path.join(TMP_REL, 'missing.json'), '--json']);
    expect(res.exitCode).toBe(2);
    expect(res.stdout).toBe('');
    const parsed = JSON.parse(res.stderr);
    expect(parsed.error.code).toBe('USAGE');
    expect(parsed.error.message).toContain(path.posix.join(TMP_REL, 'missing.json'));
  });

  it('nonexistent --wire directory → USAGE exit 2', async () => {
    const good = writeJson('good.doma.json', GOOD_DOMA);
    const res = await run(['validate:aff', path.relative(ROOT, good), '--wire', path.join(TMP_REL, 'nope'), '--json']);
    expect(res.exitCode).toBe(2);
    expect(JSON.parse(res.stderr).error.code).toBe('USAGE');
  });

  it('non-JSON file target → USAGE exit 2', async () => {
    const txt = path.join(TMP, 'notes.txt');
    fs.writeFileSync(txt, 'not json');
    const res = await run(['validate:aff', path.relative(ROOT, txt), '--json']);
    expect(res.exitCode).toBe(2);
    expect(JSON.parse(res.stderr).error.code).toBe('USAGE');
  });
});

describe('validate:aff success contract', () => {
  it('--json emits one compact unified envelope with cwd-relative POSIX paths', async () => {
    const good = writeJson('good.doma.json', GOOD_DOMA);
    const res = await run(['validate:aff', path.relative(ROOT, good), '--json']);
    expect(res.exitCode).toBeUndefined();
    expect(res.stderr).toBe('');
    // Compact: a single line, no indentation (token-efficient default).
    expect(res.stdout).not.toContain('\n');
    const parsed = JSON.parse(res.stdout);
    expect(parsed.status).toBe('success');
    expect(parsed.data.summary).toEqual({ pass: 1, warn: 0, fail: 0 });
    expect(parsed.data.files).toEqual([
      { status: 'pass', path: path.posix.join(TMP_REL, 'good.doma.json'), type: 'DOMA' },
    ]);
    // Contract: no absolute host paths leak into the envelope.
    expect(path.posix.isAbsolute(parsed.data.files[0].path)).toBe(false);
    expect(parsed.data.files[0].path).not.toContain('\\');
  });

  it('--pretty-json indents the same envelope', async () => {
    const good = writeJson('good.doma.json', GOOD_DOMA);
    const res = await run(['validate:aff', path.relative(ROOT, good), '--pretty-json']);
    expect(res.exitCode).toBeUndefined();
    expect(res.stdout.startsWith('{\n  "status"')).toBe(true);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.data.summary.pass).toBe(1);
  });

  it('human mode prints PASS lines on stdout', async () => {
    const good = writeJson('good.doma.json', GOOD_DOMA);
    const res = await run(['validate:aff', path.relative(ROOT, good)]);
    expect(res.exitCode).toBeUndefined();
    expect(res.stdout).toContain(`PASS ${path.posix.join(TMP_REL, 'good.doma.json')}`);
  });

  it('non-AFF JSON files are skipped instead of padding the summary', async () => {
    const random = writeJson('package.json', { name: 'not-an-aff-object' });
    const res = await run(['validate:aff', path.relative(ROOT, random), '--json']);
    expect(res.exitCode).toBeUndefined();
    const parsed = JSON.parse(res.stdout);
    expect(parsed.data.summary).toEqual({ pass: 0, warn: 0, fail: 0 });
    expect(parsed.data.files).toEqual([]);
  });
});

describe('validate:aff failure contract', () => {
  it('schema failure → VALIDATION_ERROR exit 7 with summary+files in error.details', async () => {
    const bad = writeJson('bad.doma.json', BAD_DOMA);
    const res = await run(['validate:aff', path.relative(ROOT, bad), '--json']);
    expect(res.exitCode).toBe(7);
    expect(res.stdout).toBe('');
    const parsed = JSON.parse(res.stderr);
    expect(parsed.status).toBe('error');
    expect(parsed.error.code).toBe('VALIDATION_ERROR');
    expect(parsed.error.category).toBe('VALIDATION_ERROR');
    expect(parsed.error.details.summary).toEqual({ pass: 0, warn: 0, fail: 1 });
    const file = parsed.error.details.files[0];
    expect(file.status).toBe('fail');
    expect(file.path).toBe(path.posix.join(TMP_REL, 'bad.doma.json'));
    expect(file.errors.length).toBeGreaterThan(0);
    expect(parsed.error.nextSteps.length).toBeGreaterThan(0);
  });

  it('missing required companion → VALIDATION_ERROR exit 7 and reported in the file entry', async () => {
    const main = writeJson('zmy.tabl.json', MAIN_ONLY_TABL);
    const mainExpected = path.posix.join(TMP_REL, 'zmy.tabl.json');
    const res = await run(['validate:aff', path.relative(ROOT, main), '--json']);
    expect(res.exitCode).toBe(7);
    const parsed = JSON.parse(res.stderr);
    expect(parsed.error.code).toBe('VALIDATION_ERROR');
    const file = parsed.error.details.files[0];
    expect(file.path).toBe(mainExpected);
    expect(file.status).toBe('fail');
    // `.tabl.ddic` is the only required companion; technical settings are
    // optional (reported separately, never a failure on their own).
    expect(file.missingCompanions).toEqual(['zmy.tabl.ddic']);
    expect(file.optionalCompanions).toContain('zmy.tabl.settings.json');
  });

  it('directory scan counts pass/fail and keeps going after a failing file', async () => {
    writeJson('dir/good.doma.json', GOOD_DOMA);
    writeJson('dir/bad.doma.json', BAD_DOMA);
    const res = await run(['validate:aff', path.posix.join(TMP_REL, 'dir'), '--json']);
    expect(res.exitCode).toBe(7);
    const parsed = JSON.parse(res.stderr);
    expect(parsed.error.details.summary).toEqual({ pass: 1, warn: 0, fail: 1 });
  });

  it('human mode prints FAIL lines and the unified Error summary on stderr', async () => {
    const bad = writeJson('bad.doma.json', BAD_DOMA);
    const res = await run(['validate:aff', path.relative(ROOT, bad)]);
    expect(res.exitCode).toBe(7);
    expect(res.stdout).toBe('');
    expect(res.stderr).toContain(`FAIL ${path.posix.join(TMP_REL, 'bad.doma.json')}`);
    expect(res.stderr).toContain('Error:');
  });
});

describe('validate:aff flow + schema contract', () => {
  it('runValidateAff rejects an empty target list with USAGE', async () => {
    await expect(runValidateAff([])).rejects.toMatchObject({ code: 'USAGE' });
  });

  it('runValidateAff returns data for passing files and a CliError for failures', async () => {
    const good = writeJson('good.doma.json', GOOD_DOMA);
    const bad = writeJson('bad.doma.json', BAD_DOMA);
    const ok = await runValidateAff([good], { cwd: ROOT });
    expect(ok.failure).toBeUndefined();
    expect(ok.data.summary.pass).toBe(1);

    const failed = await runValidateAff([bad], { cwd: ROOT });
    expect(failed.failure).toBeInstanceOf(CliError);
    expect(failed.failure?.code).toBe('VALIDATION_ERROR');
    expect(failed.failure?.details).toMatchObject({ summary: { pass: 0, warn: 0, fail: 1 } });
  });

  it('schema declares the unified exit codes and global output flags', () => {
    expect(SCHEMA.globalOptions).toEqual(['--json', '--pretty-json']);
    expect(SCHEMA.errors).toEqual(
      expect.arrayContaining([
        { code: 'USAGE', category: 'USAGE', exitCode: 2 },
        { code: 'VALIDATION_ERROR', category: 'VALIDATION_ERROR', exitCode: 7 },
      ]),
    );
  });
});
