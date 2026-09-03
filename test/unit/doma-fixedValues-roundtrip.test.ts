import { describe, it, expect } from 'vitest';
import { localToWire, wireToLocal } from '../../src/abap_cli/formats/ddic/json.js';
import type { DdicObject } from '../../src/abap_cli/formats/ddic/json.js';

describe('032 P0: DOMA fixedValues bidirectional round-trip', () => {
  it('omits fixedValues on wire when local array is empty (no fixed values)', () => {
    const local: DdicObject = {
      name: 'ZDMY_TEST',
      description: 'Empty domain',
      dataType: 'CHAR',
      length: 10,
      fixedValues: [],
    };
    const wire = localToWire('DOMA', local);
    expect(wire.fixedValues).toBeUndefined();
  });

  it('round-trips a single fixed value with language-independent description', () => {
    const local: DdicObject = {
      name: 'ZDMY_TEST',
      description: 'Single value',
      dataType: 'CHAR',
      length: 1,
      fixedValues: [{ fixedValue: 'A', description: { languageIndependent: 'Alpha' } }],
    };
    const wire = localToWire('DOMA', local);
    expect(wire.fixedValues).toEqual([
      { fixedValue: 'A', fixedValueLong: { languageIndependent: 'Alpha' } },
    ]);
    const back = wireToLocal('DOMA', wire);
    expect((back as Record<string, unknown>).fixedValues).toEqual([
      { fixedValue: 'A', description: { languageIndependent: 'Alpha' } },
    ]);
  });

  it('round-trips multi-language fixed values (English + German)', () => {
    const local: DdicObject = {
      name: 'ZDMY_LANG',
      dataType: 'CHAR',
      length: 1,
      fixedValues: [
        {
          fixedValue: 'A',
          description: {
            languageIndependent: 'Alpha',
            languageDependent: [
              { language: 'EN', description: 'Alpha English' },
              { language: 'DE', description: 'Alpha German' },
            ],
          },
        },
        {
          fixedValue: 'B',
          description: {
            languageIndependent: 'Bravo',
          },
        },
      ],
    };
    const wire = localToWire('DOMA', local);
    expect(wire.fixedValues).toHaveLength(2);
    expect(wire.fixedValues?.[0]?.fixedValue).toBe('A');
    expect(wire.fixedValues?.[0]?.fixedValueLong?.languageDependent).toEqual([
      { language: 'EN', description: 'Alpha English' },
      { language: 'DE', description: 'Alpha German' },
    ]);
    const back = wireToLocal('DOMA', wire);
    const fv = (back as Record<string, unknown>).fixedValues as Array<Record<string, unknown>>;
    expect(fv).toHaveLength(2);
    expect(fv[0]?.description).toEqual({
      languageIndependent: 'Alpha',
      languageDependent: [
        { language: 'EN', description: 'Alpha English' },
        { language: 'DE', description: 'Alpha German' },
      ],
    });
  });

  it('round-trips special characters (quotes / backslashes / unicode)', () => {
    const local: DdicObject = {
      name: 'ZDMY_SPEC',
      dataType: 'CHAR',
      length: 10,
      fixedValues: [
        {
          fixedValue: '"Q"',
          description: {
            languageIndependent: 'with "quotes" and \\ backslash',
            languageDependent: [{ language: 'ZH', description: '中文描述 ✓' }],
          },
        },
      ],
    };
    const wire = localToWire('DOMA', local);
    const back = wireToLocal('DOMA', wire);
    const fv = (back as Record<string, unknown>).fixedValues as Array<Record<string, unknown>>;
    expect(fv[0]?.fixedValue).toBe('"Q"');
    const desc = fv[0]?.description as Record<string, unknown>;
    expect(desc.languageIndependent).toBe('with "quotes" and \\ backslash');
    expect(desc.languageDependent).toEqual([{ language: 'ZH', description: '中文描述 ✓' }]);
  });

  it('accepts abap-file-format nested layout (format.fixedValues)', () => {
    const local: DdicObject = {
      name: 'ZDMY_NESTED',
      dataType: 'CHAR',
      length: 1,
      format: {
        fixedValues: [{ fixedValue: 'X', description: { languageIndependent: 'X-ray' } }],
      },
    };
    const wire = localToWire('DOMA', local);
    expect(wire.fixedValues).toEqual([
      { fixedValue: 'X', fixedValueLong: { languageIndependent: 'X-ray' } },
    ]);
  });
});
