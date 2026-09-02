/**
 * 032 US9: DOMA `signFlag` / `lowercase` / `convExit` round-trip.
 *
 * Wire shape (SAP-style, ICF /ddic/doma):
 *   `{ signFlag: 'X', lowercase: '', convExit: 'ALPHA' }` — strings, 'X' for
 *   "on", '' (empty string) for "off / not set". Empty string is valid
 *   and must be preserved (AC2).
 *
 * Local shape (abap-file-format, `doma-v1.json` nested):
 *   `{ format: { signFlag, lowercase, convExit } }` — same string values,
 *   nested under `format` per the abap-file-format `format: object` schema.
 *
 * Top-level flat local fields are accepted as a legacy fallback (no
 * `format` object) so callers migrating existing scripts don't break.
 *
 * Real-SAP validation note: T040 spec calls for "mock + 真实 SAP 各 1 个含
 * signFlag/lowercase/convExit 的 domain". The real-SAP case is deferred to
 * Phase 5 (vhcala4hci:50000 currently unreachable); mock coverage here
 * exercises the same wire shape SAP will send.
 */
import { describe, it, expect } from 'vitest';
import { localToWire, wireToLocal } from '../../src/abap_cli/formats/ddic/json.js';

describe('032/doma-format-flags', () => {
  describe('wireToLocal (AC1, AC2, AC3)', () => {
    it('maps wire signFlag "X" → local format.signFlag "X"', () => {
      const local = wireToLocal('DOMA', {
        name: 'ZD_QUAN',
        description: 'QUAN with sign',
        dataType: 'QUAN',
        length: 13,
        decimals: 3,
        signFlag: 'X',
        lowercase: '',
        convExit: 'ALPHA',
      });
      expect((local as Record<string, unknown>).format).toEqual({
        signFlag: 'X',
        lowercase: '',
        convExit: 'ALPHA',
      });
    });

    it('preserves empty string for lowercase (AC2)', () => {
      const local = wireToLocal('DOMA', {
        name: 'ZD_CHAR',
        description: 'CHAR domain',
        dataType: 'CHAR',
        length: 10,
        signFlag: '',
        lowercase: '',
        convExit: '',
      });
      const format = (local as Record<string, unknown>).format as Record<string, unknown>;
      expect(format.signFlag).toBe('');
      expect(format.lowercase).toBe('');
      expect(format.convExit).toBe('');
    });

    it('preserves non-empty convExit (AC3)', () => {
      const local = wireToLocal('DOMA', {
        name: 'ZD_ALPHA',
        description: 'CHAR with conversion exit',
        dataType: 'CHAR',
        length: 10,
        signFlag: '',
        lowercase: '',
        convExit: 'ALPHA',
      });
      const format = (local as Record<string, unknown>).format as Record<string, unknown>;
      expect(format.convExit).toBe('ALPHA');
    });

    it('omits format object when none of the three wire fields are present', () => {
      const local = wireToLocal('DOMA', {
        name: 'ZD_PLAIN',
        description: 'Plain domain',
        dataType: 'CHAR',
        length: 10,
      });
      expect((local as Record<string, unknown>).format).toBeUndefined();
    });

    it('emits format object even when only one of the three is present', () => {
      const local = wireToLocal('DOMA', {
        name: 'ZD_ONE',
        description: 'Only convExit',
        dataType: 'CHAR',
        length: 10,
        convExit: 'ALPHA',
      });
      expect((local as Record<string, unknown>).format).toEqual({ convExit: 'ALPHA' });
    });
  });

  describe('localToWire (AC4 — push passthrough)', () => {
    it('maps local nested format → wire (push passthrough)', () => {
      const wire = localToWire('DOMA', {
        name: 'ZD',
        description: 'Domain',
        dataType: 'QUAN',
        length: 13,
        decimals: 3,
        format: { signFlag: 'X', lowercase: '', convExit: 'ALPHA' },
      });
      expect(wire.signFlag).toBe('X');
      expect(wire.lowercase).toBe('');
      expect(wire.convExit).toBe('ALPHA');
    });

    it('accepts top-level flat local fields (legacy fallback)', () => {
      // 032 US9: legacy top-level flat fields still accepted — value is
      // coerced via String() so 'X' and '' round-trip.
      const wire = localToWire('DOMA', {
        name: 'ZD',
        description: 'Legacy flat',
        dataType: 'CHAR',
        length: 10,
        signFlag: 'X',
        lowercase: '',
        convExit: 'ALPHA',
      });
      expect(wire.signFlag).toBe('X');
      expect(wire.lowercase).toBe('');
      expect(wire.convExit).toBe('ALPHA');
    });

    it('preserves empty strings when nested', () => {
      const wire = localToWire('DOMA', {
        name: 'ZD',
        description: 'All empty',
        dataType: 'CHAR',
        length: 10,
        format: { signFlag: '', lowercase: '', convExit: '' },
      });
      expect(wire.signFlag).toBe('');
      expect(wire.lowercase).toBe('');
      expect(wire.convExit).toBe('');
    });
  });

  describe('round-trip (nested format.*)', () => {
    it('localToWire → wireToLocal preserves signFlag/lowercase/convExit', () => {
      const src = {
        name: 'ZD_RT',
        description: 'Round trip',
        dataType: 'QUAN',
        length: 13,
        decimals: 3,
        format: { signFlag: 'X', lowercase: '', convExit: 'ALPHA' },
      };
      const back = wireToLocal('DOMA', localToWire('DOMA', src));
      expect(back).toEqual({
        ...src,
        package: undefined,
        transportRequest: undefined,
      });
    });

    it('round-trip preserves empty strings exactly', () => {
      const src = {
        name: 'ZD_RT_EMPTY',
        description: 'All empty',
        dataType: 'CHAR',
        length: 10,
        format: { signFlag: '', lowercase: '', convExit: '' },
      };
      const back = wireToLocal('DOMA', localToWire('DOMA', src));
      const format = (back as Record<string, unknown>).format as Record<string, unknown>;
      expect(format.signFlag).toBe('');
      expect(format.lowercase).toBe('');
      expect(format.convExit).toBe('');
    });
  });

  describe('mixed-style scenarios', () => {
    it('QUAN with signFlag "X" + lowercase "" (typical case)', () => {
      const wire = {
        name: 'ZD_AMOUNT',
        description: 'Currency/quantity amount',
        dataType: 'QUAN',
        length: 13,
        decimals: 3,
        signFlag: 'X',
        lowercase: '',
        convExit: '',
      };
      const local = wireToLocal('DOMA', wire);
      expect((local as Record<string, unknown>).format).toEqual({
        signFlag: 'X',
        lowercase: '',
        convExit: '',
      });
      // Push back through
      const pushed = localToWire('DOMA', local);
      expect(pushed.signFlag).toBe('X');
      expect(pushed.lowercase).toBe('');
      expect(pushed.convExit).toBe('');
    });

    it('CHAR with convExit "ALPHA" + signFlag/lowercase empty (typical case)', () => {
      const wire = {
        name: 'ZD_ALPHA',
        description: 'Alpha-converted character',
        dataType: 'CHAR',
        length: 10,
        signFlag: '',
        lowercase: '',
        convExit: 'ALPHA',
      };
      const local = wireToLocal('DOMA', wire);
      expect((local as Record<string, unknown>).format).toEqual({
        signFlag: '',
        lowercase: '',
        convExit: 'ALPHA',
      });
    });

    it('CHAR with lowercase "X" + signFlag empty (lowercase on)', () => {
      const wire = {
        name: 'ZD_LC',
        description: 'Lowercase on',
        dataType: 'CHAR',
        length: 10,
        signFlag: '',
        lowercase: 'X',
        convExit: '',
      };
      const local = wireToLocal('DOMA', wire);
      const format = (local as Record<string, unknown>).format as Record<string, unknown>;
      expect(format.lowercase).toBe('X');
      expect(format.signFlag).toBe('');
      expect(format.convExit).toBe('');
    });
  });
});