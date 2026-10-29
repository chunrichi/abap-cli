import { describe, it, expect } from 'vitest';
import { expectSchemaPass, expectSchemaFail, readJsonFixture, fx } from './_helpers.js';
import { validateAff } from '../../../src/abap_cli/aff/schema-validator.js';

describe('schema-compliance / clas (T033-014)', () => {
  it('upstream example z_aff_example_clas.clas.json passes', async () => {
    await expectSchemaPass('clas/z_aff_example_clas.clas.json');
  });

  it('an invalid CLAS fixture (missing formatVersion) fails with required error', async () => {
    await expectSchemaFail(
      'CLAS',
      {
        header: { description: 'no version', originalLanguage: 'EN' },
      },
      /required: must have required property 'formatVersion'/i,
    );
  });

  it('header.description longer than 60 chars fails', async () => {
    await expectSchemaFail(
      'CLAS',
      {
        formatVersion: '1',
        header: { description: 'x'.repeat(61), originalLanguage: 'EN' },
      },
      /maxLength/i,
    );
  });

  it('companion abap files exist alongside the json', async () => {
    const doc = await readJsonFixture('clas/z_aff_example_clas.clas.json');
    expect(doc).toBeTruthy();
    const dir = fx('clas');
    for (const part of ['definitions', 'implementations', 'macros', 'testclasses']) {
      expect(
        await fs_exists(`${dir}/z_aff_example_clas.clas.${part}.abap`),
        `missing companion clas.${part}.abap`,
      ).toBeTruthy();
    }
  });
});

async function fs_exists(p: string): Promise<boolean> {
  const { stat } = await import('node:fs/promises');
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

// Sanity check that the wire-shape fixture in CLAS doesn't include extra
// top-level keys (which would trip ajv's strict addtl-prop check).
describe('schema-compliance / clas invariants', () => {
  it('upstream CLAS example has no undefined top-level keys', async () => {
    const r = await validateAff('CLAS', await readJsonFixture('clas/z_aff_example_clas.clas.json'));
    expect(r.errors.length).toBe(0);
  });
});
