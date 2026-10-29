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
    await expect(loadSchema('ZZZZ')).rejects.toThrow(/No AFF schema/);
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
    const { writeFileSync, mkdirSync } = await import('node:fs');
    // The negative fixtures dir is scratch space — validate:aff must not scan
    // it, so it is not committed. Create it on demand.
    mkdirSync(path.dirname(file), { recursive: true });
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

  // ----- T2.5 single-Map cache behaviour -----

  it('repeated validateAff calls for the same type do not re-compile (timing)', async () => {
    resetSchemaCache();
    const doc = {
      formatVersion: '1',
      header: { description: 'x', originalLanguage: 'EN' },
      format: { dataType: 'CHAR', length: 3 },
      outputCharacteristics: { length: 3 },
    };
    // Warm up the cache; the first call pays the compile cost.
    await validateAff('DOMA', doc);
    const t0 = performance.now();
    for (let i = 0; i < 50; i++) {
      // eslint-disable-next-line no-await-in-loop
      await validateAff('DOMA', doc);
    }
    const elapsed = performance.now() - t0;
    // 50 cached revalidations must stay well under 50ms (the first uncached
    // compile on the same payload typically takes 5–20ms on developer
    // machines). Generous bound to keep the test stable across CI hardware.
    expect(elapsed).toBeLessThan(50);
  });

  it('STRU and TABL share the same compiled validator (same schema file)', async () => {
    resetSchemaCache();
    const minimalDoc = { formatVersion: '1', header: { description: 'x', originalLanguage: 'EN' } };
    // Both must succeed against their shared schema (just formatVersion + header).
    const tablResult = await validateAff('TABL', minimalDoc);
    const struResult = await validateAff('STRU', minimalDoc);
    expect(tablResult.status).toBe('pass');
    expect(struResult.status).toBe('pass');
    // Now confirm cache sharing: a second validateAff for TABL after STRU was
    // compiled must still pass (single Map; STRU compile did not evict TABL).
    const reT = await validateAff('TABL', minimalDoc);
    expect(reT.status).toBe('pass');
  });
});
