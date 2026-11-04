/**
 * SUSC (authorization object class) — local `susc-v1.json` document + ICF wire
 * mapping.
 *
 * Pins:
 *   - the local extension schema (formatVersion + header{description,
 *     originalLanguage}) accepts real-looking documents and rejects unknown /
 *     missing fields
 *   - TOBC/TOBCT → document mapping: CTEXT → header.description, TOBCT-LANGU →
 *     header.originalLanguage (ISO), read-side name/package stripped
 *   - object-name / filename-token rules for the CHAR-4 class names: plain
 *     (`CV`, `IS-B`, `6VPM`), lower-case input, and the `/AGG` namespace form
 */
import { describe, expect, it } from 'vitest';
import {
  SUSC_NAME_MAX_LENGTH,
  normalizeSuscName,
  suscArtifact,
  suscExample,
  suscFileToken,
  suscFromWire,
  suscNameFromToken,
  suscSpec,
  suscToWire,
  validateSuscDocument,
  type SuscLocal,
} from '../../src/abap_cli/formats/auth/susc.js';
import { schemaPathFor } from '../../src/abap_cli/aff/schema-paths.js';
import { CliError } from '../../src/abap_cli/output/json.js';

const SUSC_DOC: SuscLocal = {
  formatVersion: '1',
  header: { description: 'APO Authorization Objects', originalLanguage: 'en' },
};

describe('SUSC local document (susc-v1.json)', () => {
  it('validates the example document', async () => {
    expect(await suscArtifact.validate(SUSC_DOC)).toEqual([]);
    expect(await suscArtifact.validate(suscExample())).toEqual([]);
  });

  it('allows an empty description (SAP text is not mandatory)', async () => {
    expect(await suscArtifact.validate({ formatVersion: '1', header: { description: '', originalLanguage: 'en' } })).toEqual([]);
  });

  it('rejects missing header/language, long text, unknown fields', async () => {
    await expect(suscArtifact.validate({ formatVersion: '1' })).resolves.not.toEqual([]);
    await expect(suscArtifact.validate({ formatVersion: '1', header: { description: 'x' } })).resolves.not.toEqual([]);
    await expect(
      suscArtifact.validate({ formatVersion: '1', header: { description: 'x', originalLanguage: 'en', bogus: 1 } }),
    ).resolves.not.toEqual([]);
    await expect(
      suscArtifact.validate({ formatVersion: '1', header: { description: 'x'.repeat(61), originalLanguage: 'en' } }),
    ).resolves.not.toEqual([]);
  });

  it('semantic validation checks the ISO language and text limit', () => {
    expect(validateSuscDocument(SUSC_DOC)).toEqual([]);
    expect(validateSuscDocument({ formatVersion: '1', header: { description: 'x', originalLanguage: '' } }).length).toBeGreaterThan(0);
    expect(validateSuscDocument({ formatVersion: '1', header: { description: 'x', originalLanguage: 'english' } }).length).toBeGreaterThan(0);
    expect(validateSuscDocument({ formatVersion: '1', header: { description: 'x'.repeat(61), originalLanguage: 'en' } }).length).toBeGreaterThan(0);
  });

  it('resolves the local schema path', () => {
    expect(schemaPathFor('SUSC')).toMatch(/susc-v1\.json$/);
  });
});

describe('SUSC wire mapping', () => {
  it('strips name/package on read', () => {
    expect(
      suscFromWire({
        formatVersion: '1',
        header: { description: 'APO Authorization Objects', originalLanguage: 'en' },
        name: 'APO',
        package: 'MD_AUTHORITY',
      }),
    ).toEqual(SUSC_DOC);
  });

  it('falls back to en when the language is missing and trims the text', () => {
    expect(suscFromWire({ formatVersion: '1', header: { description: '  x  ' } })).toEqual({
      formatVersion: '1',
      header: { description: 'x', originalLanguage: 'en' },
    });
  });

  it('emits the full body on write', () => {
    expect(suscToWire({ formatVersion: '1', header: { description: ' x ', originalLanguage: 'EN' } })).toEqual({
      formatVersion: '1',
      header: { description: 'x', originalLanguage: 'en' },
    });
  });

  it('round-trips a document through the wire', () => {
    expect(suscFromWire(suscToWire(SUSC_DOC))).toEqual(SUSC_DOC);
  });
});

describe('SUSC name rules', () => {
  it('normalizes the CHAR-4 class names', () => {
    expect(normalizeSuscName('apo')).toBe('APO');
    expect(normalizeSuscName('zt01')).toBe('ZT01');
    expect(normalizeSuscName('is-b')).toBe('IS-B');
    expect(normalizeSuscName('6vpm')).toBe('6VPM');
    expect(normalizeSuscName('/agg')).toBe('/AGG');
    expect(() => normalizeSuscName('ABCDE')).toThrowError(/invalid/);
    expect(() => normalizeSuscName('AB C')).toThrowError(/invalid/);
    expect(() => normalizeSuscName('.ABC')).toThrowError(/invalid/);
    expect(() => normalizeSuscName('')).toThrowError(/invalid/);
  });

  it('rejects invalid names with SUSC_NAME_INVALID', () => {
    try {
      normalizeSuscName('ABCDE');
      expect.unreachable('expected SUSC_NAME_INVALID');
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      expect((error as CliError).code).toBe('SUSC_NAME_INVALID');
    }
  });

  it('builds and reverses filename tokens', () => {
    expect(suscFileToken('APO')).toBe('apo');
    expect(suscFileToken('IS-B')).toBe('is-b');
    expect(suscFileToken('/AGG')).toBe('~agg');
    expect(suscNameFromToken('apo')).toBe('APO');
    expect(suscNameFromToken('is-b')).toBe('IS-B');
    expect(suscNameFromToken('~agg')).toBe('/AGG');
    for (const name of ['APO', 'IS-B', '6VPM', '/AGG']) {
      expect(suscNameFromToken(suscFileToken(name), `${suscFileToken(name)}.susc.json`)).toBe(name);
    }
  });

  it('rejects names that do not fit the CHAR-4 key', () => {
    try {
      suscNameFromToken('abcdef', 'abcdef.susc.json');
      expect.unreachable('expected FILE_PARSE_ERROR');
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      expect((error as CliError).code).toBe('FILE_PARSE_ERROR');
    }
  });

  it('exposes the spec metadata the family flows consume', () => {
    expect(suscSpec.type).toBe('SUSC');
    expect(suscSpec.route).toBe('susc');
    expect(suscSpec.tadirObject).toBe('SUSC');
    expect(suscSpec.schemaFile).toBe('susc-v1.json');
    expect(suscSpec.nameMaxLength).toBe(SUSC_NAME_MAX_LENGTH);
    expect(suscSpec.example().formatVersion).toBe('1');
  });
});
