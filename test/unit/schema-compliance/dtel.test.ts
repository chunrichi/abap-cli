import { describe, it, expect } from 'vitest';
import { expectSchemaPass, readJsonFixture } from './_helpers.js';
import { validateAff } from '../../../src/abap_cli/aff/schema-validator.js';
import { localToWire, wireToLocal } from '../../../src/abap_cli/formats/ddic/json.js';

const three = [
  'dtel/zdm_domain_ref.dtel.json',
  'dtel/zdm_predefined_type.dtel.json',
  'dtel/zdm_type_ref.dtel.json',
];

describe('schema-compliance / dtel (T033-025)', () => {
  for (const rel of three) {
    it(`${rel} passes AFF schema`, async () => {
      await expectSchemaPass(rel, 'DTEL');
    });
  }

  it('DTEL dataTypeInformation is required (category at minimum)', async () => {
    const doc = {
      formatVersion: '1',
      header: { description: 'no DTI', originalLanguage: 'EN' },
    };
    const r = await validateAff('DTEL', doc);
    expect(r.status).toBe('fail');
    expect(r.errors.some((e) => e.keyword === 'required' && e.message.includes('dataTypeInformation'))).toBe(true);
  });

  it('DTEL wire round-trips the three AFF categories through dataTypeInformation', async () => {
    for (const rel of three) {
      const local = await readJsonFixture(rel);
      const wire = localToWire('DTEL', local as any);
      expect((wire as any).dataTypeInformation).toBeDefined();
      const back = wireToLocal('DTEL', wire);
      // local still carries dataTypeInformation under the same category (or its alias mapping).
      const lDti = (back as any).dataTypeInformation;
      expect(lDti).toBeDefined();
    }
  });
});