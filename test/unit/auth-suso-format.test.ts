/**
 * SUSO (authorization object) — local `suso-v1.json` document + ICF wire mapping.
 *
 * Pins:
 *   - the local-extension schema (upstream AFF SUSO + long text, SAP_NEW
 *     values, FBLOCK/CONVERSION and the three-state criticality) accepts
 *     real-looking documents and rejects unknown / missing / out-of-range
 *     fields
 *   - the SAP wire document (TOBJ, TOBJT, TACTZ, TOBJVORFLG, TOBJVOR,
 *     TOBJVORDAT, TOBJ_ATTR, DOKU UO long text) → local document mapping,
 *     with read-side `name` / `package` stripped and default sections omitted
 *     (stable pull → push → pull)
 *   - object-name / filename-token rules for plain and namespaced objects
 *     (XUOBJECT is CHAR 10, so the whole `/NS/NAME` name is length-limited)
 *   - the SUSO-only spec fields the family flows consume
 */
import { describe, expect, it } from 'vitest';
import {
  SUSO_NAME_MAX_LENGTH,
  normalizeSusoName,
  susoArtifact,
  susoExample,
  susoFileToken,
  susoFromWire,
  susoNameFromToken,
  susoSpec,
  susoToWire,
  validateSusoDocument,
  type SusoLocal,
} from '../../src/abap_cli/formats/auth/suso.js';
import { schemaPathFor } from '../../src/abap_cli/aff/schema-paths.js';
import { CliError } from '../../src/abap_cli/output/json.js';

const SUSO_DOC: SusoLocal = {
  formatVersion: '1',
  header: { description: 'CLI test authorization object', originalLanguage: 'en' },
  generalInformation: { objectClass: 'AAAT' },
  authorizationFields: [{ authorizationField: 'ACTVT' }, { authorizationField: 'BUKRS' }],
  permittedActivities: [{ activity: '03' }, { activity: '01' }],
};

/** Shape of a real `GET /auth/suso/S_TABU_DIS` response (`name`/`package` extra). */
const WIRE_DOC = {
  formatVersion: '1',
  header: { description: 'Table maintenance (via standard tools such as SM30)', originalLanguage: 'DE', abapLanguageVersion: 'standard' },
  generalInformation: { objectClass: 'BC_A', fieldBlock: '', conversion: false },
  authorizationFields: [{ authorizationField: 'DICBERCLS' }, { authorizationField: 'ACTVT' }],
  permittedActivities: [{ activity: '02' }, { activity: '03' }, { activity: '08' }, { activity: 'BD' }],
  objectAttributes: { criticality: 'critical', classCopyToDefaultData: 'withoutRestriction' },
  sapNewRelevance: { isRelevantToSapNew: false, values: [] },
  classificationForCdsBdef: { usageInOwnAuthContext: 'notAllowed', usageInPrivilegedBdefMode: 'notAllowed' },
  longText: '&DEFINITION&\nLine one\n\nLine after a blank line',
  name: 'S_TABU_DIS',
  package: 'SVIM',
};

describe('SUSO local document (suso-v1.json)', () => {
  it('accepts the example and a full document', async () => {
    expect(await susoArtifact.validate(susoExample())).toEqual([]);
    expect(
      await susoArtifact.validate({
        ...SUSO_DOC,
        header: { ...SUSO_DOC.header, abapLanguageVersion: 'standard' },
        generalInformation: { objectClass: 'AAAT', fieldBlock: 'PP', conversion: true },
        objectAttributes: { criticality: 'notCritical', classCopyToDefaultData: 'ifInSameApplComponent' },
        sapNewRelevance: {
          isRelevantToSapNew: true,
          values: [{ release: '757', lineNumber: '000', field: 'ACTVT', low: '03', high: '' }],
        },
        classificationForCdsBdef: { usageInOwnAuthContext: 'allowed', usageInPrivilegedBdefMode: 'allowed' },
        longText: '&DEFINITION&\nLine one',
      }),
    ).toEqual([]);
  });

  it('rejects unknown properties, missing description and oversized short text', async () => {
    expect(await susoArtifact.validate({ ...SUSO_DOC, bogus: true })).not.toEqual([]);
    expect(
      await susoArtifact.validate({ ...SUSO_DOC, header: { description: '', originalLanguage: 'en' } }),
    ).not.toEqual([]);
    expect(
      await susoArtifact.validate({ ...SUSO_DOC, header: { description: 'X'.repeat(61), originalLanguage: 'en' } }),
    ).not.toEqual([]);
  });

  it('rejects field/activity/class shape violations', async () => {
    await expect(
      susoArtifact.validate({ ...SUSO_DOC, generalInformation: { objectClass: 'TOOLONG' } }),
    ).resolves.not.toEqual([]);
    // TOBJ-OCLSS is CHAR 4 but delivered values are stored unpadded ("AIF")
    await expect(
      susoArtifact.validate({ ...SUSO_DOC, generalInformation: { objectClass: 'AIF' } }),
    ).resolves.toEqual([]);
    await expect(susoArtifact.validate({ ...SUSO_DOC, authorizationFields: [] })).resolves.not.toEqual([]);
    await expect(
      susoArtifact.validate({
        ...SUSO_DOC,
        authorizationFields: Array.from({ length: 11 }, (_, i) => ({ authorizationField: `F${i}` })),
      }),
    ).resolves.not.toEqual([]);
    await expect(
      susoArtifact.validate({ ...SUSO_DOC, permittedActivities: [{ activity: 'A' }] }),
    ).resolves.not.toEqual([]);
    await expect(
      susoArtifact.validate({ ...SUSO_DOC, sapNewRelevance: { isRelevantToSapNew: true, values: [] } }),
    ).resolves.not.toEqual([]);
  });

  it('semantic validation catches SAP limits the schema cannot express', () => {
    expect(validateSusoDocument(SUSO_DOC)).toEqual([]);
    expect(validateSusoDocument({ ...SUSO_DOC, header: { description: '', originalLanguage: 'en' } })).not.toEqual([]);
    expect(validateSusoDocument({ ...SUSO_DOC, header: { description: 'x', originalLanguage: 'english' } })).not.toEqual([]);
    expect(validateSusoDocument({ ...SUSO_DOC, generalInformation: { objectClass: '' } })).not.toEqual([]);
    expect(validateSusoDocument({ ...SUSO_DOC, generalInformation: { objectClass: 'TOOLONG' } })).not.toEqual([]);
    expect(validateSusoDocument({ ...SUSO_DOC, generalInformation: { objectClass: 'AIF' } })).toEqual([]);
    expect(
      validateSusoDocument({
        ...SUSO_DOC,
        authorizationFields: [{ authorizationField: 'ACTVT' }, { authorizationField: 'ACTVT' }],
      }),
    ).not.toEqual([]);
    // activities need ACTVT in the field list
    expect(
      validateSusoDocument({
        ...SUSO_DOC,
        authorizationFields: [{ authorizationField: 'BUKRS' }],
        permittedActivities: [{ activity: '03' }],
      }),
    ).not.toEqual([]);
    expect(
      validateSusoDocument({
        ...SUSO_DOC,
        authorizationFields: [{ authorizationField: 'ACTVT' }],
        objectAttributes: { criticality: 'bogus' as never },
      }),
    ).not.toEqual([]);
    expect(
      validateSusoDocument({
        ...SUSO_DOC,
        authorizationFields: [{ authorizationField: 'ACTVT' }],
        objectAttributes: { classCopyToDefaultData: 'bogus' as never },
      }),
    ).not.toEqual([]);
    expect(
      validateSusoDocument({
        ...SUSO_DOC,
        authorizationFields: [{ authorizationField: 'ACTVT' }],
        sapNewRelevance: { isRelevantToSapNew: true, values: [{ release: '' }] },
      }),
    ).not.toEqual([]);
    expect(
      validateSusoDocument({
        ...SUSO_DOC,
        longText: 'X'.repeat(73),
      }),
    ).not.toEqual([]);
    // SAPscript control lines and 72-character lines are fine
    expect(validateSusoDocument({ ...SUSO_DOC, longText: '&DEFINITION&\n' + 'Y'.repeat(72) })).toEqual([]);
  });

  it('resolves the local SUSO schema path', () => {
    expect(schemaPathFor('SUSO')).toMatch(/suso-v1\.json$/);
  });
});

describe('SUSO wire mapping', () => {
  it('maps a real GET document to the local document, stripping name/package', () => {
    const local = susoFromWire(WIRE_DOC);
    expect(local).toEqual({
      formatVersion: '1',
      header: { description: 'Table maintenance (via standard tools such as SM30)', originalLanguage: 'de' },
      generalInformation: { objectClass: 'BC_A' },
      authorizationFields: [{ authorizationField: 'DICBERCLS' }, { authorizationField: 'ACTVT' }],
      permittedActivities: [{ activity: '02' }, { activity: '03' }, { activity: '08' }, { activity: 'BD' }],
      objectAttributes: { criticality: 'critical', classCopyToDefaultData: 'withoutRestriction' },
      classificationForCdsBdef: { usageInOwnAuthContext: 'notAllowed', usageInPrivilegedBdefMode: 'notAllowed' },
      longText: '&DEFINITION&\nLine one\n\nLine after a blank line',
    });
    expect('name' in local).toBe(false);
    expect('package' in local).toBe(false);
  });

  it('omits default sections so pull → push → pull is stable', () => {
    const local = susoFromWire({
      ...WIRE_DOC,
      header: { description: 'Object', originalLanguage: 'EN' },
      generalInformation: { objectClass: 'AAAT', fieldBlock: '', conversion: false },
      authorizationFields: [{ authorizationField: 'ACTVT' }],
      permittedActivities: [],
      objectAttributes: { criticality: 'notSpecified', classCopyToDefaultData: 'withoutRestriction' },
      sapNewRelevance: { isRelevantToSapNew: false, values: [] },
      classificationForCdsBdef: { usageInOwnAuthContext: 'notSpecified', usageInPrivilegedBdefMode: 'notSpecified' },
      longText: '',
    });
    expect(local).toEqual({
      formatVersion: '1',
      header: { description: 'Object', originalLanguage: 'en' },
      generalInformation: { objectClass: 'AAAT' },
      authorizationFields: [{ authorizationField: 'ACTVT' }],
    });
    expect(susoFromWire(susoToWire(local))).toEqual(local);
  });

  it('keeps SAP_NEW values and non-default language/attributes', () => {
    const local = susoFromWire({
      formatVersion: '1',
      header: { description: 'Object', originalLanguage: 'EN', abapLanguageVersion: 'keyUser' },
      generalInformation: { objectClass: 'AAAT' },
      authorizationFields: [{ authorizationField: 'ACTVT' }],
      objectAttributes: { criticality: 'notCritical', classCopyToDefaultData: 'notCopiedFromTraceData' },
      sapNewRelevance: {
        isRelevantToSapNew: true,
        values: [{ release: '757', lineNumber: '000', field: 'ACTVT', low: '03', high: '16' }],
      },
      longText: '',
      name: 'ZCLI_SUSO1',
      package: '$TMP',
    });
    expect(local.header.abapLanguageVersion).toBe('keyUser');
    expect(local.objectAttributes).toEqual({
      criticality: 'notCritical',
      classCopyToDefaultData: 'notCopiedFromTraceData',
    });
    expect(local.sapNewRelevance).toEqual({
      isRelevantToSapNew: true,
      values: [{ release: '757', lineNumber: '000', field: 'ACTVT', low: '03', high: '16' }],
    });
    expect(susoToWire(local).sapNewRelevance?.values).toEqual([
      { release: '757', lineNumber: '000', field: 'ACTVT', low: '03', high: '16' },
    ]);
  });

  it('emits every section with defaults on write (PUT is a full replace)', () => {
    const wire = susoToWire(SUSO_DOC);
    expect(wire).toEqual({
      formatVersion: '1',
      header: { description: 'CLI test authorization object', originalLanguage: 'en', abapLanguageVersion: 'standard' },
      generalInformation: { objectClass: 'AAAT', fieldBlock: '', conversion: false },
      authorizationFields: [{ authorizationField: 'ACTVT' }, { authorizationField: 'BUKRS' }],
      permittedActivities: [{ activity: '03' }, { activity: '01' }],
      objectAttributes: { criticality: 'notSpecified', classCopyToDefaultData: 'withoutRestriction' },
      sapNewRelevance: { isRelevantToSapNew: false, values: [] },
      classificationForCdsBdef: { usageInOwnAuthContext: 'notSpecified', usageInPrivilegedBdefMode: 'notSpecified' },
      longText: '',
    });
  });

  it('normalizes abap_bool variants from the wire', () => {
    const local = susoFromWire({
      ...WIRE_DOC,
      generalInformation: { objectClass: 'AAAT', conversion: 'X' },
      sapNewRelevance: { isRelevantToSapNew: 'X', values: [{ release: '757' }] },
    });
    expect(local.generalInformation.conversion).toBe(true);
    expect(local.sapNewRelevance?.isRelevantToSapNew).toBe(true);
  });
});

describe('SUSO name / filename rules', () => {
  it('normalizes and validates XUOBJECT names', () => {
    expect(normalizeSusoName(' zcli_suso1 ')).toBe('ZCLI_SUSO1');
    expect(normalizeSusoName('/aif/cdlog')).toBe('/AIF/CDLOG');
    expect(normalizeSusoName('S_TABU_DIS')).toBe('S_TABU_DIS');
    expect(SUSO_NAME_MAX_LENGTH).toBe(10);
    for (const bad of ['', 'ZCLI_SUSO_01', 'with space', 'ZCLI-SUSO', '/AIF', '/AIF/CDLOGX']) {
      expect(() => normalizeSusoName(bad)).toThrow(CliError);
    }
  });

  it('round-trips plain and namespaced filename tokens', () => {
    expect(susoFileToken('ZCLI_SUSO1')).toBe('zcli_suso1');
    expect(susoFileToken('/AIF/CDLOG')).toBe('(aif)cdlog');
    expect(susoNameFromToken('zcli_suso1')).toBe('ZCLI_SUSO1');
    expect(susoNameFromToken('(aif)cdlog')).toBe('/AIF/CDLOG');
    expect(() => susoNameFromToken('(aif)cdlogx')).toThrow(CliError);
  });

  it('exposes the family spec fields the flows consume', () => {
    expect(susoSpec.type).toBe('SUSO');
    expect(susoSpec.route).toBe('suso');
    expect(susoSpec.tadirObject).toBe('SUSO');
    expect(susoSpec.schemaFile).toBe('suso-v1.json');
    expect(susoSpec.nameMaxLength).toBe(10);
    expect(susoSpec.normalizeName('zcli_suso1')).toBe('ZCLI_SUSO1');
    expect(susoSpec.example().formatVersion).toBe('1');
  });
});
