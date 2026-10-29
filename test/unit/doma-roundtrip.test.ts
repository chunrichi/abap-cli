/**
 * DOMA round-trip: fixedValues (032 P0) + format.signFlag/lowercase/convExit (033 US12).
 *
 * Wire shape (AFF canonical):
 *   - `format: { signFlag, lowercase, convExit }` — strings, 'X' for "on",
 *     '' (empty string) for "off / not set". Empty string is valid and must be
 *     preserved.
 *   - `fixedValues` mirrors via `fixedValueLong` on wire.
 *
 * Local shape mirrors AFF: nested `format` and `fixedValues` blocks.
 */
import { describe, it, expect } from 'vitest';
import { localToWire, wireToLocal } from '../../src/abap_cli/formats/ddic/json.js';
import type { DdicObject } from '../../src/abap_cli/formats/ddic/json.js';

describe('DOMA round-trip', () => {
  describe('fixedValues (032 P0)', () => {
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

  describe('format flags: wireToLocal', () => {
    it('lifts wire format.signFlag "X" / lowercase "" / convExit "ALPHA" → local format.*', () => {
      const local = wireToLocal('DOMA', {
        name: 'ZD_QUAN',
        description: 'QUAN with sign',
        format: {
          dataType: 'QUAN',
          length: 13,
          decimals: 3,
          signFlag: 'X',
          lowercase: '',
          convExit: 'ALPHA',
        },
      });
      expect((local as Record<string, unknown>).format).toEqual({
        dataType: 'QUAN',
        length: 13,
        decimals: 3,
        signFlag: 'X',
        lowercase: '',
        convExit: 'ALPHA',
      });
    });

    it('preserves empty string for lowercase (AC2)', () => {
      const local = wireToLocal('DOMA', {
        name: 'ZD_CHAR',
        description: 'CHAR domain',
        format: {
          dataType: 'CHAR',
          length: 10,
          signFlag: '',
          lowercase: '',
          convExit: '',
        },
      });
      const format = (local as Record<string, unknown>).format as Record<string, unknown>;
      expect(format.lowercase).toBe('');
      expect(format.signFlag).toBe('');
    });

    it('preserves non-empty convExit (AC3)', () => {
      const local = wireToLocal('DOMA', {
        name: 'ZD_ALPHA',
        description: 'with conversion exit',
        format: {
          dataType: 'CHAR',
          length: 10,
          convExit: 'ALPHA',
        },
      });
      const format = (local as Record<string, unknown>).format as Record<string, unknown>;
      expect(format.convExit).toBe('ALPHA');
    });

    it('emits format object even when only one of the three is present', () => {
      const local = wireToLocal('DOMA', {
        name: 'ZD_S',
        description: 'sign only',
        format: { dataType: 'DEC', length: 5, signFlag: 'X' },
      });
      expect((local as Record<string, unknown>).format).toBeDefined();
    });
  });

  describe('format flags: localToWire (push passthrough)', () => {
    it('emits nested format.{signFlag,lowercase,convExit} from local', () => {
      const wire = localToWire('DOMA', {
        name: 'ZD',
        description: 'Domain',
        format: {
          dataType: 'CHAR',
          length: 10,
          signFlag: '',
          lowercase: '',
          convExit: 'ALPHA',
        },
      });
      // No flat top-level fields on the wire (AFF canonical).
      expect((wire as Record<string, unknown>).signFlag).toBeUndefined();
      expect((wire as Record<string, unknown>).lowercase).toBeUndefined();
      expect((wire as Record<string, unknown>).convExit).toBeUndefined();
      expect(wire.format?.signFlag).toBe('');
      expect(wire.format?.lowercase).toBe('');
      expect(wire.format?.convExit).toBe('ALPHA');
    });

    it('preserves empty strings when nested', () => {
      const wire = localToWire('DOMA', {
        name: 'ZD',
        description: 'Empty strings',
        format: { dataType: 'CHAR', length: 5, signFlag: '', lowercase: '', convExit: '' },
      });
      expect(wire.format?.signFlag).toBe('');
      expect(wire.format?.lowercase).toBe('');
      expect(wire.format?.convExit).toBe('');
    });
  });

  describe('format flags: round-trip', () => {
    it('localToWire → wireToLocal preserves signFlag/lowercase/convExit', () => {
      const src = {
        name: 'ZD_RT',
        description: 'round-trip',
        format: {
          dataType: 'QUAN',
          length: 13,
          decimals: 3,
          signFlag: 'X',
          lowercase: '',
          convExit: 'ALPHA',
        },
        outputCharacteristics: { length: 17 },
      };
      const back = wireToLocal('DOMA', localToWire('DOMA', src));
      expect((back as Record<string, unknown>).format).toEqual(src.format);
    });
  });

  describe('format flags: mixed-style scenarios', () => {
    it('QUAN with signFlag "X" + lowercase "" (typical case)', () => {
      const src = {
        name: 'ZD_QUAN2',
        description: 'QUAN',
        format: { dataType: 'QUAN', length: 13, decimals: 3, signFlag: 'X', lowercase: '' },
      };
      const wire = localToWire('DOMA', src);
      const back = wireToLocal('DOMA', wire);
      const format = (back as Record<string, unknown>).format as Record<string, unknown>;
      expect(format.signFlag).toBe('X');
      expect(format.lowercase).toBe('');
    });

    it('CHAR with convExit "ALPHA" + signFlag/lowercase empty (typical case)', () => {
      const src = {
        name: 'ZD_CHAR',
        description: 'CHAR with ALPHA',
        format: {
          dataType: 'CHAR',
          length: 10,
          signFlag: '',
          lowercase: '',
          convExit: 'ALPHA',
        },
      };
      const wire = localToWire('DOMA', src);
      const back = wireToLocal('DOMA', wire);
      const format = (back as Record<string, unknown>).format as Record<string, unknown>;
      expect(format.convExit).toBe('ALPHA');
      expect(format.signFlag).toBe('');
    });

    it('CHAR with lowercase "X" + signFlag empty (lowercase on)', () => {
      const src = {
        name: 'ZD_LC',
        description: 'lowercase on',
        format: {
          dataType: 'CHAR',
          length: 10,
          signFlag: '',
          lowercase: 'X',
          convExit: '',
        },
      };
      const wire = localToWire('DOMA', src);
      const back = wireToLocal('DOMA', wire);
      const format = (back as Record<string, unknown>).format as Record<string, unknown>;
      expect(format.lowercase).toBe('X');
      expect(format.signFlag).toBe('');
      expect(format.convExit).toBe('');
    });
  });
});