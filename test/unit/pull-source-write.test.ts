/**
 * T2.6 — generic writePullFile helper + AFF pre-write validation.
 *
 * Drives `writePullFile` directly (no ADT client) so we can assert:
 *  - identical content ⇒ 'skipped' (already matches)
 *  - differing content + --skip-existing ⇒ 'skipped'
 *  - differing content + no flags ⇒ OVERWRITE_REQUIRED
 *  - differing content + --overwrite ⇒ 'written'
 *  - `.json` schema violation ⇒ AFF_FIXTURE_INVALID before disk write
 *  - `.tabl.ddic` malformed DDL ⇒ FILE_PARSE_ERROR before disk write
 *  - schema-conformant `.json` ⇒ successfully written
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { writePullFile } from '../../src/abap_cli/flows/edit/pull-source.js';
import { CliError } from '../../src/abap_cli/output/json.js';

let cwd: string;
beforeEach(async () => {
  cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'abap-cli-write-pull-'));
});
afterEach(async () => {
  await fs.rm(cwd, { recursive: true, force: true });
});

describe('T2.6 writePullFile', () => {
  it('writes a schema-valid PROG .json file', async () => {
    const filePath = path.join(cwd, 'zprog_valid.prog.json');
    const content = JSON.stringify({
      formatVersion: '1',
      header: { description: 'valid', originalLanguage: 'EN' },
      generalInformation: { programType: 'executableProgram' },
    });
    const result = await writePullFile({ filePath, content });
    expect(result.status).toBe('written');
    expect(result.outPath).toBe(filePath);
    // File landed on disk.
    const written = await fs.readFile(filePath, 'utf-8');
    expect(written).toBe(content + '');
  });

  it('rejects a .json file that violates the AFF schema (AFF_FIXTURE_INVALID before disk write)', async () => {
    const filePath = path.join(cwd, 'zprog_bad.prog.json');
    // Missing required `header` → ajv reports 'fail' status.
    const bad = JSON.stringify({
      formatVersion: '1',
      generalInformation: { programType: 'executableProgram' },
    });
    await expect(writePullFile({ filePath, content: bad })).rejects.toMatchObject({
      code: 'AFF_FIXTURE_INVALID',
    });
    // File must NOT have been written.
    await expect(fs.stat(filePath)).rejects.toThrow();
  });

  it('rejects a .json file with rogue top-level field (AFF additionalProperties:false)', async () => {
    const filePath = path.join(cwd, 'zprog_rogue.prog.json');
    const bad = JSON.stringify({
      formatVersion: '1',
      header: { description: 'r', originalLanguage: 'EN' },
      rogueField: 'oops',
    });
    await expect(writePullFile({ filePath, content: bad })).rejects.toMatchObject({
      code: 'AFF_FIXTURE_INVALID',
    });
  });

  it('rejects a malformed JSON file (FILE_PARSE_ERROR)', async () => {
    const filePath = path.join(cwd, 'zprog_bad.prog.json');
    const broken = '{ this is not json';
    await expect(writePullFile({ filePath, content: broken })).rejects.toMatchObject({
      code: 'FILE_PARSE_ERROR',
    });
  });

  it('rejects malformed TABL/STRU DDL before disk write (FILE_PARSE_ERROR)', async () => {
    const filePath = path.join(cwd, 'ztab_split.tabl.ddic');
    const badDdl = 'this is not even close to ABAP DDL';
    await expect(writePullFile({ filePath, content: badDdl })).rejects.toMatchObject({
      code: 'FILE_PARSE_ERROR',
    });
    await expect(fs.stat(filePath)).rejects.toThrow();
  });

  it('writes a schema-valid FUGR .json file (FUGR schema pre-validation)', async () => {
    const filePath = path.join(cwd, 'zfugr_valid.fugr.json');
    const content = JSON.stringify({
      formatVersion: '1',
      header: { description: 'group', originalLanguage: 'en' },
      fixPointArithmetic: false,
    });
    const result = await writePullFile({ filePath, content });
    expect(result.status).toBe('written');
  });

  it('writes a schema-valid REPS .json file (REPS schema pre-validation)', async () => {
    const filePath = path.join(cwd, 'zfugr_saplzfugr.reps.json');
    const content = JSON.stringify({
      formatVersion: '1',
      header: { description: 'main' },
      includeType: 'functionGroup',
    });
    const result = await writePullFile({ filePath, content });
    expect(result.status).toBe('written');
  });

  it('writes a schema-valid FUNC .json file (FUNC schema pre-validation)', async () => {
    const filePath = path.join(cwd, 'zfugr_zfm.func.json');
    const content = JSON.stringify({
      formatVersion: '1',
      header: { description: 'fm' },
      processingType: 'normal',
      includeNumber: '1',
    });
    const result = await writePullFile({ filePath, content });
    expect(result.status).toBe('written');
  });

  it('skips identical content (already matches)', async () => {
    const filePath = path.join(cwd, 'zprog_same.prog.json');
    const content = JSON.stringify({
      formatVersion: '1',
      header: { description: 'same', originalLanguage: 'EN' },
    });
    await writePullFile({ filePath, content });
    const second = await writePullFile({ filePath, content });
    expect(second.status).toBe('skipped');
    expect(second.detail).toMatch(/already matches/);
  });

  it('skips differing content when --skip-existing is set', async () => {
    const filePath = path.join(cwd, 'zprog_skip.prog.json');
    await writePullFile({ filePath, content: JSON.stringify({ formatVersion: '1', header: { description: 'a', originalLanguage: 'EN' } }) });
    const result = await writePullFile({
      filePath,
      content: JSON.stringify({ formatVersion: '1', header: { description: 'b', originalLanguage: 'EN' } }),
      skipExisting: true,
    });
    expect(result.status).toBe('skipped');
    expect(result.detail).toMatch(/skip-existing/);
  });

  it('throws OVERWRITE_REQUIRED when differing content and no flags', async () => {
    const filePath = path.join(cwd, 'zprog_required.prog.json');
    await writePullFile({ filePath, content: JSON.stringify({ formatVersion: '1', header: { description: 'a', originalLanguage: 'EN' } }) });
    await expect(writePullFile({
      filePath,
      content: JSON.stringify({ formatVersion: '1', header: { description: 'b', originalLanguage: 'EN' } }),
    })).rejects.toBeInstanceOf(CliError);
    await expect(writePullFile({
      filePath,
      content: JSON.stringify({ formatVersion: '1', header: { description: 'b', originalLanguage: 'EN' } }),
    })).rejects.toMatchObject({ code: 'OVERWRITE_REQUIRED' });
  });

  it('overwrites differing content when --overwrite is set', async () => {
    const filePath = path.join(cwd, 'zprog_overwrite.prog.json');
    await writePullFile({ filePath, content: JSON.stringify({ formatVersion: '1', header: { description: 'a', originalLanguage: 'EN' } }) });
    const newContent = JSON.stringify({ formatVersion: '1', header: { description: 'b', originalLanguage: 'EN' } });
    const result = await writePullFile({ filePath, content: newContent, overwrite: true });
    expect(result.status).toBe('written');
    const written = await fs.readFile(filePath, 'utf-8');
    expect(written).toBe(newContent);
  });

  it('does not validate non-metadata files (.abap, .txt)', async () => {
    const filePath = path.join(cwd, 'zprog_main.prog.abap');
    const content = 'REPORT zprog_main.\nWRITE: / hello.';
    const result = await writePullFile({ filePath, content });
    expect(result.status).toBe('written');
  });
});
