import { describe, it, expect } from 'vitest';
import { expectSchemaPass, readJsonFixture } from './_helpers.js';
import { validateAff } from '../../../src/abap_cli/aff/schema-validator.js';

const fugrFiles = [
  'fugr/zmy_group.fugr.json',
  'fugr/zmy_group.fugr.lzmy_grouptop.reps.json',
  'fugr/zmy_group.fugr.saplzmy_group.reps.json',
  'fugr/zmy_group.fugr.zfm_first.func.json',
  'fugr/zmy_group.fugr.zfm_second.func.json',
];

describe('schema-compliance / fugr (T033-042)', () => {
  for (const rel of fugrFiles) {
    it(`${rel} passes fugr-v1.json`, async () => {
      await expectSchemaPass(rel, 'FUGR');
    });
  }

  it('FUGR fixPointArithmetic is a boolean (true)', async () => {
    const r = await validateAff('FUGR', {
      formatVersion: '1',
      header: { description: 'arith true', originalLanguage: 'EN' },
      fixPointArithmetic: true,
    });
    expect(r.status).toBe('pass');
  });

  it('FUGR fixPointArithmetic absent is required by AFF schema (mock must supply a default)', async () => {
    // The upstream AFF schema marks `fixPointArithmetic` as required. The CLI
    // mock layer defaults it to `false` when SAP doesn't return one
    // (`formats/pull-fugr.ts`); the AFF canonical fixture is the post-default
    // shape so this case fails at the schema gate.
    const r = await validateAff('FUGR', {
      formatVersion: '1',
      header: { description: 'arith absent', originalLanguage: 'EN' },
    });
    expect(r.status).toBe('fail');
    expect(r.errors.some((e) => e.keyword === 'required' && e.message.includes('fixPointArithmetic'))).toBe(true);
  });

  it('FUGR with header.description > 40 chars fails', async () => {
    const r = await validateAff('FUGR', {
      formatVersion: '1',
      header: {
        description: 'this description is way longer than the schema max length of forty',
        originalLanguage: 'EN',
      },
    });
    expect(r.status).toBe('fail');
    expect(r.errors.some((e) => e.keyword === 'maxLength')).toBe(true);
  });
});