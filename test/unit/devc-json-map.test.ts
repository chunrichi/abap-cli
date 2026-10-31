/**
 * DEVC wire ↔ AFF mapping.
 *
 * The XML samples are trimmed copies of real `GET /sap/bc/adt/packages/<name>`
 * responses (S/4HANA): `$TMP` (LOCAL, no super package), a sub package with the
 * cloud ABAP language version, and a namespaced package with switch,
 * application component and use accesses. Every mapped document must validate
 * against the vendored `devc-v1.json`.
 */
import { describe, expect, it } from 'vitest';
import {
  buildCreateWire,
  isLocalSoftwareComponent,
  validateLocalPackageName,
  wireToLocal,
} from '../../src/abap_cli/formats/devc/json.js';
import { validateAff } from '../../src/abap_cli/aff/schema-validator.js';

const TMP_XML = `<?xml version="1.0" encoding="utf-8"?><pak:package adtcore:responsible="SAP" adtcore:masterLanguage="ZH" adtcore:name="$TMP" adtcore:type="DEVC/K" adtcore:changedAt="1972-04-01T00:00:00Z" adtcore:version="active" adtcore:createdAt="1972-04-01T00:00:00Z" adtcore:changedBy="SAP" adtcore:createdBy="SAP" adtcore:description="Temporary Objects (never transported!)" adtcore:descriptionTextLimit="60" adtcore:language="ZH" xmlns:pak="http://www.sap.com/adt/packages" xmlns:adtcore="http://www.sap.com/adt/core"><atom:link href="versions" rel="http://www.sap.com/adt/relations/versions"/><adtcore:packageRef adtcore:uri="/sap/bc/adt/packages/%24tmp" adtcore:type="DEVC/K" adtcore:name="$TMP"/><pak:attributes pak:packageType="development" pak:isAddingObjectsAllowed="false" pak:isEncapsulated="false" pak:recordChanges="false" pak:languageVersion=""/><pak:superPackage/><pak:applicationComponent pak:name="" pak:description="No application component assigned"/><pak:transport><pak:softwareComponent pak:name="LOCAL" pak:description="局部开发（无自动传输）"/><pak:transportLayer pak:name=""/></pak:transport><pak:useAccesses pak:isVisible="false"/><pak:packageInterfaces pak:isVisible="false"/><pak:subPackages/></pak:package>`;

const CLOUD_SUB_XML = `<?xml version="1.0" encoding="utf-8"?><pak:package adtcore:responsible="SAP098" adtcore:masterLanguage="EN" adtcore:masterSystem="S4H" adtcore:name="ZDEV098" adtcore:type="DEVC/K" adtcore:version="active" adtcore:description="098 dev package" adtcore:language="ZH" xmlns:pak="http://www.sap.com/adt/packages" xmlns:adtcore="http://www.sap.com/adt/core"><pak:attributes pak:packageType="development" pak:isAddingObjectsAllowed="false" pak:isEncapsulated="true" pak:recordChanges="true" pak:languageVersion="5"/><pak:superPackage adtcore:uri="/sap/bc/adt/packages/zlocal" adtcore:type="DEVC/K" adtcore:name="ZLOCAL"/><pak:applicationComponent pak:name=""/><pak:transport><pak:softwareComponent pak:name="ZLOCAL" pak:description=""/><pak:transportLayer pak:name=""/></pak:transport><pak:useAccesses pak:isVisible="true"/><pak:subPackages/></pak:package>`;

const SWITCHED_XML = `<?xml version="1.0" encoding="utf-8"?><pak:package adtcore:responsible="DEVELOPER" adtcore:masterLanguage="EN" adtcore:name="/ACCGO/ACMCM_BW" adtcore:type="DEVC/K" adtcore:version="active" adtcore:description="ACM BW" adtcore:language="EN" xmlns:pak="http://www.sap.com/adt/packages" xmlns:adtcore="http://www.sap.com/adt/core"><pak:attributes pak:packageType="development" pak:isAddingObjectsAllowed="false" pak:isEncapsulated="true" pak:recordChanges="true" pak:languageVersion=""/><pak:superPackage adtcore:type="DEVC/K" adtcore:name="/ACCGO/ACMCM_INT"/><pak:switch adtcore:type="SFSW/6S" adtcore:name="/ACCGO/SWITCH_ECC" adtcore:description="switch"/><pak:applicationComponent pak:name="LO-AGR" pak:description="SAP Agricultural Contract Management"/><pak:transport><pak:softwareComponent pak:name="IS-OIL"/><pak:transportLayer pak:name="SAP"/></pak:transport><pak:useAccesses pak:isVisible="true"><pak:useAccess pak:severity="none"><pak:packageInterfaceRef adtcore:type="PINF/KI" adtcore:name="_AKB_INITIAL"/><pak:packageRef adtcore:type="DEVC/K" adtcore:name="SABP_MAIN"/></pak:useAccess><pak:useAccess pak:severity="warning"><pak:packageInterfaceRef adtcore:type="PINF/KI" adtcore:name="SABP_UNIT_PUBLIC"/></pak:useAccess></pak:useAccesses><pak:packageInterfaces pak:isVisible="true"/><pak:subPackages/></pak:package>`;

async function expectAffValid(doc: unknown): Promise<void> {
  const result = await validateAff('DEVC', doc);
  expect(result.status, JSON.stringify(result.errors?.slice(0, 3))).toBe('pass');
}

describe('wireToLocal — $TMP (LOCAL development package)', () => {
  it('maps header + local package flags and validates against devc-v1.json', async () => {
    const doc = wireToLocal(TMP_XML);
    expect(doc).toEqual({
      formatVersion: '1',
      header: { description: 'Temporary Objects (never transported!)', originalLanguage: 'zh' },
      generalInformation: {
        type: 'development',
        softwareComponent: 'LOCAL',
        supportsRecordChanges: false,
        isAddingObjectsNotAllowed: true,
        isEncapsulated: false,
      },
    });
    await expectAffValid(doc);
  });
});

describe('wireToLocal — sub package with super package and cloud language version', () => {
  it('maps superPackage + defaultAbapLanguageVersion (5 → cloudDevelopment)', async () => {
    const doc = wireToLocal(CLOUD_SUB_XML);
    expect(doc.header).toEqual({ description: '098 dev package', originalLanguage: 'en' });
    expect(doc.generalInformation).toMatchObject({
      type: 'development',
      superPackage: 'ZLOCAL',
      softwareComponent: 'ZLOCAL',
      defaultAbapLanguageVersion: 'cloudDevelopment',
      supportsRecordChanges: true,
      isAddingObjectsNotAllowed: true,
      isEncapsulated: true,
    });
    await expectAffValid(doc);
  });

  it('maps the other language-version keys from the SAP value help', () => {
    expect(wireToLocal(CLOUD_SUB_XML.replace('pak:languageVersion="5"', 'pak:languageVersion="0"')).generalInformation?.defaultAbapLanguageVersion).toBe('standard');
    expect(wireToLocal(CLOUD_SUB_XML.replace('pak:languageVersion="5"', 'pak:languageVersion="2"')).generalInformation?.defaultAbapLanguageVersion).toBe('keyUser');
    // Empty value = not set → omitted (AFF default is standard).
    expect(wireToLocal(CLOUD_SUB_XML.replace('pak:languageVersion="5"', 'pak:languageVersion=""')).generalInformation?.defaultAbapLanguageVersion).toBeUndefined();
  });
});

describe('wireToLocal — namespaced package with switch / app component / use accesses', () => {
  it('maps every optional field', async () => {
    const doc = wireToLocal(SWITCHED_XML);
    expect(doc.generalInformation).toEqual({
      type: 'development',
      superPackage: '/ACCGO/ACMCM_INT',
      switch: '/ACCGO/SWITCH_ECC',
      applicationComponent: 'LO-AGR',
      softwareComponent: 'IS-OIL',
      transportLayer: 'SAP',
      supportsRecordChanges: true,
      isAddingObjectsNotAllowed: true,
      isEncapsulated: true,
    });
    expect(doc.useAccesses).toEqual([
      { packageInterface: '_AKB_INITIAL', severity: 'none' },
      { packageInterface: 'SABP_UNIT_PUBLIC', severity: 'warning' },
    ]);
    await expectAffValid(doc);
  });

  it('XML-decodes attribute values', () => {
    const doc = wireToLocal(
      TMP_XML.replace('adtcore:description="Temporary Objects (never transported!)"', 'adtcore:description="A &amp; B &quot;quoted&quot; &lt;tag&gt;"'),
    );
    expect(doc.header.description).toBe('A & B "quoted" <tag>');
  });

  it('throws for a non-package body', () => {
    expect(() => wireToLocal('<foo/>')).toThrow(/missing <pak:package>/);
  });
});

describe('buildCreateWire', () => {
  it('builds the pak:package create body with super package + transport', () => {
    const xml = buildCreateWire({
      name: '$MOCK_PKG',
      description: 'created by test',
      parentName: '$TMP',
      softwareComponent: 'LOCAL',
      transportLayer: '',
      packageType: 'development',
      responsible: 'MOCKUSER',
    });
    expect(xml).toContain('<pak:package');
    expect(xml).toContain('adtcore:name="$MOCK_PKG"');
    expect(xml).toContain('adtcore:type="DEVC/K"');
    expect(xml).toContain('adtcore:responsible="MOCKUSER"');
    expect(xml).toContain('<adtcore:packageRef adtcore:name="$TMP"/>');
    expect(xml).toContain('<pak:superPackage adtcore:name="$TMP"/>');
    expect(xml).toContain('<pak:softwareComponent pak:name="LOCAL"/>');
    expect(xml).toContain('<pak:attributes pak:packageType="development"/>');
  });

  it('escapes attribute values', () => {
    const xml = buildCreateWire({
      name: 'ZPKG',
      description: 'A & B "quoted" <tag>',
      parentName: 'ZPARENT',
      softwareComponent: 'HOME',
      transportLayer: 'SAP',
      packageType: 'main',
      responsible: 'TESTER',
    });
    expect(xml).toContain('adtcore:description="A &amp; B &quot;quoted&quot; &lt;tag&gt;"');
    expect(xml).toContain('<pak:transportLayer pak:name="SAP"/>');
    expect(xml).toContain('<pak:attributes pak:packageType="main"/>');
  });
});

describe('package name rules', () => {
  it('detects LOCAL software components', () => {
    expect(isLocalSoftwareComponent('LOCAL')).toBe(true);
    expect(isLocalSoftwareComponent('local')).toBe(true);
    expect(isLocalSoftwareComponent('HOME')).toBe(false);
    expect(isLocalSoftwareComponent('ZLOCAL')).toBe(false);
  });

  it("requires LOCAL package names to start with '$' or 'TEST'", () => {
    expect(validateLocalPackageName('$MY_PACKAGE')).toBeUndefined();
    expect(validateLocalPackageName('TEST_MY_PACKAGE')).toBeUndefined();
    expect(validateLocalPackageName('ZMY_PACKAGE')).toBe("Names of LOCAL packages must start with '$' or 'TEST'");
  });
});
