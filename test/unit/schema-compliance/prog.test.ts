import { describe, it, expect } from 'vitest';
import { expectSchemaPass } from './_helpers.js';
import { validateAff } from '../../../src/abap_cli/aff/schema-validator.js';

describe('schema-compliance / prog (T033-049)', () => {
  it('zaff_example.prog.json passes prog-v1.json (handcrafted — upstream has no example)', async () => {
    await expectSchemaPass('prog/zaff_example.prog.json', 'PROG');
  });

  it('PROG rejects an additional top-level field (additionalProperties: false)', async () => {
    const r = await validateAff('PROG', {
      formatVersion: '1',
      header: { description: 'extra', originalLanguage: 'EN' },
      surprise: 'oops',
    });
    expect(r.status).toBe('fail');
    expect(r.errors.some((e) => e.keyword === 'additionalProperties')).toBe(true);
  });
});