import { describe, expect, it } from 'vitest';
import { CliError } from '../../src/abap_cli/output/json.js';
import {
  componentsFromFuncSections,
  parseFuncPseudoSyntax,
  renderFuncPseudoSyntax,
  toCanonicalFuncSource,
} from '../../src/abap_cli/formats/func-pseudo.js';

describe('parseFuncPseudoSyntax', () => {
  it('parses AFF canonical pseudo syntax with all 5 sections', () => {
    // Canonical AFF format: FUNCTION on its own line, indented section
    // keywords, indented declarations, the closing period lives on the last
    // declaration of each section.
    const content = `FUNCTION zfn_test
  IMPORTING
    iv_input TYPE i
  EXPORTING
    ev_output TYPE i
  CHANGING
    cv_chg TYPE i
  TABLES
    tt_tab TYPE tab
  RAISING
    cx_failed.

  ev_output = iv_input * 2.
ENDFUNCTION.`;
    const result = parseFuncPseudoSyntax(content);
    expect(result.name).toBe('zfn_test');
    expect(result.sections.map((s) => s.name)).toEqual([
      'IMPORTING',
      'EXPORTING',
      'CHANGING',
      'TABLES',
      'RAISING',
    ]);
    expect(result.body).toContain('ev_output = iv_input * 2.');
  });

  it('parses SAP native *" comment-block syntax', () => {
    // Real SAP writes Local Interface blocks as `*"  IMPORTING` (no `~`,
    // uppercase only). The parser recognizes exactly this shape.
    const content = `FUNCTION zfn_test.
*"  IMPORTING
*"    IV_INPUT type I
*"  EXPORTING
*"    EV_OUTPUT type I
*"  RAISING
*"    CX_FAILED
  ev_output = iv_input * 2.
ENDFUNCTION.`;
    const result = parseFuncPseudoSyntax(content);
    expect(result.name).toBe('zfn_test');
    expect(result.sections.map((s) => s.name)).toEqual(
      expect.arrayContaining(['IMPORTING', 'EXPORTING', 'RAISING']),
    );
    // The body excludes the *" comment block.
    expect(result.body).not.toContain('*"');
  });

  it('parses SAP native *" with empty sections', () => {
    const content = `FUNCTION zfn_empty.
*"  IMPORTING
*"  EXPORTING
ENDFUNCTION.`;
    const result = parseFuncPseudoSyntax(content);
    expect(result.name).toBe('zfn_empty');
    expect(result.sections.length).toBe(2);
  });

  it('strips BOM and normalizes CRLF to LF', () => {
    const content =
      '﻿FUNCTION zfn_test.\r\n  body.\r\nENDFUNCTION.';
    const result = parseFuncPseudoSyntax(content);
    expect(result.name).toBe('zfn_test');
    expect(result.body).toContain('body');
  });

  it('throws FILE_PARSE_ERROR when missing FUNCTION header', () => {
    expect(() => parseFuncPseudoSyntax('some content\nmore content')).toThrow(CliError);
    expect(() => parseFuncPseudoSyntax('some content\nmore content')).toThrow(/FUNCTION/);
  });

  it('throws FILE_PARSE_ERROR when missing ENDFUNCTION', () => {
    const content = 'FUNCTION zfn_test.\n  body.\n';
    expect(() => parseFuncPseudoSyntax(content)).toThrow(/ENDFUNCTION/);
  });
});

describe('renderFuncPseudoSyntax', () => {
  it('produces canonical output for an empty interface', () => {
    const output = renderFuncPseudoSyntax({
      name: 'zfn_empty',
      sections: [],
      body: 'a = 1.',
    });
    expect(output).toContain('FUNCTION zfn_empty.');
    expect(output).toContain('a = 1.');
    expect(output.trim().endsWith('ENDFUNCTION.')).toBe(true);
  });

  it('emits declarations grouped under section headers', () => {
    const output = renderFuncPseudoSyntax({
      name: 'zfn_test',
      sections: [
        { name: 'IMPORTING', declarations: ['IV_INPUT TYPE i', 'IV_NAME TYPE string'] },
        { name: 'RAISING', declarations: ['CX_FAILED'] },
      ],
      body: 'a = 1.',
    });
    expect(output).toContain('  IMPORTING');
    expect(output).toContain('    IV_INPUT TYPE i');
    expect(output).toContain('  RAISING');
    expect(output).toContain('    CX_FAILED.');
  });
});

describe('toCanonicalFuncSource', () => {
  it('round-trips SAP native → canonical', () => {
    const native = `FUNCTION zfn_test.
*"  IMPORTING
*"    IV_INPUT type I
  ev_output = iv_input.
ENDFUNCTION.`;
    const canonical = toCanonicalFuncSource(native, 'zfn_test');
    expect(canonical).toContain('FUNCTION zfn_test');
    expect(canonical).toContain('IMPORTING');
    expect(canonical).toContain('ENDFUNCTION.');
    // Re-parse should succeed
    const reparsed = parseFuncPseudoSyntax(canonical);
    expect(reparsed.name).toBe('zfn_test');
  });

  it('returns raw (normalized) source when parsing fails AND fallbackName provided', () => {
    const unparseable = 'garbled no function keyword\n  body\n';
    const out = toCanonicalFuncSource(unparseable, 'zfn_unknown');
    // Parsing failed → returns the content verbatim (with newline normalised).
    expect(out).toContain('garbled no function keyword');
    expect(out.endsWith('\n')).toBe(true);
  });

  it('rethrows when parsing fails AND no fallbackName given', () => {
    expect(() => toCanonicalFuncSource('garbled')).toThrow(CliError);
  });
});

describe('componentsFromFuncSections', () => {
  it('extracts IMPORTING components with descriptions', () => {
    const sections = [
      {
        name: 'IMPORTING' as const,
        declarations: ['IV_INPUT TYPE i "input value"', 'IV_NAME TYPE string'],
      },
    ];
    const components = componentsFromFuncSections(sections, 'IMPORTING');
    expect(components).toHaveLength(2);
    expect(components[0]).toEqual({ name: 'IV_INPUT', description: 'input value' });
    expect(components[1]).toEqual({ name: 'IV_NAME', description: '' });
  });

  it('extracts RAISING components (class names)', () => {
    const sections = [
      { name: 'RAISING' as const, declarations: ['CX_FAILED', 'CX_OTHER'] },
    ];
    const components = componentsFromFuncSections(sections, 'RAISING');
    expect(components).toEqual([
      { name: 'CX_FAILED', description: '' },
      { name: 'CX_OTHER', description: '' },
    ]);
  });

  it('returns empty array for missing section', () => {
    expect(componentsFromFuncSections([], 'IMPORTING')).toEqual([]);
  });

  it('handles all section names', () => {
    const sections = [
      { name: 'IMPORTING' as const, declarations: ['IV_IN TYPE i'] },
      { name: 'EXPORTING' as const, declarations: ['EV_OUT TYPE i'] },
      { name: 'CHANGING' as const, declarations: ['CV_CHG TYPE i'] },
      { name: 'TABLES' as const, declarations: ['TT_TAB TYPE tab'] },
      { name: 'RAISING' as const, declarations: ['CX_EXC'] },
    ];
    expect(componentsFromFuncSections(sections, 'IMPORTING')).toHaveLength(1);
    expect(componentsFromFuncSections(sections, 'EXPORTING')).toHaveLength(1);
    expect(componentsFromFuncSections(sections, 'CHANGING')).toHaveLength(1);
    expect(componentsFromFuncSections(sections, 'TABLES')).toHaveLength(1);
    expect(componentsFromFuncSections(sections, 'RAISING')).toHaveLength(1);
  });
});
