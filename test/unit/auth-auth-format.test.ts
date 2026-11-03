/**
 * AUTH (authorization field) — local `auth-v1.json` document + ICF wire mapping.
 *
 * Pins:
 *   - the local extension schema (upstream auth-v1 + searchHelpExit /
 *     activityField) accepts real-looking documents and rejects unknown /
 *     missing fields
 *   - AUTHX row → document mapping: ROLLNAME → dataElement, EXIT_FB →
 *     searchHelpExit, ACTVT_FLAG = 'X' → activityField, CHECKTABLE → checkTable,
 *     with read-side name/package stripped
 *   - object-name / filename-token rules for plain, namespaced and
 *     interior-slash names (`ACCGO/SID`, `/AIF/SEROB`)
 */
import { describe, expect, it } from 'vitest';
import {
  AUTH_NAME_MAX_LENGTH,
  authArtifact,
  authExample,
  authFileToken,
  authFromWire,
  authNameFromToken,
  authSpec,
  authToWire,
  normalizeAuthName,
  validateAuthDocument,
  type AuthLocal,
} from '../../src/abap_cli/formats/auth/auth.js';
import { schemaPathFor } from '../../src/abap_cli/aff/schema-paths.js';
import { CliError } from '../../src/abap_cli/output/json.js';

const AUTH_DOC: AuthLocal = {
  formatVersion: '1',
  generalInformation: { dataElement: 'ACTIV_AUTH', activityField: true },
  alternativeSearchHelp: { checkTable: 'TACT' },
};

describe('AUTH local document (auth-v1.json)', () => {
  it('validates the minimal and the full document', async () => {
    expect(await authArtifact.validate({ formatVersion: '1', generalInformation: { dataElement: 'VKORG' } })).toEqual([]);
    expect(await authArtifact.validate(AUTH_DOC)).toEqual([]);
  });

  it('rejects a missing data element', async () => {
    const errors = await authArtifact.validate({ formatVersion: '1', generalInformation: {} });
    expect(errors.join('; ')).toContain('dataElement');
  });

  it('rejects unknown fields and the AFF header (no text table for AUTH)', async () => {
    const errors = await authArtifact.validate({
      formatVersion: '1',
      header: { originalLanguage: 'en' },
      generalInformation: { dataElement: 'VKORG' },
    });
    expect(errors.length).toBeGreaterThan(0);
    const unknown = await authArtifact.validate({
      formatVersion: '1',
      generalInformation: { dataElement: 'VKORG', bogus: 'x' },
    });
    expect(unknown.length).toBeGreaterThan(0);
  });

  it('rejects non-boolean activityField and oversized names', async () => {
    await expect(
      authArtifact.validate({ formatVersion: '1', generalInformation: { dataElement: 'VKORG', activityField: 'X' } }),
    ).resolves.not.toEqual([]);
    await expect(
      authArtifact.validate({ formatVersion: '1', generalInformation: { dataElement: 'A'.repeat(31) } }),
    ).resolves.not.toEqual([]);
  });

  it('semantic validation rejects illegal SAP names', () => {
    expect(validateAuthDocument({ formatVersion: '1', generalInformation: { dataElement: 'VKORG' } })).toEqual([]);
    expect(validateAuthDocument({ formatVersion: '1', generalInformation: { dataElement: '' } }).length).toBeGreaterThan(0);
    expect(
      validateAuthDocument({ formatVersion: '1', generalInformation: { dataElement: 'VKORG', searchHelpExit: 'A B' } }).length,
    ).toBeGreaterThan(0);
    expect(
      validateAuthDocument({ formatVersion: '1', generalInformation: { dataElement: 'VKORG' }, alternativeSearchHelp: { checkTable: 'X/Y/Z/W' } })
        .length,
    ).toBeGreaterThan(0);
  });

  it('accepts the example document', async () => {
    expect(await authArtifact.validate(authExample())).toEqual([]);
  });

  it('resolves the local schema path', () => {
    expect(schemaPathFor('AUTH')).toMatch(/auth-v1\.json$/);
  });
});

describe('AUTH wire mapping', () => {
  it('strips name/package and empty optional fields on read', () => {
    const local = authFromWire({
      formatVersion: '1',
      generalInformation: { dataElement: 'VKORG', searchHelpExit: '', activityField: false },
      alternativeSearchHelp: { checkTable: '' },
      name: 'VKORG',
      package: 'VA',
    });
    expect(local).toEqual({ formatVersion: '1', generalInformation: { dataElement: 'VKORG' } });
  });

  it('keeps set fields, uppercases names and normalizes the activity indicator', () => {
    expect(
      authFromWire({
        formatVersion: '1',
        generalInformation: { dataElement: 'vkorG', searchHelpExit: 'zcli_tc_she', activityField: 'X' },
        alternativeSearchHelp: { checkTable: 'tvko' },
        name: 'VKORG',
        package: 'VA',
      }),
    ).toEqual({
      formatVersion: '1',
      generalInformation: { dataElement: 'VKORG', searchHelpExit: 'ZCLI_TC_SHE', activityField: true },
      alternativeSearchHelp: { checkTable: 'TVKO' },
    });
  });

  it('emits the full body on write (empty strings for unset fields)', () => {
    expect(authToWire({ formatVersion: '1', generalInformation: { dataElement: 'vkorG' } })).toEqual({
      formatVersion: '1',
      generalInformation: { dataElement: 'VKORG', searchHelpExit: '', activityField: false },
      alternativeSearchHelp: { checkTable: '' },
    });
  });

  it('round-trips a document through the wire', () => {
    expect(authFromWire(authToWire(AUTH_DOC))).toEqual(AUTH_DOC);
  });
});

describe('AUTH name rules', () => {
  it('normalizes and validates object names', () => {
    expect(normalizeAuthName(' zcli_tc_auth_x1 ')).toBe('ZCLI_TC_AUTH_X1');
    expect(normalizeAuthName('/aif/serob')).toBe('/AIF/SEROB');
    expect(normalizeAuthName('ACCGO/SID')).toBe('ACCGO/SID');
    expect(() => normalizeAuthName('.INCLUDE')).toThrowError(/invalid/);
    expect(() => normalizeAuthName('A B')).toThrowError(/invalid/);
    expect(() => normalizeAuthName('A'.repeat(AUTH_NAME_MAX_LENGTH + 1))).toThrowError(/invalid/);
  });

  it('rejects invalid names with AUTH_NAME_INVALID', () => {
    try {
      normalizeAuthName('.INCLUDE');
      expect.unreachable('expected AUTH_NAME_INVALID');
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      expect((error as CliError).code).toBe('AUTH_NAME_INVALID');
    }
  });

  it('builds and reverses filename tokens', () => {
    expect(authFileToken('ZCLI_TC_AUTH_X1')).toBe('zcli_tc_auth_x1');
    expect(authFileToken('/AIF/SEROB')).toBe('(aif)serob');
    expect(authFileToken('ACCGO/SID')).toBe('accgo~sid');
    expect(authNameFromToken('zcli_tc_auth_x1')).toBe('ZCLI_TC_AUTH_X1');
    expect(authNameFromToken('(aif)serob')).toBe('/AIF/SEROB');
    expect(authNameFromToken('accgo~sid')).toBe('ACCGO/SID');
    for (const name of ['ZCLI_TC_AUTH_X1', '/AIF/SEROB', 'ACCGO/SID']) {
      expect(authNameFromToken(authFileToken(name), `${authFileToken(name)}.auth.json`)).toBe(name);
    }
  });

  it('rejects the retired # namespace token', () => {
    try {
      authNameFromToken('#aif#serob', '#aif#serob.auth.json');
      expect.unreachable('expected FILE_PARSE_ERROR');
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      expect((error as CliError).code).toBe('FILE_PARSE_ERROR');
    }
  });

  it('exposes the spec metadata the family flows consume', () => {
    expect(authSpec.type).toBe('AUTH');
    expect(authSpec.route).toBe('auth');
    expect(authSpec.tadirObject).toBe('AUTH');
    expect(authSpec.schemaFile).toBe('auth-v1.json');
    expect(authSpec.nameMaxLength).toBe(30);
    expect(authSpec.example().formatVersion).toBe('1');
  });
});
