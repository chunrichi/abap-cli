/**
 * 033 US12 (replaces 032 US9): DOMA `signFlag` / `lowercase` / `convExit`
 * round-trip via AFF nested wire.
 *
 * Wire shape (AFF canonical):
 *   `{ format: { signFlag, lowercase, convExit } }` — strings, 'X' for "on",
 *   '' (empty string) for "off / not set". Empty string is valid and must be
 *   preserved.
 *
 * Local shape mirrors AFF: `{ format: { signFlag, lowercase, convExit } }`.
 */
import { describe, it, expect } from 'vitest';
import { localToWire, wireToLocal } from '../../src/abap_cli/formats/ddic/json.js';

describe('033/doma-format-flags (AFF nested)', () => {
  describe('wireToLocal', () => {
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

  describe('localToWire (push passthrough)', () => {
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

  describe('round-trip (nested format.*)', () => {
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

  describe('mixed-style scenarios', () => {
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