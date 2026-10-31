import { describe, expect, it } from 'vitest';
import {
  assertValidProfileName,
  normalizeProfileUrl,
  assertValidProfile,
} from '../../src/abap_cli/config/validation.js';

describe('normalizeProfileUrl', () => {
  it('keeps scheme + host + port and drops path/query/fragment', () => {
    const out = normalizeProfileUrl('https://sap.example.com:44300/sap/bc/ui2/flp?sap-client=100#x');
    expect(out.url).toBe('https://sap.example.com:44300');
    expect(out.dropped).toEqual([`path '/sap/bc/ui2/flp'`, `query '?sap-client=100'`, `fragment '#x'`]);
  });

  it('collapses a trailing slash to the bare origin', () => {
    expect(normalizeProfileUrl('http://sap.example.com/')).toEqual({ url: 'http://sap.example.com', dropped: [] });
  });

  it('lower-cases the host and preserves an explicit port', () => {
    expect(normalizeProfileUrl('HTTP://SAP.EXAMPLE.COM:50000').url).toBe('http://sap.example.com:50000');
  });

  it('rejects non-http(s) URLs', () => {
    expect(() => normalizeProfileUrl('ftp://sap.example.com')).toThrow(/http:\/\/ or https:\/\//);
  });

  it('rejects embedded credentials', () => {
    expect(() => normalizeProfileUrl('https://user:secret@sap.example.com')).toThrow(/embed credentials/);
  });

  it('rejects empty input and unparseable URLs', () => {
    expect(() => normalizeProfileUrl('   ')).toThrow(/URL is required/);
    expect(() => normalizeProfileUrl('not a url')).toThrow(/Invalid URL format/);
  });
});

describe('assertValidProfileName', () => {
  it('accepts names in [A-Za-z0-9_.-]', () => {
    for (const name of ['dev', 'DEV_100', 'qa-2', 'a.b']) expect(() => assertValidProfileName(name)).not.toThrow();
  });

  it('rejects spaces, slashes, leading symbols and overlong names', () => {
    for (const name of ['my profile', 'a/b', '-dev', '.dev', 'x'.repeat(65)]) {
      expect(() => assertValidProfileName(name)).toThrow(/Invalid profile name/);
    }
  });
});

describe('assertValidProfile', () => {
  it('accepts a complete basic-auth profile', () => {
    expect(() =>
      assertValidProfile({ url: 'https://sap.example.com:44300', client: '100', username: 'DEV', language: 'EN' }),
    ).not.toThrow();
  });

  it('rejects a missing URL or username', () => {
    expect(() => assertValidProfile({ url: '', username: 'DEV' })).toThrow(/URL is required/);
    expect(() => assertValidProfile({ url: 'https://sap.example.com', username: '' })).toThrow(/Username is required/);
  });
});
