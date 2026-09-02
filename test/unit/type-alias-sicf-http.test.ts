import { describe, it, expect } from 'vitest';
import { normalizeTypeInput } from '../../src/abap_cli/cli/type-alias.js';

describe('032 P1: SICF → HTTP type-code alias', () => {
  it('maps SICF to HTTP with deprecation warning', () => {
    const out = normalizeTypeInput('SICF');
    expect(out.type).toBe('HTTP');
    expect(out.aliasWarning).toContain('--type SICF is deprecated');
    expect(out.aliasWarning).toContain('--type HTTP');
  });

  it('accepts lowercase sicf', () => {
    const out = normalizeTypeInput('sicf');
    expect(out.type).toBe('HTTP');
    expect(out.aliasWarning).toBeDefined();
  });

  it('preserves ADT subtype suffix when alias is mapped', () => {
    const out = normalizeTypeInput('SICF/whatever');
    expect(out.type).toBe('HTTP/WHATEVER');
    expect(out.aliasWarning).toBeDefined();
  });

  it('passes HTTP through unchanged with no warning', () => {
    const out = normalizeTypeInput('HTTP');
    expect(out.type).toBe('HTTP');
    expect(out.aliasWarning).toBeUndefined();
  });

  it('passes unknown types through unchanged with no warning', () => {
    const out = normalizeTypeInput('CLAS');
    expect(out.type).toBe('CLAS');
    expect(out.aliasWarning).toBeUndefined();
  });
});
