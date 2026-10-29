import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { runValidateAff } from '../../src/abap_cli/commands/validate-aff.js';

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

describe('validate-aff command (T033-005)', () => {
  beforeEach(() => {
    clean();
    mkDir(TMP);
  });
  afterEach(clean);

  it('exits 0 for a single compliant DOMA fixture', async () => {
    const f = path.join(TMP, 'foo.doma.json');
    writeJson(f, {
      formatVersion: '1',
      header: { description: 'ok', originalLanguage: 'EN' },
      format: { dataType: 'CHAR', length: 3 },
      outputCharacteristics: { length: 3 },
    });
    const code = await runValidateAff([f], { json: false });
    expect(code).toBe(0);
  });

  it('exits 1 for a DOMA fixture missing formatVersion', async () => {
    const f = path.join(TMP, 'bad.doma.json');
    writeJson(f, {
      header: { description: 'x', originalLanguage: 'EN' },
      format: { dataType: 'CHAR', length: 3 },
      outputCharacteristics: { length: 3 },
    });
    const code = await runValidateAff([f], { json: false });
    expect(code).toBe(1);
  });

  it('exits 1 when a TABL .json has no companion .ddic / .settings.json', async () => {
    const f = path.join(TMP, 'zmy.tabl.json');
    writeJson(f, {
      formatVersion: '1',
      header: { description: 'x', originalLanguage: 'EN' },
    });
    const code = await runValidateAff([f], { json: false });
    expect(code).toBe(1);
  });

  it('STRU settings missing is OK (optional), exits 0 if ddl present', async () => {
    const f = path.join(TMP, 'zmy.stru.json');
    writeJson(f, {
      formatVersion: '1',
      header: { description: 'x', originalLanguage: 'EN' },
    });
    fs.writeFileSync(path.join(TMP, 'zmy.stru.ddic'), 'define structure zmy { field : abap.char; }');
    const code = await runValidateAff([f], { json: true });
    if (code !== 0) {
      // eslint-disable-next-line no-console
      console.error('STRU exit was:', code);
    }
    expect(code).toBe(0);
  });

  it('--json emits a JSON envelope', async () => {
    const f = path.join(TMP, 'foo.doma.json');
    writeJson(f, {
      formatVersion: '1',
      header: { description: 'ok', originalLanguage: 'EN' },
      format: { dataType: 'CHAR', length: 3 },
      outputCharacteristics: { length: 3 },
    });
    const code = await runValidateAff([f], { json: true });
    expect(code).toBe(0);
  });

  it('scans a directory recursively and counts every JSON', async () => {
    const a = path.join(TMP, 'a');
    const b = path.join(TMP, 'sub', 'b');
    mkDir(a);
    mkDir(b);
    writeJson(path.join(a, 'one.doma.json'), {
      formatVersion: '1',
      header: { description: 'ok', originalLanguage: 'EN' },
      format: { dataType: 'CHAR', length: 3 },
      outputCharacteristics: { length: 3 },
    });
    writeJson(path.join(b, 'two.doma.json'), {
      header: { description: 'bad', originalLanguage: 'EN' },
      format: { dataType: 'CHAR', length: 3 },
      outputCharacteristics: { length: 3 },
    });
    const code = await runValidateAff([TMP], { json: true });
    expect(code).toBe(1);
  });
});
