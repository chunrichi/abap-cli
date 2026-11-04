/**
 * SUSH (SU22 authorization default) — local AFF `sush-v1.json` document + ICF wire mapping.
 *
 * Pins:
 *   - the reused upstream AFF schema accepts real-looking documents and rejects
 *     unknown fields / missing required sections / bad enum values
 *   - USOB_SM/USOBX/USOBT → document mapping: application type/name per key
 *     type, maintenanceMode (USOB_SM-OKFLAG), maintenanceStatus (USOBX-OKFLAG)
 *     and authObjectFieldValues (USOBT), with read-side name/package stripped
 *   - composite key rules: canonical `<NAME>.<TYPE>`, raw 32-character TADIR
 *     composite, `<NAME> <TYPE>` alias, namespaces and the dot-free filename
 *     token round trip
 */
import { describe, expect, it } from 'vitest';
import {
  SUSH_APP_NAME_MAX_LENGTH,
  SUSH_NAME_MAX_LENGTH,
  normalizeSushName,
  sushArtifact,
  sushExample,
  sushFileToken,
  sushFromWire,
  sushKeyTypeOfApplicationType,
  sushNameFromToken,
  sushObjectName,
  sushSpec,
  sushToWire,
  validateSushDocument,
  type SushLocal,
} from '../../src/abap_cli/formats/auth/sush.js';
import { schemaPathFor } from '../../src/abap_cli/aff/schema-paths.js';
import { CliError } from '../../src/abap_cli/output/json.js';

const SUSH_DOC: SushLocal = {
  formatVersion: '1',
  header: {
    description: 'R3TR FUNC ZCLI_TC_SUSH_FM',
    originalLanguage: 'en',
  },
  generalInformation: {
    applicationName: 'ZCLI_TC_SUSH_FM',
    applicationType: 'FUNC',
    maintenanceMode: 'manual',
    defaultValuesRequired: 'yes',
  },
  authorizationObjects: [
    {
      authObjectName: 'S_RFC',
      maintenanceStatus: 'defaultWithValues',
      authObjectFieldValues: [
        { authFieldName: 'RFC_TYPE', authFieldLowValue: 'FUGR' },
        { authFieldName: 'RFC_NAME', authFieldLowValue: 'ZCLI_TC_SUSH_FM' },
        { authFieldName: 'ACTVT', authFieldLowValue: '16' },
      ],
    },
  ],
};

describe('SUSH local document (upstream AFF sush-v1.json)', () => {
  it('validates a full RF application document and the example', async () => {
    expect(await sushArtifact.validate(SUSH_DOC)).toEqual([]);
    expect(await sushArtifact.validate(sushExample())).toEqual([]);
  });

  it('accepts the HT/HS application shape (TADIR object type / service type)', async () => {
    const ht = {
      ...SUSH_DOC,
      generalInformation: {
        applicationName: 'ADT_SUSH_SRV',
        applicationType: 'SUCO',
        maintenanceMode: 'manual',
        defaultValuesRequired: 'yes',
      },
      authorizationObjects: [{ authObjectName: 'S_TCODE', maintenanceStatus: 'noDefault' }],
    };
    expect(await sushArtifact.validate(ht)).toEqual([]);
    const hs = {
      ...SUSH_DOC,
      generalInformation: {
        applicationName: 'ECC_PROJECTCLAIMCRTRC/',
        applicationType: 'WS',
        maintenanceMode: 'noDefaultValues',
        defaultValuesRequired: 'yes',
      },
      authorizationObjects: [],
    };
    expect(await sushArtifact.validate(hs)).toEqual([]);
  });

  it('rejects missing required sections and bad enum values', async () => {
    const missingApplication = await sushArtifact.validate({
      formatVersion: '1',
      header: { description: '', originalLanguage: 'en' },
      generalInformation: { maintenanceMode: 'manual', defaultValuesRequired: 'yes' },
    });
    expect(missingApplication.join('; ')).toContain('applicationName');

    const badMode = await sushArtifact.validate({
      ...SUSH_DOC,
      generalInformation: { ...SUSH_DOC.generalInformation, maintenanceMode: 'sometimes' },
    });
    expect(badMode.length).toBeGreaterThan(0);

    const badStatus = await sushArtifact.validate({
      ...SUSH_DOC,
      authorizationObjects: [{ authObjectName: 'S_RFC', maintenanceStatus: 'maintained' }],
    });
    expect(badStatus.length).toBeGreaterThan(0);
  });

  it('rejects unknown fields (strict upstream schema)', async () => {
    const unknown = await sushArtifact.validate({ ...SUSH_DOC, unexpected: true });
    expect(unknown.length).toBeGreaterThan(0);
    const unknownNested = await sushArtifact.validate({
      ...SUSH_DOC,
      generalInformation: { ...SUSH_DOC.generalInformation, bogus: 'x' },
    });
    expect(unknownNested.length).toBeGreaterThan(0);
  });

  it('semantic validation catches duplicates and illegal SAP names', () => {
    expect(validateSushDocument(SUSH_DOC)).toEqual([]);
    expect(
      validateSushDocument({
        ...SUSH_DOC,
        generalInformation: { ...SUSH_DOC.generalInformation, applicationName: 'ZCLI FM' },
      }).length,
    ).toBeGreaterThan(0);
    expect(
      validateSushDocument({
        ...SUSH_DOC,
        authorizationObjects: [
          { authObjectName: 'S_RFC', maintenanceStatus: 'noDefault' },
          { authObjectName: 'S_RFC', maintenanceStatus: 'noDefault' },
        ],
      }).some((error) => error.includes('duplicate authorization object')),
    ).toBe(true);
    expect(
      validateSushDocument({
        ...SUSH_DOC,
        authorizationObjects: [
          {
            authObjectName: 'S_RFC',
            maintenanceStatus: 'defaultWithValues',
            authObjectFieldValues: [
              { authFieldName: 'ACTVT', authFieldLowValue: '16' },
              { authFieldName: 'ACTVT', authFieldLowValue: '16' },
            ],
          },
        ],
      }).some((error) => error.includes('duplicate field value')),
    ).toBe(true);
  });

  it('resolves the vendored upstream schema path', () => {
    expect(schemaPathFor('SUSH')).toMatch(/sush-v1\.json$/);
  });
});

describe('SUSH wire mapping', () => {
  it('strips read-side name/package and empty optional values', () => {
    const local = sushFromWire({
      formatVersion: '1',
      header: { description: 'R3TR FUNC ZCLI_TC_SUSH_FM', originalLanguage: 'EN', abapLanguageVersion: 'standard' },
      generalInformation: {
        applicationName: 'zcli_tc_sush_fm',
        applicationType: 'func',
        maintenanceMode: 'automatic',
        defaultValuesRequired: 'yes',
        documentation: '',
      },
      authorizationObjects: [
        {
          authObjectName: 's_rfc',
          maintenanceStatus: 'defaultWithValues',
          documentation: '',
          authObjectFieldValues: [
            { authFieldName: 'ACTVT', authFieldLowValue: '16', authFieldHighValue: '' },
            { authFieldName: 'RFC_TYPE', authFieldLowValue: '', authFieldHighValue: '' },
          ],
        },
      ],
      name: 'ZCLI_TC_SUSH_FM.RF',
      package: '$TMP',
    });
    expect(local).toEqual({
      formatVersion: '1',
      header: { description: 'R3TR FUNC ZCLI_TC_SUSH_FM', originalLanguage: 'en' },
      generalInformation: {
        applicationName: 'zcli_tc_sush_fm',
        applicationType: 'FUNC',
        maintenanceMode: 'automatic',
        defaultValuesRequired: 'yes',
      },
      authorizationObjects: [
        {
          authObjectName: 'S_RFC',
          maintenanceStatus: 'defaultWithValues',
          authObjectFieldValues: [
            { authFieldName: 'ACTVT', authFieldLowValue: '16' },
            { authFieldName: 'RFC_TYPE' },
          ],
        },
      ],
    });
  });

  it('keeps cloudDevelopment and drops an explicit standard language version', () => {
    const cloud = sushFromWire({ ...SUSH_DOC, header: { ...SUSH_DOC.header, abapLanguageVersion: 'cloudDevelopment' } });
    expect(cloud.header.abapLanguageVersion).toBe('cloudDevelopment');
    const standard = sushToWire({ ...cloud, header: { ...cloud.header, abapLanguageVersion: 'standard' } });
    expect(standard.header.abapLanguageVersion).toBeUndefined();
  });

  it('emits a full AFF body on write and survives a pull → push → pull cycle', () => {
    const wire = sushToWire({
      formatVersion: '1',
      header: { description: '', originalLanguage: '' },
      generalInformation: {
        applicationName: 'ZCLI_TC_SUSH_FM',
        applicationType: 'func',
        maintenanceMode: 'manual',
        defaultValuesRequired: 'yes',
      },
    });
    expect(wire.formatVersion).toBe('1');
    expect(wire.header.description).toBe('R3TR FUNC ZCLI_TC_SUSH_FM');
    expect(wire.header.originalLanguage).toBe('en');
    expect(wire.generalInformation.applicationType).toBe('FUNC');
    expect(wire.authorizationObjects).toEqual([]);

    const pulled = sushFromWire({ ...SUSH_DOC, name: 'ZCLI_TC_SUSH_FM.RF', package: '$TMP' });
    const pushed = sushToWire(pulled);
    expect(sushFromWire(pushed)).toEqual(pulled);
  });
});

describe('SUSH object name + filename token', () => {
  it('normalizes the canonical, raw-composite and spaced forms', () => {
    expect(normalizeSushName('zcli_tc_sush_fm.rf')).toBe('ZCLI_TC_SUSH_FM.RF');
    expect(normalizeSushName('OCS_GET_INSTALLED_COMPS       RF')).toBe('OCS_GET_INSTALLED_COMPS.RF');
    expect(normalizeSushName('SMICM TR')).toBe('SMICM.TR');
    expect(normalizeSushName('/accgo/mtm_build.RF')).toBe('/ACCGO/MTM_BUILD.RF');
    expect(normalizeSushName('003dd40f617450d3233ca7790ae742.ht')).toBe('003DD40F617450D3233CA7790AE742.HT');
  });

  it('rejects invalid names with SUSH_NAME_INVALID', () => {
    for (const raw of ['', 'NO_TYPE', 'ZCLI_TC_SUSH_FM.XX', 'A-B.RF', 'A'.repeat(31) + '.RF', 'A.B.RF']) {
      try {
        normalizeSushName(raw);
        throw new Error(`expected ${raw} to be rejected`);
      } catch (error) {
        expect(error).toBeInstanceOf(CliError);
        expect((error as CliError).code).toBe('SUSH_NAME_INVALID');
      }
    }
  });

  it('produces a dot-free token and parses it back', () => {
    const cases: Array<[string, string]> = [
      ['ZCLI_TC_SUSH_FM.RF', 'zcli_tc_sush_fm_rf'],
      ['OCS_GET_INSTALLED_COMPS.RF', 'ocs_get_installed_comps_rf'],
      ['003DD40F617450D3233CA7790AE742.HT', '003dd40f617450d3233ca7790ae742_ht'],
      ['/ACCGO/MTM_BUILD.RF', '(accgo)mtm_build_rf'],
      ['/PF1/47000027.TR', '(pf1)47000027_tr'],
    ];
    for (const [name, token] of cases) {
      expect(sushFileToken(name)).toBe(token);
      expect(token).not.toContain('.');
      expect(sushNameFromToken(token)).toBe(normalizeSushName(name));
    }
  });

  it('parses the token shape the generic file resolver hands over', () => {
    // resolveFile() maps the filename token through affObjectNameFromToken():
    // `(accgo)mtm_build_rf` → `/ACCGO/MTM_BUILD_RF`.
    expect(sushNameFromToken('/ACCGO/MTM_BUILD_RF', '(accgo)mtm_build_rf.sush.json')).toBe('/ACCGO/MTM_BUILD.RF');
    expect(sushNameFromToken('ZCLI_TC_SUSH_FM_RF', 'zcli_tc_sush_fm_rf.sush.json')).toBe('ZCLI_TC_SUSH_FM.RF');
  });

  it('rejects malformed and retired tokens with FILE_PARSE_ERROR', () => {
    for (const token of ['zcli_tc_sush_fm', '#accgo#mtm_build_rf', 'zcli_tc_sush_fm_xx', '']) {
      try {
        sushNameFromToken(token);
        throw new Error(`expected ${token} to be rejected`);
      } catch (error) {
        expect(error).toBeInstanceOf(CliError);
        expect((error as CliError).code).toBe('FILE_PARSE_ERROR');
      }
    }
  });

  it('derives the key type from the leading application type', () => {
    expect(sushKeyTypeOfApplicationType('FUNC')).toBe('RF');
    expect(sushKeyTypeOfApplicationType('TRAN')).toBe('TR');
    expect(sushKeyTypeOfApplicationType('SUCO')).toBeUndefined();
    expect(sushKeyTypeOfApplicationType('WS')).toBeUndefined();
  });

  it('derives the canonical name from FUNC/TRAN documents only', () => {
    expect(sushObjectName(SUSH_DOC)).toBe('ZCLI_TC_SUSH_FM.RF');
    expect(
      sushObjectName({
        ...SUSH_DOC,
        generalInformation: { ...SUSH_DOC.generalInformation, applicationName: 'SMICM', applicationType: 'TRAN' },
      }),
    ).toBe('SMICM.TR');
    expect(
      sushObjectName({
        ...SUSH_DOC,
        generalInformation: { ...SUSH_DOC.generalInformation, applicationName: 'ADT_SUSH_SRV', applicationType: 'SUCO' },
      }),
    ).toBeUndefined();
  });

  it('exposes the frozen AuthTypeSpec shape', () => {
    expect(sushSpec.type).toBe('SUSH');
    expect(sushSpec.route).toBe('sush');
    expect(sushSpec.tadirObject).toBe('SUSH');
    expect(sushSpec.schemaFile).toBe('sush-v1.json');
    expect(sushSpec.nameMaxLength).toBe(SUSH_NAME_MAX_LENGTH);
    expect(SUSH_NAME_MAX_LENGTH).toBe(SUSH_APP_NAME_MAX_LENGTH + 3);
  });
});
