/**
 * ATC configuration objects — AFF document + ADT XML projection.
 *
 * Fixtures are trimmed real S/4HANA responses (version attributes, atom links
 * and server bookkeeping removed). They pin the two non-obvious mappings:
 *   - CHKO `parameters[].hidden` is the inverse of `parameterModifiable`
 *   - CHKO `checkType` is carried as the `<chko:remoteEnabled>` boolean
 * and the CHKV `parameterValueXml` JSON fragment (the AFF check object).
 */
import { describe, expect, it } from 'vitest';
import {
  buildAtcBody,
  parseAtcObject,
  parseAtcPackageName,
  atcObjectUrl,
  atcMediaType,
  ATC_TYPE_INFO,
} from '../../src/abap_cli/clients/atc.js';
import { chkcArtifact, chkoArtifact, chkvArtifact } from '../../src/abap_cli/formats/atc/json.js';

const CHKC_XML =
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<chkc:checkCategoryObject adtcore:responsible="SAP103" adtcore:masterLanguage="EN" adtcore:abapLanguageVersion="0"' +
  ' adtcore:name="ZCLI_TC_CHKC" adtcore:type="CHKC/TYP" adtcore:version="active" adtcore:description="probe category"' +
  ' adtcore:language="EN" xmlns:chkc="http://www.sap.com/wbobj/atc/chkc" xmlns:adtcore="http://www.sap.com/adt/core">' +
  '<atom:link href="versions" rel="http://www.sap.com/adt/relations/versions" xmlns:atom="http://www.w3.org/2005/Atom"/>' +
  '<adtcore:packageRef adtcore:uri="/sap/bc/adt/packages/%24tmp" adtcore:type="DEVC/K" adtcore:name="$TMP"/>' +
  '<chkc:content><chkc:category/></chkc:content></chkc:checkCategoryObject>';

const CHKC_CHILD_XML = CHKC_XML
  .replace('adtcore:name="ZCLI_TC_CHKC"', 'adtcore:name="ZCLI_TC_CHKC2"')
  .replace('<chkc:content><chkc:category/></chkc:content>', '<chkc:content><chkc:category adtcore:name="ZCLI_TC_CHKC"/></chkc:content>');

const CHKO_XML =
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<chko:checkObject adtcore:responsible="SAP103" adtcore:masterLanguage="EN" adtcore:abapLanguageVersion="0"' +
  ' adtcore:name="ZCLI_TC_CHKO" adtcore:type="CHKO/TYP" adtcore:version="active" adtcore:description="probe check"' +
  ' adtcore:language="EN" xmlns:chko="http://www.sap.com/wbobj/atc/chko" xmlns:adtcore="http://www.sap.com/adt/core">' +
  '<adtcore:packageRef adtcore:uri="/sap/bc/adt/packages/%24tmp" adtcore:type="DEVC/K" adtcore:name="$TMP"/>' +
  '<chko:content>' +
  '<chko:category adtcore:name="ZCLI_TC_CHKC"/>' +
  '<chko:implementingClass adtcore:name="ZCL_CLI_TC_CHECK"/>' +
  '<chko:remoteEnabled>true</chko:remoteEnabled>' +
  '<chkoParameter:parameters xmlns:chkoParameter="http://www.sap.com/wbobj/atc/chkoParameter">' +
  '<chkoParameter:parameter><chkoParameter:parameterTechnicalId>1</chkoParameter:parameterTechnicalId>' +
  '<chkoParameter:parameterName>THRESHOLD</chkoParameter:parameterName>' +
  '<chkoParameter:parameterDescription>Probe threshold</chkoParameter:parameterDescription>' +
  '<chkoParameter:parameterModifiable>false</chkoParameter:parameterModifiable></chkoParameter:parameter>' +
  '</chkoParameter:parameters></chko:content></chko:checkObject>';

const CHKV_XML =
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<chkv:checkvariant adtcore:responsible="SAP103" adtcore:masterLanguage="EN" adtcore:abapLanguageVersion="0"' +
  ' adtcore:name="ZCLI_TC_CHKV" adtcore:type="CHKV/TYP" adtcore:version="active" adtcore:description="probe variant"' +
  ' adtcore:language="EN" xmlns:chkv="http://www.sap.com/wbobj/atc/chkv" xmlns:adtcore="http://www.sap.com/adt/core">' +
  '<adtcore:packageRef adtcore:uri="/sap/bc/adt/packages/%24tmp" adtcore:type="DEVC/K" adtcore:name="$TMP"/>' +
  '<chkv:content><chkv:name>ZCLI_TC_CHKV</chkv:name><chkv:remoteEnabled>false</chkv:remoteEnabled><chkv:referencedVariant/>' +
  '<chkvcheck:check xmlns:chkvcheck="http://www.sap.com/wbobj/atc/chkvCheck">' +
  '<chko:checkObject adtcore:name="ZCLI_TC_CHKO" xmlns:chko="http://www.sap.com/wbobj/atc/chko"><chko:content/></chko:checkObject>' +
  '<chkvcheck:parameterValueXml>{"checkName": "ZCLI_TC_CHKO", "parameters": [{"name": "THRESHOLD", "value": "10"}]}</chkvcheck:parameterValueXml>' +
  '</chkvcheck:check></chkv:content></chkv:checkvariant>';

describe('ATC wire → AFF projection', () => {
  it('projects a CHKC root category', () => {
    expect(parseAtcObject('CHKC', CHKC_XML)).toEqual({
      formatVersion: '1',
      header: { description: 'probe category', originalLanguage: 'en' },
    });
  });

  it('projects a CHKC parent category', () => {
    expect(parseAtcObject('CHKC', CHKC_CHILD_XML)).toMatchObject({ parentCategory: 'ZCLI_TC_CHKC' });
  });

  it('projects CHKO checkType and inverts parameterModifiable into hidden', () => {
    const doc = parseAtcObject('CHKO', CHKO_XML);
    expect(doc).toMatchObject({
      category: 'ZCLI_TC_CHKC',
      implementingClass: 'ZCL_CLI_TC_CHECK',
      checkType: 'remoteEnabled',
      parameters: [{ name: 'THRESHOLD', description: 'Probe threshold', hidden: true }],
    });
  });

  it('projects the CHKV parameterValueXml JSON fragments', () => {
    const doc = parseAtcObject('CHKV', CHKV_XML);
    expect(doc).toEqual({
      formatVersion: '1',
      header: { description: 'probe variant', originalLanguage: 'en' },
      selectedChecks: [{ checkName: 'ZCLI_TC_CHKO', parameters: [{ name: 'THRESHOLD', value: '10' }] }],
    });
  });

  it('reads the package name used by delete/transport rules', () => {
    expect(parseAtcPackageName('CHKC', CHKC_XML)).toBe('$TMP');
    expect(parseAtcPackageName('CHKO', CHKO_XML)).toBe('$TMP');
    expect(parseAtcPackageName('CHKV', CHKV_XML)).toBe('$TMP');
  });

  it('URLs and media types match the ADT resources', () => {
    expect(atcObjectUrl('CHKC', 'ZCLI_TC_CHKC')).toBe('/sap/bc/adt/atc/checkcategories/zcli_tc_chkc');
    expect(atcObjectUrl('CHKO', '/NS/CHECK')).toBe('/sap/bc/adt/atc/checks/%2Fns%2Fcheck');
    expect(atcMediaType('CHKC')).toBe('application/vnd.sap.adt.chkcv1+xml');
    expect(atcMediaType('CHKO')).toBe('application/vnd.sap.adt.chkov1+xml');
    expect(atcMediaType('CHKV')).toBe('application/vnd.sap.adt.chkvv4+xml');
    expect(ATC_TYPE_INFO.CHKV.objtype).toBe('CHKV/TYP');
  });
});

describe('AFF → wire body', () => {
  const meta = { packageName: '$TMP', language: 'EN' };

  it('round-trips CHKC', () => {
    const doc = parseAtcObject('CHKC', CHKC_CHILD_XML) as Parameters<typeof buildAtcBody>[2];
    const wire = buildAtcBody('CHKC', 'ZCLI_TC_CHKC2', doc, meta);
    expect(wire).toContain('adtcore:name="ZCLI_TC_CHKC2"');
    expect(wire).toContain('adtcore:type="CHKC/TYP"');
    expect(wire).toContain('<adtcore:packageRef adtcore:name="$TMP"/>');
    expect(wire).toContain('<chkc:category adtcore:name="ZCLI_TC_CHKC"/>');
    expect(parseAtcObject('CHKC', wire)).toEqual(doc);
  });

  it('round-trips CHKO (hidden → parameterModifiable)', () => {
    const doc = parseAtcObject('CHKO', CHKO_XML) as Parameters<typeof buildAtcBody>[2];
    const wire = buildAtcBody('CHKO', 'ZCLI_TC_CHKO', doc, meta);
    expect(wire).toContain('<chko:remoteEnabled>true</chko:remoteEnabled>');
    expect(wire).toContain('<chkoParameter:parameterModifiable>false</chkoParameter:parameterModifiable>');
    expect(parseAtcObject('CHKO', wire)).toEqual(doc);
  });

  it('round-trips CHKV and preserves parameter shapes', () => {
    const doc = parseAtcObject('CHKV', CHKV_XML) as Parameters<typeof buildAtcBody>[2];
    const wire = buildAtcBody('CHKV', 'ZCLI_TC_CHKV', doc, meta);
    expect(wire).toContain('<chkv:remoteEnabled>false</chkv:remoteEnabled>');
    expect(wire).toContain('{"checkName":"ZCLI_TC_CHKO","parameters":[{"name":"THRESHOLD","value":"10"}]}');
    expect(parseAtcObject('CHKV', wire)).toEqual(doc);
  });

  it('omits the package reference on update bodies', () => {
    const doc = parseAtcObject('CHKC', CHKC_XML) as Parameters<typeof buildAtcBody>[2];
    const wire = buildAtcBody('CHKC', 'ZCLI_TC_CHKC', doc, { language: 'EN' });
    expect(wire).not.toContain('packageRef');
  });

  it('maps cloudDevelopment to abapLanguageVersion="5"', () => {
    const wire = buildAtcBody(
      'CHKC',
      'ZCLI_TC_CHKC',
      {
        formatVersion: '1',
        header: { description: 'cloud category', originalLanguage: 'en', abapLanguageVersion: 'cloudDevelopment' },
      },
      meta,
    );
    expect(wire).toContain('adtcore:abapLanguageVersion="5"');
  });
});

describe('AFF schema validation', () => {
  it('accepts example documents for all three types', async () => {
    expect(await chkcArtifact.validate({ formatVersion: '1', header: { description: 'x', originalLanguage: 'en' } })).toEqual([]);
    expect(
      await chkoArtifact.validate({
        formatVersion: '1',
        header: { description: 'x', originalLanguage: 'en' },
        category: 'ZCAT',
        implementingClass: 'ZCL_CHECK',
      }),
    ).toEqual([]);
    expect(
      await chkvArtifact.validate({
        formatVersion: '1',
        header: { description: 'x', originalLanguage: 'en' },
        selectedChecks: [{ checkName: 'ZCL_CHECK' }],
      }),
    ).toEqual([]);
  });

  it('rejects documents missing the schema-required fields', async () => {
    expect((await chkoArtifact.validate({ formatVersion: '1', header: { description: 'x', originalLanguage: 'en' } })).length).toBeGreaterThan(0);
    expect(
      (await chkvArtifact.validate({ formatVersion: '1', header: { description: 'x', originalLanguage: 'en' }, selectedChecks: [] })).length,
    ).toBeGreaterThan(0);
  });
});
