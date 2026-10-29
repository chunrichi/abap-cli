import { describe, it, expect } from 'vitest';
import { readJsonFixture } from './_helpers.js';
import { validateAff } from '../../../src/abap_cli/aff/schema-validator.js';

describe('schema-compliance / stru (T033-033)', () => {
  it('zmy_stru.stru.json passes tabl-v1.json (schema alias)', async () => {
    const doc = await readJsonFixture('stru/zmy_stru.stru.json');
    const r = await validateAff('STRU', doc);
    expect(r.status, `errors: ${JSON.stringify(r.errors)}`).toBe('pass');
  });

  it('zmy_stru.stru.settings.json passes tabt-v1.json', async () => {
    const doc = await readJsonFixture('stru/zmy_stru.stru.settings.json');
    const r = await validateAff('STRU', doc, 'tabt-v1.json');
    expect(r.status, `errors: ${JSON.stringify(r.errors)}`).toBe('pass');
  });

  it('zmy_stru_no_settings.stru.json passes (settings optional)', async () => {
    const doc = await readJsonFixture('stru/zmy_stru_no_settings.stru.json');
    const r = await validateAff('STRU', doc);
    expect(r.status, `errors: ${JSON.stringify(r.errors)}`).toBe('pass');
  });

  it('STRU without header fails', async () => {
    const r = await validateAff('STRU', { formatVersion: '1' });
    expect(r.status).toBe('fail');
    expect(r.errors.some((e) => e.keyword === 'required' && e.message.includes('header'))).toBe(true);
  });
});