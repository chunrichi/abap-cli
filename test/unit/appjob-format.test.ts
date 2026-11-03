/**
 * Application jobs (SAJC / SAJT) — AFF documents + release-specific ADT JSON.
 *
 * Pins:
 *   - the vendored AFF v1 schemas accept the upstream example documents and
 *     reject unknown fields / missing required fields
 *   - the legacy (flat) ↔ AFF (nested) translation used on SAP_BASIS 757, and
 *     the explicit rejection of fields the legacy model cannot carry
 *   - wire-model detection from the `$schema` document and from a source
 *     document
 *   - the blueSource create body + metadata projection
 */
import { describe, expect, it } from 'vitest';
import {
  APPJOB_INFO,
  appJobObjectUrl,
  appJobSchemaUrl,
  appJobSourceUrl,
  buildAppJobCreateBody,
  parseAppJobMeta,
} from '../../src/abap_cli/clients/appjob.js';
import {
  sajcArtifact,
  sajtArtifact,
  type SajcLocal,
  type SajtLocal,
} from '../../src/abap_cli/formats/appjob/json.js';
import {
  fromWireDocument,
  sajcFromLegacyWire,
  sajcToLegacyWire,
  sajtFromLegacyWire,
  sajtToLegacyWire,
  toWireDocument,
  wireFormatOfSchema,
} from '../../src/abap_cli/formats/appjob/wire.js';
import { routeAffSchema, schemaFileFor } from '../../src/abap_cli/aff/router.js';
import { schemaPathFor } from '../../src/abap_cli/aff/schema-paths.js';
import { CliError } from '../../src/abap_cli/output/json.js';

const SAJC_DOC: SajcLocal = {
  formatVersion: '1',
  header: { description: 'Daily reminder catalog', originalLanguage: 'en' },
  generalInformation: { className: 'ZCL_MY_JOB' },
  exitClasses: { check: 'ZCL_MY_CHECK', valueHelp: 'ZCL_MY_VH' },
};

const SAJT_DOC: SajtLocal = {
  formatVersion: '1',
  header: { description: 'Daily reminder template', originalLanguage: 'en' },
  generalInformation: { catalogName: 'ZCLI_SAJC_DAILY' },
  parameters: {
    valueRangesParameters: [
      {
        name: 'P_DATE',
        valueRanges: [{ sign: 'include', option: 'equals', low: '2026-11-03' }],
      },
    ],
  },
};

const ADT = 'http://www.sap.com/adt/core';
const BLUE = 'http://www.sap.com/wbobj/blue';

const SAJC_META_XML =
  '<?xml version="1.0" encoding="utf-8"?>' +
  `<blue:blueSource abapsource:sourceUri="./zcli_sajc_daily/source/main" adtcore:responsible="SAP103" adtcore:masterLanguage="EN"` +
  ' adtcore:abapLanguageVersion="0" adtcore:name="ZCLI_SAJC_DAILY" adtcore:type="SAJC" adtcore:version="active"' +
  ` adtcore:description="Daily reminder catalog" adtcore:language="EN" xmlns:blue="${BLUE}" xmlns:adtcore="${ADT}">` +
  '<atom:link href="./zcli_sajc_daily/source/main" rel="http://www.sap.com/adt/relations/source" type="application/json"/>' +
  '<adtcore:packageRef adtcore:name="$TMP"/></blue:blueSource>';

describe('application job AFF documents', () => {
  it('accepts the upstream-style SAJC document', async () => {
    expect(await sajcArtifact.validate(SAJC_DOC)).toEqual([]);
  });

  it('accepts the upstream-style SAJT document', async () => {
    expect(await sajtArtifact.validate(SAJT_DOC)).toEqual([]);
  });

  it('rejects unknown fields and missing required sections', async () => {
    const unknown = await sajcArtifact.validate({ ...SAJC_DOC, unexpected: true });
    expect(unknown.join('; ')).toMatch(/unexpected|additional properties/);
    const missing = await sajtArtifact.validate({
      formatVersion: '1',
      header: { description: 'x', originalLanguage: 'en' },
    });
    expect(missing.join('; ')).toMatch(/generalInformation/);
  });

  it('maps .sajc.json / .sajt.json filenames to their types and schemas', () => {
    expect(routeAffSchema('src/zcli_daily.sajc.json')).toMatchObject({
      type: 'SAJC',
      isJson: true,
      schemaFile: 'sajc-v1.json',
    });
    expect(routeAffSchema('src/zcli_daily.sajt.json')).toMatchObject({
      type: 'SAJT',
      isJson: true,
      schemaFile: 'sajt-v1.json',
    });
    expect(schemaFileFor('SAJC')).toBe('sajc-v1.json');
    expect(schemaPathFor('SAJT')).toMatch(/sajt-v1\.json$/);
  });
});

describe('application job legacy wire translation', () => {
  it('maps AFF SAJC onto the flat className/reportName document', () => {
    expect(sajcToLegacyWire(SAJC_DOC)).toEqual({
      formatVersion: '1',
      header: { description: 'Daily reminder catalog', originalLanguage: 'en' },
      className: 'ZCL_MY_JOB',
      checkExitClass: 'ZCL_MY_CHECK',
      valueHelpExitClass: 'ZCL_MY_VH',
    });
    // reportName is the flat name of AFF generalInformation.programName.
    expect(
      sajcToLegacyWire({
        formatVersion: '1',
        header: { description: 'report based', originalLanguage: 'en' },
        generalInformation: { className: '', programName: 'RSPARAM' },
      }),
    ).toMatchObject({ className: '', reportName: 'RSPARAM' });
  });

  it('maps the flat SAJC document back to AFF', () => {
    expect(
      sajcFromLegacyWire({
        formatVersion: '1',
        header: { description: 'Daily reminder catalog', originalLanguage: 'en' },
        className: 'ZCL_MY_JOB',
        checkExitClass: 'ZCL_MY_CHECK',
      }),
    ).toEqual({
      formatVersion: '1',
      header: { description: 'Daily reminder catalog', originalLanguage: 'en' },
      generalInformation: { className: 'ZCL_MY_JOB' },
      exitClasses: { check: 'ZCL_MY_CHECK' },
    });
  });

  it('round-trips an AFF document through the legacy model without loss', () => {
    const wire = sajcToLegacyWire(SAJC_DOC);
    expect(sajcFromLegacyWire(wire)).toEqual(SAJC_DOC);
    const tplWire = sajtToLegacyWire(SAJT_DOC);
    expect(sajtFromLegacyWire(tplWire)).toEqual(SAJT_DOC);
  });

  it('maps AFF SAJT parameters onto the flat ranged-parameter list', () => {
    expect(sajtToLegacyWire(SAJT_DOC)).toEqual({
      formatVersion: '1',
      header: { description: 'Daily reminder template', originalLanguage: 'en' },
      catalogName: 'ZCLI_SAJC_DAILY',
      parameters: [
        {
          name: 'P_DATE',
          valueRanges: [{ sign: 'include', option: 'equals', low: '2026-11-03' }],
        },
      ],
    });
  });

  it('rejects AFF fields the legacy model cannot carry instead of dropping them', () => {
    const withNotification: SajcLocal = {
      ...SAJC_DOC,
      exitClasses: { ...SAJC_DOC.exitClasses, notification: 'ZCL_MY_NOTIFY' },
    };
    expect(() => sajcToLegacyWire(withNotification)).toThrowError(CliError);
    try {
      sajcToLegacyWire({ ...withNotification, sections: [{ name: '1', title: 'General' }] });
    } catch (error: unknown) {
      expect((error as CliError).code).toBe('VALIDATION_ERROR');
      expect((error as CliError).details?.unsupportedFields).toEqual([
        'exitClasses.notification',
        'sections',
      ]);
    }
    const withSingleValues: SajtLocal = {
      ...SAJT_DOC,
      parameters: { ...SAJT_DOC.parameters, singleValueParameters: [{ name: 'P_X', value: 'A' }] },
    };
    expect(() => sajtToLegacyWire(withSingleValues)).toThrowError(/singleValueParameters/);
  });
});

describe('application job wire-model detection', () => {
  it('detects the model from the $schema sub-resource', () => {
    expect(
      wireFormatOfSchema(
        'SAJC',
        JSON.stringify({ properties: { className: {}, reportName: {} } }),
      ),
    ).toBe('legacy');
    expect(
      wireFormatOfSchema(
        'SAJT',
        JSON.stringify({ properties: { generalInformation: {}, parameters: {} } }),
      ),
    ).toBe('nested');
    expect(() => wireFormatOfSchema('SAJC', JSON.stringify({ properties: { other: {} } }))).toThrowError(
      /Cannot determine the SAJC JSON model/,
    );
    expect(() => wireFormatOfSchema('SAJC', 'not json')).toThrowError(/non-JSON/);
  });

  it('maps a legacy source document to AFF and reports the model', () => {
    const parsed = fromWireDocument(
      'SAJT',
      JSON.stringify({
        formatVersion: '1',
        header: { description: 'tpl', originalLanguage: 'en' },
        catalogName: 'ZCLI_SAJC_DAILY',
      }),
    );
    expect(parsed.format).toBe('legacy');
    expect(parsed.doc).toMatchObject({ generalInformation: { catalogName: 'ZCLI_SAJC_DAILY' } });
  });

  it('passes a nested AFF source document through unchanged', () => {
    const parsed = fromWireDocument('SAJC', JSON.stringify(SAJC_DOC));
    expect(parsed.format).toBe('nested');
    expect(parsed.doc).toEqual(SAJC_DOC);
  });

  it('serialises the correct wire document for each model', () => {
    expect(JSON.parse(toWireDocument('SAJC', SAJC_DOC, 'nested'))).toEqual(SAJC_DOC);
    expect(JSON.parse(toWireDocument('SAJC', SAJC_DOC, 'legacy'))).toMatchObject({
      className: 'ZCL_MY_JOB',
    });
  });
});

describe('application job ADT wire', () => {
  it('builds the blueSource create body', () => {
    const body = buildAppJobCreateBody('SAJC', 'ZCLI_SAJC_DAILY', {
      packageName: '$TMP',
      description: 'Daily reminder catalog',
      language: 'EN',
    });
    expect(body).toContain('<blue:blueSource');
    expect(body).toContain('adtcore:name="ZCLI_SAJC_DAILY"');
    expect(body).toContain('adtcore:type="SAJC"');
    expect(body).toContain('adtcore:packageRef adtcore:name="$TMP"');
  });

  it('projects the metadata XML onto the AFF header + package', () => {
    expect(parseAppJobMeta('SAJC', SAJC_META_XML)).toEqual({
      header: { description: 'Daily reminder catalog', originalLanguage: 'en' },
      packageName: '$TMP',
    });
  });

  it('uses the AFF originalLanguage as the object master language on create', () => {
    const body = buildAppJobCreateBody('SAJT', 'ZCLI_SAJT_DAILY', {
      packageName: '$TMP',
      description: 'Daily reminder template',
      language: 'ZH',
      originalLanguage: 'en',
    });
    expect(body).toContain('adtcore:language="ZH"');
    expect(body).toContain('adtcore:masterLanguage="EN"');
  });

  it('rejects a response without the blueSource root', () => {
    expect(() => parseAppJobMeta('SAJC', '<foo/>')).toThrowError(/blueSource/);
  });

  it('builds lower-case resource URLs and the $schema URL', () => {
    expect(appJobObjectUrl('SAJC', 'ZCLI_SAJC_DAILY')).toBe(
      '/sap/bc/adt/applicationjob/catalogs/zcli_sajc_daily',
    );
    expect(appJobSourceUrl('SAJT', 'ZCLI_SAJT_DAILY')).toBe(
      '/sap/bc/adt/applicationjob/templates/zcli_sajt_daily/source/main',
    );
    expect(appJobSchemaUrl('SAJC')).toBe('/sap/bc/adt/applicationjob/catalogs/$schema');
    expect(APPJOB_INFO.SAJC.objtype).toBe('SAJC');
    expect(APPJOB_INFO.SAJT.maxNameLength).toBe(40);
  });
});
