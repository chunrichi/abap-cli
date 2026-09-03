import { describe, it, expect } from 'vitest';
import { readJsonFixture } from './_helpers.js';
import { validateAff } from '../../../src/abap_cli/aff/schema-validator.js';

const fivePieces = [
  'tabl/zmy_basic',
  'tabl/zmy_key_compound',
  'tabl/zmy_include',
  'tabl/zmy_foreign_key',
  'tabl/zmy_client_handling',
];

describe('schema-compliance / tabl (T033-029)', () => {
  for (const base of fivePieces) {
    it(`${base}.tabl.json passes tabl-v1.json`, async () => {
      const doc = await readJsonFixture(`${base}.tabl.json`);
      const r = await validateAff('TABL', doc);
      expect(r.status, `errors: ${JSON.stringify(r.errors)}`).toBe('pass');
    });
    it(`${base}.tabl.settings.json passes tabt-v1.json`, async () => {
      const doc = await readJsonFixture(`${base}.tabl.settings.json`);
      const r = await validateAff('TABL', doc, 'tabt-v1.json');
      expect(r.status, `errors: ${JSON.stringify(r.errors)}`).toBe('pass');
    });
  }

  it('TABL main JSON without formatVersion fails', async () => {
    const r = await validateAff('TABL', { header: { description: 'no version', originalLanguage: 'EN' } });
    expect(r.status).toBe('fail');
    expect(r.errors.some((e) => e.keyword === 'required' && e.message.includes('formatVersion'))).toBe(true);
  });

  it('TABL settings.json without generalInformation fails', async () => {
    const r = await validateAff('TABL', { formatVersion: '1' }, 'tabt-v1.json');
    expect(r.status).toBe('fail');
    expect(r.errors.some((e) => e.keyword === 'required' && e.message.includes('generalInformation'))).toBe(true);
  });
});