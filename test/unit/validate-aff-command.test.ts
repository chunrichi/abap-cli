import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { runValidateAff } from '../../src/abap_cli/commands/validate-aff.js';

/**
 * Flow-level behaviour of `runValidateAff` (schema routing + companion checks).
 * The unified envelope / exit-code / path contract is covered by
 * `validate-aff-contract.test.ts`.
 */

const TMP = path.join(process.cwd(), 'tmp', '_validate-aff-test');

function mkDir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}
function writeJson(p: string, doc: unknown): void {
  fs.writeFileSync(p, JSON.stringify(doc));
}
function clean(): void {
  fs.rmSync(TMP, { recursive: true, force: true });
}

const GOOD_DOMA = {
  formatVersion: '1',
  header: { description: 'ok', originalLanguage: 'EN' },
  format: { dataType: 'CHAR', length: 3 },
  outputCharacteristics: { length: 3 },
};

describe('validate-aff flow', () => {
  beforeEach(() => {
    clean();
    mkDir(TMP);
  });
  afterEach(clean);

  it('passes a single compliant DOMA fixture', async () => {
    const f = path.join(TMP, 'foo.doma.json');
    writeJson(f, GOOD_DOMA);
    const result = await runValidateAff([f]);
    expect(result.failure).toBeUndefined();
    expect(result.data.summary).toEqual({ pass: 1, warn: 0, fail: 0 });
  });

  it('fails a DOMA fixture missing formatVersion', async () => {
    const f = path.join(TMP, 'bad.doma.json');
    writeJson(f, {
      header: { description: 'x', originalLanguage: 'EN' },
      format: { dataType: 'CHAR', length: 3 },
      outputCharacteristics: { length: 3 },
    });
    const result = await runValidateAff([f]);
    expect(result.failure?.code).toBe('VALIDATION_ERROR');
    expect(result.data.summary.fail).toBe(1);
  });

  it('fails when a TABL .json has no companion .ddic', async () => {
    const f = path.join(TMP, 'zmy.tabl.json');
    writeJson(f, {
      formatVersion: '1',
      header: { description: 'x', originalLanguage: 'EN' },
    });
    const result = await runValidateAff([f]);
    expect(result.failure?.code).toBe('VALIDATION_ERROR');
    expect(result.data.files[0]?.missingCompanions).toContain('zmy.tabl.ddic');
  });

  it('TABL .settings.json missing is OK (optional) when the ddl companion is present', async () => {
    const f = path.join(TMP, 'zmy.tabl.json');
    writeJson(f, {
      formatVersion: '1',
      header: { description: 'x', originalLanguage: 'EN' },
    });
    fs.writeFileSync(path.join(TMP, 'zmy.tabl.ddic'), 'define table zmy { key mandt : abap.clnt; }');
    const result = await runValidateAff([f]);
    expect(result.failure).toBeUndefined();
    expect(result.data.files[0]?.optionalCompanions).toContain('zmy.tabl.settings.json');
  });

  it('CLAS include files are optional: main source is enough', async () => {
    const f = path.join(TMP, 'zmy_class.clas.json');
    writeJson(f, {
      formatVersion: '1',
      header: { description: 'x', originalLanguage: 'EN' },
    });
    fs.writeFileSync(path.join(TMP, 'zmy_class.clas.abap'), 'CLASS zmy_class DEFINITION PUBLIC.\nENDCLASS.');
    const result = await runValidateAff([f]);
    expect(result.failure).toBeUndefined();
    expect(result.data.files[0]?.status).toBe('pass');
  });

  it('CLAS without the main source reports the structural missing companion', async () => {
    const f = path.join(TMP, 'zmy_class.clas.json');
    writeJson(f, {
      formatVersion: '1',
      header: { description: 'x', originalLanguage: 'EN' },
    });
    const result = await runValidateAff([f]);
    expect(result.failure?.code).toBe('VALIDATION_ERROR');
    expect(result.data.files[0]?.missingCompanions).toContain('zmy_class.clas.abap');
  });

  it('STRU settings missing is OK (optional) when the ddl companion is present', async () => {
    const f = path.join(TMP, 'zmy.stru.json');
    writeJson(f, {
      formatVersion: '1',
      header: { description: 'x', originalLanguage: 'EN' },
    });
    fs.writeFileSync(path.join(TMP, 'zmy.stru.ddic'), 'define structure zmy { field : abap.char; }');
    const result = await runValidateAff([f]);
    expect(result.failure).toBeUndefined();
    expect(result.data.files[0]?.optionalCompanions).toContain('zmy.stru.settings.json');
  });

  it('scans a directory recursively and counts every AFF JSON', async () => {
    const a = path.join(TMP, 'a');
    const b = path.join(TMP, 'sub', 'b');
    mkDir(a);
    mkDir(b);
    writeJson(path.join(a, 'one.doma.json'), GOOD_DOMA);
    writeJson(path.join(b, 'two.doma.json'), {
      header: { description: 'bad', originalLanguage: 'EN' },
      format: { dataType: 'CHAR', length: 3 },
      outputCharacteristics: { length: 3 },
    });
    const result = await runValidateAff([TMP]);
    expect(result.failure?.code).toBe('VALIDATION_ERROR');
    expect(result.data.summary).toEqual({ pass: 1, warn: 0, fail: 1 });
  });

  it('skips files that are not routed to an AFF schema', async () => {
    const f = path.join(TMP, 'notes.json');
    writeJson(f, { arbitrary: true });
    const result = await runValidateAff([f]);
    expect(result.failure).toBeUndefined();
    expect(result.data.files).toEqual([]);
    expect(result.data.summary).toEqual({ pass: 0, warn: 0, fail: 0 });
  });
});
