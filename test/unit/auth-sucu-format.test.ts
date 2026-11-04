/**
 * SUCU (authorization group) — local `sucu-v1.json` document + ICF wire mapping
 * + composite-name rules.
 *
 * Pins:
 *   - the local extension schema (formatVersion + header{description,
 *     originalLanguage} + generalInformation{authorizationGroup,
 *     authorizationObject} + texts[]) accepts real-looking documents and
 *     rejects unknown / missing fields
 *   - TBRG_AUTH/TBRG_AUTHT → document mapping: name/package read-side metadata
 *     stripped, ISO language codes lower-cased, texts sorted, empty texts
 *     dropped
 *   - the composite name: compact `<GROUP>~<OBJECT>` canonical form, the raw
 *     40-character padded TADIR name alias, filename tokens with AFF namespace
 *     handling (`(accgo)ppm_gr~(aif)cdlog`)
 */
import { describe, expect, it } from 'vitest';
import {
  SUCU_GROUP_MAX_LENGTH,
  SUCU_NAME_MAX_LENGTH,
  SUCU_OBJECT_MAX_LENGTH,
  normalizeSucuName,
  sucuArtifact,
  sucuExample,
  sucuFileToken,
  sucuFromWire,
  sucuNameFromToken,
  sucuObjectNameFromDocument,
  sucuSpec,
  sucuToWire,
  validateSucuDocument,
  type SucuLocal,
} from '../../src/abap_cli/formats/auth/sucu.js';
import { schemaPathFor } from '../../src/abap_cli/aff/schema-paths.js';
import { CliError } from '../../src/abap_cli/output/json.js';

const SUCU_DOC: SucuLocal = {
  formatVersion: '1',
  header: { description: 'Commodity Derivative Order', originalLanguage: 'en' },
  generalInformation: { authorizationGroup: 'CMMFDOR', authorizationObject: 'S_TABU_DIS' },
  texts: [
    { language: 'de', description: 'Berechtigungsgruppe für Rohstoffderivate' },
    { language: 'zh', description: '商品衍生工具订单' },
  ],
};

/** The raw TADIR key of SUCU_DOC: BRGRU padded to 30 + OBJECT padded to 10. */
const PADDED_NAME = `${'CMMFDOR'.padEnd(SUCU_GROUP_MAX_LENGTH)}${'S_TABU_DIS'.padEnd(SUCU_OBJECT_MAX_LENGTH)}`;

describe('SUCU local document (sucu-v1.json)', () => {
  it('validates the document and the create example', async () => {
    expect(await sucuArtifact.validate(SUCU_DOC)).toEqual([]);
    expect(await sucuArtifact.validate(sucuExample())).toEqual([]);
  });

  it('allows an absent/empty texts array and empty description (SAP text is not mandatory)', async () => {
    expect(
      await sucuArtifact.validate({
        formatVersion: '1',
        header: { description: '', originalLanguage: 'en' },
        generalInformation: { authorizationGroup: 'ZCLI_TC_SUCU_1', authorizationObject: 'S_TABU_DIS' },
      }),
    ).toEqual([]);
  });

  it('rejects missing sections, unknown fields, long texts and bad patterns', async () => {
    await expect(sucuArtifact.validate({ formatVersion: '1' })).resolves.not.toEqual([]);
    await expect(
      sucuArtifact.validate({ formatVersion: '1', header: { originalLanguage: 'en' } }),
    ).resolves.not.toEqual([]);
    await expect(
      sucuArtifact.validate({
        formatVersion: '1',
        header: { originalLanguage: 'en' },
        generalInformation: { authorizationGroup: 'CMMFDOR' },
      }),
    ).resolves.not.toEqual([]);
    await expect(
      sucuArtifact.validate({ ...SUCU_DOC, bogus: true }),
    ).resolves.not.toEqual([]);
    await expect(
      sucuArtifact.validate({ ...SUCU_DOC, header: { ...SUCU_DOC.header, description: 'x'.repeat(41) } }),
    ).resolves.not.toEqual([]);
    await expect(
      sucuArtifact.validate({
        ...SUCU_DOC,
        generalInformation: { authorizationGroup: 'CMMFDOR', authorizationObject: 'TOO_LONG_123' },
      }),
    ).resolves.not.toEqual([]);
    await expect(sucuArtifact.validate({ ...SUCU_DOC, header: { description: 'x', originalLanguage: 'english' } })).resolves.not.toEqual([]);
  });

  it('semantic validation checks the key fields and the text rows', () => {
    expect(validateSucuDocument(SUCU_DOC)).toEqual([]);
    expect(validateSucuDocument({ ...SUCU_DOC, header: { description: 'x', originalLanguage: '' } }).length).toBeGreaterThan(0);
    expect(
      validateSucuDocument({ ...SUCU_DOC, header: { description: 'x', originalLanguage: 'en' }, texts: [{ language: 'en', description: 'x' }] })
        .length,
    ).toBeGreaterThan(0);
    expect(
      validateSucuDocument({
        ...SUCU_DOC,
        texts: [
          { language: 'de', description: 'x' },
          { language: 'DE', description: 'y' },
        ],
      }).length,
    ).toBeGreaterThan(0);
    expect(
      validateSucuDocument({ ...SUCU_DOC, texts: [{ language: 'de', description: 'x'.repeat(41) }] }).length,
    ).toBeGreaterThan(0);
  });

  it('resolves the local schema path', () => {
    expect(schemaPathFor('SUCU')).toMatch(/sucu-v1\.json$/);
  });
});

describe('SUCU wire mapping', () => {
  it('strips name/package and lower-cases the ISO language codes on read', () => {
    expect(
      sucuFromWire({
        formatVersion: '1',
        header: { description: '  Commodity Derivative Order ', originalLanguage: 'EN' },
        generalInformation: { authorizationGroup: 'cmmfdor', authorizationObject: 's_tabu_dis' },
        texts: [
          { language: 'ZH', description: '商品衍生工具订单' },
          { language: 'DE', description: 'Berechtigungsgruppe für Rohstoffderivate' },
        ],
        name: 'CMMFDOR~S_TABU_DIS',
        package: 'FS_CMM_CDOTE_ORDER_REQUEST',
      }),
    ).toEqual(SUCU_DOC);
  });

  it('defensively defaults the language and drops nameless/empty text rows', () => {
    expect(
      sucuFromWire({
        formatVersion: '1',
        header: { description: 'x' },
        generalInformation: { authorizationGroup: 'CMMFDOR', authorizationObject: 'S_TABU_DIS' },
        texts: [{ description: 'no language' }, { language: 'de', description: 'ok' }],
      }),
    ).toEqual({
      formatVersion: '1',
      header: { description: 'x', originalLanguage: 'en' },
      generalInformation: { authorizationGroup: 'CMMFDOR', authorizationObject: 'S_TABU_DIS' },
      texts: [{ language: 'de', description: 'ok' }],
    });
  });

  it('emits the full body on write (upper-case key fields, lower-case ISO codes)', () => {
    expect(sucuToWire(SUCU_DOC)).toEqual({
      formatVersion: '1',
      header: { description: 'Commodity Derivative Order', originalLanguage: 'en' },
      generalInformation: { authorizationGroup: 'CMMFDOR', authorizationObject: 'S_TABU_DIS' },
      texts: [
        { language: 'de', description: 'Berechtigungsgruppe für Rohstoffderivate' },
        { language: 'zh', description: '商品衍生工具订单' },
      ],
    });
  });

  it('round-trips a document through the wire', () => {
    expect(sucuFromWire(sucuToWire(SUCU_DOC))).toEqual(SUCU_DOC);
  });

  it('derives the compact object name from the document key', () => {
    expect(sucuObjectNameFromDocument(SUCU_DOC)).toBe('CMMFDOR~S_TABU_DIS');
    expect(sucuObjectNameFromDocument(sucuExample())).toBe('ZCLI_TC_SUCU_1~S_TABU_DIS');
    expect(
      sucuObjectNameFromDocument({ ...SUCU_DOC, generalInformation: { authorizationGroup: '', authorizationObject: '' } }),
    ).toBeUndefined();
  });
});

describe('SUCU composite name rules', () => {
  it('normalizes the compact <GROUP>~<OBJECT> form', () => {
    expect(normalizeSucuName('cmmfdor~s_tabu_dis')).toBe('CMMFDOR~S_TABU_DIS');
    expect(normalizeSucuName(' CMMFDOR~S_TABU_DIS ')).toBe('CMMFDOR~S_TABU_DIS');
    expect(normalizeSucuName('/accgo/ppm_gr~s_tabu_dis')).toBe('/ACCGO/PPM_GR~S_TABU_DIS');
  });

  it('accepts the raw 40-character padded TADIR name as an alias', () => {
    expect(PADDED_NAME).toHaveLength(40);
    expect(normalizeSucuName(PADDED_NAME)).toBe('CMMFDOR~S_TABU_DIS');
    expect(normalizeSucuName(PADDED_NAME.toLowerCase())).toBe('CMMFDOR~S_TABU_DIS');
  });

  it('rejects malformed names with SUCU_NAME_INVALID', () => {
    for (const raw of ['', 'NOSEPARATOR', 'A~B~C', `~${'S_TABU_DIS'}`, 'CMMFDOR~', 'CMMFDOR~S_TABU_DIS~X', 'AB CD~S_TABU_DIS']) {
      try {
        normalizeSucuName(raw);
        expect.unreachable(`expected SUCU_NAME_INVALID for "${raw}"`);
      } catch (error) {
        expect(error).toBeInstanceOf(CliError);
        expect((error as CliError).code).toBe('SUCU_NAME_INVALID');
      }
    }
  });

  it('keeps the compact name within the documented limits', () => {
    expect(SUCU_NAME_MAX_LENGTH).toBe(SUCU_GROUP_MAX_LENGTH + 1 + SUCU_OBJECT_MAX_LENGTH);
    expect(normalizeSucuName(`${'A'.repeat(30)}~${'B'.repeat(10)}`)).toBe(`${'A'.repeat(30)}~${'B'.repeat(10)}`);
    expect(() => normalizeSucuName(`${'A'.repeat(31)}~B`)).toThrowError(/invalid/);
  });

  it('builds dot-free, path-safe filename tokens', () => {
    expect(sucuFileToken('CMMFDOR~S_TABU_DIS')).toBe('cmmfdor~s_tabu_dis');
    expect(sucuFileToken(PADDED_NAME)).toBe('cmmfdor~s_tabu_dis');
    expect(sucuFileToken('/ACCGO/PPMG_CR~S_TABU_DIS')).toBe('(accgo)ppmg_cr~s_tabu_dis');
    expect(sucuFileToken('CMMFDOR~/AIF/CDLOG')).toBe('cmmfdor~(aif)cdlog');
  });

  it('reverses filename tokens back to the canonical name', () => {
    expect(sucuNameFromToken('CMMFDOR~S_TABU_DIS')).toBe('CMMFDOR~S_TABU_DIS');
    // the generic resolver expands the first namespace token before the spec sees it
    expect(sucuNameFromToken('/ACCGO/PPM_GR~S_TABU_DIS')).toBe('/ACCGO/PPM_GR~S_TABU_DIS');
    expect(sucuNameFromToken('/ACCGO/PPM_GR~(AIF)CDLOG')).toBe('/ACCGO/PPM_GR~/AIF/CDLOG');
    expect(sucuNameFromToken('(ACCGO)PPM_GR~S_TABU_DIS')).toBe('/ACCGO/PPM_GR~S_TABU_DIS');
  });

  it('round-trips names through fileToken → nameFromToken', () => {
    for (const name of ['CMMFDOR~S_TABU_DIS', 'ZCLI_TC_SUCU_1~S_TABU_DIS', '/ACCGO/PPMG_CR~S_TABU_DIS', 'CMMFDOR~/AIF/CDLOG']) {
      expect(sucuNameFromToken(sucuFileToken(name))).toBe(name);
    }
  });

  it('rejects tokens that do not encode a SUCU name', () => {
    expect(() => sucuNameFromToken('CMMFDOR')).toThrowError(/does not encode/);
    expect(() => sucuNameFromToken('A~B~C')).toThrowError(/does not encode/);
    expect(() => sucuNameFromToken('#cmmfdor~s_tabu_dis')).toThrowError(/retired/);
  });
});

describe('SUCU spec contract', () => {
  it('exposes the frozen family metadata', () => {
    expect(sucuSpec.type).toBe('SUCU');
    expect(sucuSpec.route).toBe('sucu');
    expect(sucuSpec.tadirObject).toBe('SUCU');
    expect(sucuSpec.schemaFile).toBe('sucu-v1.json');
    expect(sucuSpec.nameMaxLength).toBe(SUCU_NAME_MAX_LENGTH);
  });
});
