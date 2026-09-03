import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'node:path';
import {
  loadSchema,
  validateAff,
  validateFile,
  formatLine,
  resetSchemaCache,
} from '../../src/abap_cli/aff/schema-validator.js';

const MIRROR = path.join(process.cwd(), 'tmp', 'abap-file-formats', 'file-formats');

describe('schema-validator (T033-002)', () => {
  beforeAll(() => {
    resetSchemaCache();
  });

  it('loadSchema returns the parsed JSON for a known type', async () => {
    const schema = await loadSchema('DOMA');
    expect(schema).toBeTypeOf('object');
    expect((schema as { title?: string }).title).toBeTruthy();
  });

  it('loadSchema is cached (second call hits cache)', async () => {
    const s1 = await loadSchema('DOMA');
    const s2 = await loadSchema('DOMA');
    expect(s1).toBe(s2);
  });

  it('loadSchema throws for an unknown type', async () => {
    await expect(loadSchema('ZZZZ')).rejects.toThrow(/No AFF schema mapping/);
  });

  it('validateAff accepts a minimal DOMA fixture (no-fixed)', async () => {
    const doc = {
      formatVersion: '1',
      header: { description: 'no fixed', originalLanguage: 'EN' },
      format: { dataType: 'CHAR', length: 3 },
      outputCharacteristics: { length: 3 },
    };
    const result = await validateAff('DOMA', doc);
    expect(result.status).toBe('pass');
    expect(result.errors).toEqual([]);
  });

  it('validateAff rejects missing formatVersion', async () => {
    const doc = {
      header: { description: 'x', originalLanguage: 'EN' },
      format: { dataType: 'CHAR', length: 3 },
      outputCharacteristics: { length: 3 },
    };
    const result = await validateAff('DOMA', doc);
    expect(result.status).toBe('fail');
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('validateAff detects extra top-level fields (DOMA strict → extra is rejected by ajv, but extras[] still populated)', async () => {
    const doc = {
      formatVersion: '1',
      header: { description: 'extra', originalLanguage: 'EN' },
      format: { dataType: 'CHAR', length: 3 },
      outputCharacteristics: { length: 3 },
      unknownField: 'oops',
    };
    const result = await validateAff('DOMA', doc);
    // DOMA schema sets additionalProperties:false → ajv flags the extra key
    // as a hard failure (expected behaviour). Our extras[] helper still
    // surfaces the offending keys regardless of the schema disposition.
    expect(result.extraFields).toContain('unknownField');
    expect(result.status).toBe('fail');
    expect(result.errors.some((e) => e.keyword === 'additionalProperties')).toBe(true);
  });

  it('validateFile reads from disk and reports FAIL', async () => {
    const file = path.join(process.cwd(), 'test/fixtures/_negative/aff/missing-formatVersion.doma.json');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(
      file,
      JSON.stringify({
        header: { description: 'x', originalLanguage: 'EN' },
        format: { dataType: 'CHAR', length: 3 },
        outputCharacteristics: { length: 3 },
      }),
    );
    const r = await validateFile(file, 'DOMA');
    expect(r.status).toBe('fail');
    expect(r.filePath).toBe(file);

    // Cleanup
    const { unlinkSync } = await import('node:fs');
    unlinkSync(file);
  });

  it('formatLine emits PASS / FAIL / WARN shapes', async () => {
    const okLine = formatLine({
      type: 'DOMA',
      filePath: 'p.json',
      status: 'pass',
      errors: [],
    });
    expect(okLine).toBe('PASS p.json');

    const failLine = formatLine({
      type: 'DOMA',
      filePath: 'p.json',
      status: 'fail',
      errors: [
        { instancePath: '', schemaPath: '#/', keyword: 'required', message: 'must have required property formatVersion' },
      ],
    });
    expect(failLine).toContain('FAIL p.json');
    expect(failLine).toContain('required');

    const warnLine = formatLine({
      type: 'DOMA',
      filePath: 'p.json',
      status: 'warn',
      errors: [],
      extraFields: ['unknown'],
    });
    expect(warnLine).toContain('WARN p.json');
    expect(warnLine).toContain('unknown');
  });
});
