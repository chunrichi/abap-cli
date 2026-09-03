import { describe, it, expect } from 'vitest';
import { expectSchemaPass, readJsonFixture } from './_helpers.js';
import { validateAff } from '../../../src/abap_cli/aff/schema-validator.js';
import { localToWire, wireToLocal } from '../../../src/abap_cli/formats/ddic/json.js';

const five = [
  'doma/zdmy_no_fixed.doma.json',
  'doma/zdmy_single_fixed.doma.json',
  'doma/zdmy_multi_lang_fixed.doma.json',
  'doma/zdmy_sign_flag.doma.json',
  'doma/zdmy_conv_exit.doma.json',
];

describe('schema-compliance / doma (T033-020)', () => {
  for (const rel of five) {
    it(`${rel} passes AFF schema`, async () => {
      await expectSchemaPass(rel, 'DOMA');
    });
  }

  it('a DOMA missing required `format` fails', async () => {
    // AFF doma-v1.json requires formatVersion + header + format.
    // `outputCharacteristics` is optional. Drop `format` to exercise the gate.
    const doc = {
      formatVersion: '1',
      header: { description: 'no format block', originalLanguage: 'EN' },
      outputCharacteristics: { length: 3 },
    };
    const r = await validateAff('DOMA', doc);
    expect(r.status).toBe('fail');
    expect(r.errors.some((e) => e.keyword === 'required' && e.message.includes('format'))).toBe(true);
  });

  it('DOMA wire carries `format.{dataType,length}` (nested) and `outputCharacteristics.{style,length,conversionRoutine}`', async () => {
    const local = await readJsonFixture('doma/zdmy_sign_flag.doma.json');
    const wire = localToWire('DOMA', local as any);
    // Sign-handling goes into outputCharacteristics.style in AFF (no signFlag at top or under format).
    expect((wire as any).signFlag).toBeUndefined();
    expect((wire as any).format?.signFlag).toBeUndefined();
    expect((wire as any).format?.dataType).toBe('DEC');
    expect((wire as any).outputCharacteristics?.style).toBe('signRight');
    const back = wireToLocal('DOMA', wire);
    expect((back as any).outputCharacteristics.style).toBe('signRight');
  });

  it('DOMA conversion routine round-trips through outputCharacteristics.conversionRoutine', async () => {
    const local = await readJsonFixture('doma/zdmy_conv_exit.doma.json');
    const wire = localToWire('DOMA', local as any);
    expect((wire as any).outputCharacteristics?.conversionRoutine).toBe('ALPHA');
    expect((wire as any).convExit).toBeUndefined();
    const back = wireToLocal('DOMA', wire);
    expect((back as any).outputCharacteristics.conversionRoutine).toBe('ALPHA');
  });

  it('DOMA wire preserves fixedValues with plain string description', async () => {
    const local = await readJsonFixture('doma/zdmy_multi_lang_fixed.doma.json');
    const wire = localToWire('DOMA', local as any);
    expect((wire as any).fixedValues?.length).toBe(2);
    expect((wire as any).fixedValues[0].description).toBe('Active');
    const back = wireToLocal('DOMA', wire);
    expect((back as any).fixedValues[0].description).toBe('Active');
    expect((back as any).fixedValues[1].fixedValue).toBe('I');
  });

  it('DOMA wire has no top-level dataType after the rewrite (must be under format)', async () => {
    const local = await readJsonFixture('doma/zdmy_no_fixed.doma.json');
    const wire = localToWire('DOMA', local as any);
    expect((wire as any).dataType).toBeUndefined();
    expect((wire as any).format?.dataType).toBe('CHAR');
    expect((wire as any).format?.length).toBe(3);
  });
});
