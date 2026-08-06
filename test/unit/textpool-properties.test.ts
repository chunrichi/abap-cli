/**
 * 014 US4: .properties parsing / serialization / validation for textpool
 * (texts / selections / headings). TDD — written before the formats/textpool.ts
 * implementation.
 */
import { describe, it, expect } from 'vitest';
import {
  parseTextpoolProperties,
  serializeTextpoolProperties,
  validateTextElements,
  TextElement,
  TextElementCategory,
} from '../../src/abap_cli/formats/textpool.js';

describe('014/textpool-properties', () => {
  describe('parseTextpoolProperties', () => {
    it('parses symbols with @MaxLength applying to the next entry (ADT reference)', () => {
      const elements = parseTextpoolProperties('texts', '@MaxLength:10\n001=Example\n002=Another\n');
      expect(elements).toEqual([
        { id: '001', text: 'Example', maxLength: 10 },
        { id: '002', text: 'Another' },
      ]);
    });

    it('parses selections with @DDICReference', () => {
      const elements = parseTextpoolProperties('selections', 'SEL1=Choice one\n@DDICReference:Z_FIELD\nSEL2=Choice two\n');
      expect(elements).toEqual([
        { id: 'SEL1', text: 'Choice one' },
        { id: 'SEL2', text: 'Choice two', ddicReference: 'Z_FIELD' },
      ]);
    });

    it('parses headings (fixed keys, no blank separator)', () => {
      const elements = parseTextpoolProperties('headings', 'LISTHEADER=Report header\nCOLUMNHEADER_1=Col 1\n');
      expect(elements).toEqual([
        { id: 'LISTHEADER', text: 'Report header' },
        { id: 'COLUMNHEADER_1', text: 'Col 1' },
      ]);
    });

    it('returns [] for empty / whitespace-only content', () => {
      expect(parseTextpoolProperties('texts', '')).toEqual([]);
      expect(parseTextpoolProperties('texts', '   \n\n')).toEqual([]);
    });

    it('ignores comment lines starting with # or !', () => {
      const elements = parseTextpoolProperties('texts', '# comment\n! another\n001=Real\n');
      expect(elements).toEqual([{ id: '001', text: 'Real' }]);
    });
  });

  describe('serializeTextpoolProperties', () => {
    it('serializes symbols with per-entry @MaxLength (ADT reference)', () => {
      const out = serializeTextpoolProperties('texts', [
        { id: '001', text: 'Example', maxLength: 10 },
        { id: '002', text: 'Another', maxLength: 10 },
      ]);
      expect(out).toBe('@MaxLength:10\n001=Example\n\n@MaxLength:10\n002=Another\n');
    });

    it('serializes symbols without trailing blank when a directive is absent', () => {
      const out = serializeTextpoolProperties('texts', [{ id: '001', text: 'Example' }]);
      expect(out).toBe('001=Example\n');
    });

    it('serializes selections with @DDICReference', () => {
      const out = serializeTextpoolProperties('selections', [
        { id: 'SEL1', text: 'Choice one' },
        { id: 'SEL2', text: 'Choice two', ddicReference: 'Z_FIELD' },
      ]);
      expect(out).toBe('SEL1=Choice one\n\n@DDICReference:Z_FIELD\nSEL2=Choice two\n');
    });

    it('serializes headings without blank separators', () => {
      const out = serializeTextpoolProperties('headings', [{ id: 'LISTHEADER', text: 'Header' }]);
      expect(out).toBe('LISTHEADER=Header');
    });
  });

  describe('validateTextElements', () => {
    const valid: TextElement[] = [{ id: '001', text: 'ok' }];
    it('accepts valid symbols (3 chars, no blanks)', () => {
      expect(() => validateTextElements(valid, 'symbols')).not.toThrow();
    });

    it('rejects symbol keys that are not 3 characters', () => {
      expect(() => validateTextElements([{ id: 'LONG', text: 'x' }], 'symbols')).toThrow(/3 characters/);
      expect(() => validateTextElements([{ id: '1', text: 'x' }], 'symbols')).toThrow(/3 characters/);
    });

    it('rejects symbol keys containing blanks', () => {
      expect(() => validateTextElements([{ id: '0 1', text: 'x' }], 'symbols')).toThrow(/must not contain blanks/);
    });

    it('rejects symbol text exceeding maxLength', () => {
      expect(() => validateTextElements([{ id: '001', text: 'very long text', maxLength: 5 }], 'symbols')).toThrow(/exceeds maxLength/);
    });

    it('rejects selections longer than 30 chars', () => {
      expect(() => validateTextElements([{ id: 'SEL1', text: 'x'.repeat(31) }], 'selections')).toThrow(/maximum length of 30/);
    });

    it('rejects invalid heading keys', () => {
      expect(() => validateTextElements([{ id: 'NOT_A_HEADING', text: 'x' }], 'headings')).toThrow(/Invalid heading key/);
    });

    it('accepts valid heading keys and length limits', () => {
      expect(() => validateTextElements([{ id: 'LISTHEADER', text: 'ok' }], 'headings')).not.toThrow();
      expect(() => validateTextElements([{ id: 'COLUMNHEADER_4', text: 'ok' }], 'headings')).not.toThrow();
      expect(() => validateTextElements([{ id: 'LISTHEADER', text: 'x'.repeat(72) }], 'headings')).toThrow(/maximum length of 71/);
    });
  });

  describe('TextElementCategory round-trip', () => {
    it('parse→serialize round-trips symbols', () => {
      const src = '@MaxLength:10\n001=Example\n\n002=Another\n';
      expect(serializeTextpoolProperties('texts', parseTextpoolProperties('texts', src))).toBe(src);
    });
  });
});
