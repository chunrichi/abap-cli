/**
 * CDS technical objects — AFF documents + ADT wire mapping.
 *
 * Pins the two wire families: the versioned XML metadata of DTDC / DTEB, the
 * blueSource envelope of DSFD / DSFI, and DSFI's JSON-in-`source/main` shape
 * (including SAP's empty `abapLanguageVersion` and the `_ANA` engine suffix).
 */
import { describe, expect, it } from 'vitest';
import {
  CDS_TECH_INFO,
  buildCdsTechCreateBody,
  buildDsfiSource,
  cdsTechObjectUrl,
  cdsTechSourceUrl,
  parseCdsTechMeta,
  parseDsfiSource,
  rethrowCdsFeatureError,
  rethrowDsfdFeatureError,
  rethrowDrtyFeatureError,
  validateDsfiDocument,
} from '../../src/abap_cli/clients/cds-tech.js';
import {
  dsfdArtifact,
  dsfiArtifact,
  drtyArtifact,
  dtdcArtifact,
  dtebArtifact,
  type DsfiLocal,
} from '../../src/abap_cli/formats/cds-tech/json.js';
import { CliError } from '../../src/abap_cli/output/json.js';

const ADT = 'http://www.sap.com/adt/core';

const DTDC_XML =
  '<?xml version="1.0" encoding="utf-8"?>' +
  `<dtdc:dtdcSource abapsource:sourceUri="./zcli_tc_dtdc/source/main" adtcore:responsible="SAP103" adtcore:masterLanguage="EN"` +
  ' adtcore:abapLanguageVersion="0" adtcore:name="ZCLI_TC_DTDC" adtcore:type="DTDC/DF" adtcore:version="active"' +
  ` adtcore:description="probe dynamic cache" adtcore:language="ZH" xmlns:dtdc="http://www.sap.com/adt/ddic/dtdcsources" xmlns:adtcore="${ADT}">` +
  `<adtcore:packageRef adtcore:uri="/sap/bc/adt/packages/%24tmp" adtcore:type="DEVC/K" adtcore:name="$TMP"/>` +
  '</dtdc:dtdcSource>';

const DTEB_XML = DTDC_XML
  .replace('dtdc:dtdcSource', 'dteb:dtebSource')
  .replace('xmlns:dtdc="http://www.sap.com/adt/ddic/dtdcsources"', 'xmlns:dteb="http://www.sap.com/adt/ddic/dtebsources"')
  .replace('ZCLI_TC_DTDC', 'ZCLI_TC_DTEB')
  .replace('DTDC/DF', 'DTEB/DF');

const DSFD_XML =
  '<?xml version="1.0" encoding="utf-8"?>' +
  `<blue:blueSource abapsource:sourceUri="./zcli_tc_dsfd/source/main" adtcore:responsible="SAP103" adtcore:masterLanguage="EN"` +
  ' adtcore:abapLanguageVersion="0" adtcore:name="ZCLI_TC_DSFD" adtcore:type="DSFD/SCF" adtcore:version="active"' +
  ` adtcore:description="probe scalar function" adtcore:language="ZH" xmlns:blue="http://www.sap.com/wbobj/blue" xmlns:adtcore="${ADT}">` +
  '<adtcore:packageRef adtcore:name="$TMP"/></blue:blueSource>';

describe('CDS technical wire → AFF header', () => {
  it('projects DTDC / DTEB metadata headers', () => {
    expect(parseCdsTechMeta('DTDC', DTDC_XML)).toEqual({
      header: { description: 'probe dynamic cache', originalLanguage: 'en' },
      packageName: '$TMP',
    });
    expect(parseCdsTechMeta('DTEB', DTEB_XML)).toMatchObject({
      header: { description: 'probe dynamic cache', originalLanguage: 'en' },
      packageName: '$TMP',
    });
  });

  it('projects the DSFD blueSource metadata header', () => {
    expect(parseCdsTechMeta('DSFD', DSFD_XML)).toEqual({
      header: { description: 'probe scalar function', originalLanguage: 'en' },
      packageName: '$TMP',
    });
  });

  it('maps abapLanguageVersion="5" to cloudDevelopment and omits standard', () => {
    const cloud = DSFD_XML.replace('adtcore:abapLanguageVersion="0"', 'adtcore:abapLanguageVersion="5"');
    expect(parseCdsTechMeta('DSFD', cloud).header.abapLanguageVersion).toBe('cloudDevelopment');
    expect(parseCdsTechMeta('DSFD', DSFD_XML).header.abapLanguageVersion).toBeUndefined();
  });

  it('projects the DRTY blueSource metadata header', () => {
    const drtyXml = DSFD_XML.replace('DSFD/SCF', 'DRTY/STY').replace('probe scalar function', 'probe CDS type');
    expect(parseCdsTechMeta('DRTY', drtyXml)).toEqual({
      header: { description: 'probe CDS type', originalLanguage: 'en' },
      packageName: '$TMP',
    });
  });

  it('rejects a body without the expected root element', () => {
    expect(() => parseCdsTechMeta('DSFD', DTDC_XML)).toThrowError(/expected <blueSource>/);
  });
});

describe('create body', () => {
  it('builds the DTDC resource root with description and package', () => {
    const body = buildCdsTechCreateBody('DTDC', 'ZCLI_TC_DTDC', {
      packageName: '$TMP',
      description: 'probe dynamic cache',
      language: 'en',
      originalLanguage: 'en',
    });
    expect(body).toContain('<dtdc:dtdcSource');
    expect(body).toContain('xmlns:dtdc="http://www.sap.com/adt/ddic/dtdcsources"');
    expect(body).toContain('adtcore:type="DTDC/DF"');
    expect(body).toContain('adtcore:description="probe dynamic cache"');
    expect(body).toContain('<adtcore:packageRef adtcore:name="$TMP"/>');
  });

  it('builds a blueSource body for DSFD / DSFI / DRTY', () => {
    for (const type of ['DSFD', 'DSFI', 'DRTY'] as const) {
      const body = buildCdsTechCreateBody(type, 'ZCLI_TC_X', { description: 'd', packageName: 'ZPKG', language: 'EN' });
      expect(body).toContain('<blue:blueSource');
      expect(body).toContain(`adtcore:type="${CDS_TECH_INFO[type].objtype}"`);
      expect(body).toContain('<adtcore:packageRef adtcore:name="ZPKG"/>');
    }
  });

  it('omits the package reference on update bodies', () => {
    const body = buildCdsTechCreateBody('DTEB', 'ZCLI_TC_DTEB', { description: 'd', language: 'EN' });
    expect(body).not.toContain('packageRef');
  });

  it('URLs and media types match the ADT resources', () => {
    expect(cdsTechObjectUrl('DTDC', 'ZCLI_TC_DTDC')).toBe('/sap/bc/adt/ddic/dtdc/sources/zcli_tc_dtdc');
    expect(cdsTechObjectUrl('DSFI', 'RATIO_OF_ANA')).toBe('/sap/bc/adt/ddic/dsfi/ratio_of_ana');
    expect(cdsTechSourceUrl('DSFD', 'ZCLI_TC_DSFD')).toBe('/sap/bc/adt/ddic/dsfd/sources/zcli_tc_dsfd/source/main');
    expect(CDS_TECH_INFO.DSFD.createMediaType).toBe('application/vnd.sap.adt.blues.v1+xml');
    expect(CDS_TECH_INFO.DSFD.featureParameter).toBe('DD_CDS_DSFD');
    expect(CDS_TECH_INFO.DSFI.sourceMediaType).toBe('application/json');
    expect(CDS_TECH_INFO.DRTY.objtype).toBe('DRTY/STY');
    expect(CDS_TECH_INFO.DRTY.featureParameter).toBe('CDS_SIMPLE_TYPES');
  });
});

describe('DSFI document', () => {
  const goodDoc: DsfiLocal = {
    formatVersion: '1',
    header: { description: 'probe impl', originalLanguage: 'en' },
    scalarFunctionName: 'ZCLI_TC_FUNC',
    engine: 'analyticalEngine',
  };

  it('normalises the wire JSON SAP serves (empty abapLanguageVersion, server language)', () => {
    const wire = JSON.stringify({
      formatVersion: '1',
      header: { description: 'probe impl', originalLanguage: 'zh', abapLanguageVersion: '' },
      scalarFunctionName: 'ZCLI_TC_FUNC',
      engine: 'analyticalEngine',
    });
    expect(parseDsfiSource(wire)).toEqual({
      formatVersion: '1',
      header: { description: 'probe impl', originalLanguage: 'zh' },
      scalarFunctionName: 'ZCLI_TC_FUNC',
      engine: 'analyticalEngine',
    });
  });

  it('keeps SQL properties and a valid language version', () => {
    const wire = JSON.stringify({
      formatVersion: '1',
      header: { description: 'd', originalLanguage: 'en', abapLanguageVersion: 'cloudDevelopment' },
      scalarFunctionName: 'ZCLI_TC_FUNC',
      engine: 'sqlEngine',
      sqlProperties: { amdpReference: 'ZCL_X=>EXECUTE', autoExposedInSqlServices: true },
    });
    expect(parseDsfiSource(wire)).toMatchObject({
      header: { abapLanguageVersion: 'cloudDevelopment' },
      engine: 'sqlEngine',
      sqlProperties: { amdpReference: 'ZCL_X=>EXECUTE', autoExposedInSqlServices: true },
    });
  });

  it('round-trips through buildDsfiSource', () => {
    expect(parseDsfiSource(buildDsfiSource(goodDoc))).toEqual(goodDoc);
  });

  it('rejects a non-JSON source', () => {
    expect(() => parseDsfiSource('define scalar function zcli_x')).toThrowError(/not JSON/);
  });

  it('validates the _ANA name / scalarFunctionName / engine contract', () => {
    expect(validateDsfiDocument('ZCLI_TC_FUNC_ANA', goodDoc)).toEqual({
      scalarFunctionName: 'ZCLI_TC_FUNC',
      engine: 'analyticalEngine',
    });
    expect(() => validateDsfiDocument('ZCLI_TC_FUNC', goodDoc)).toThrowError(/engine suffix/);
    expect(() => validateDsfiDocument('ZCLI_TC_FUNC_ANA', { ...goodDoc, scalarFunctionName: 'OTHER' })).toThrowError(/references scalar function/);
    expect(() => validateDsfiDocument('ZCLI_TC_FUNC_ANA', { ...goodDoc, engine: 'sqlEngine' })).toThrowError(/engine/);
  });

  it('maps the SAP DSFD feature-gate rejection to an actionable error', () => {
    const sapError = new CliError('SAP_ERROR', 'Insufficient authorizations for modifying CDS Scalar Function ZCLI_TC_DSFD.');
    try {
      rethrowDsfdFeatureError(sapError);
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      expect((error as CliError).code).toBe('DSFD_FEATURE_NOT_ENABLED');
      expect((error as CliError).nextSteps?.join(' ')).toContain('DD_CDS_DSFD');
    }
    // Unrelated errors pass through untouched.
    const other = new CliError('SAP_ERROR', 'something else');
    expect(() => rethrowDsfdFeatureError(other)).toThrowError(other);
  });

  it('maps the SAP DRTY feature gate and routes the mapping per type', () => {
    const sapError = new CliError('SAP_ERROR', 'CDS types are not yet supported');
    try {
      rethrowDrtyFeatureError(sapError);
      throw new Error('should have thrown');
    } catch (error) {
      expect((error as CliError).code).toBe('DRTY_FEATURE_NOT_ENABLED');
      expect((error as CliError).nextSteps?.join(' ')).toContain('CDS_SIMPLE_TYPES');
    }
    expect(() => rethrowCdsFeatureError('DRTY', sapError)).toThrowError(/CDS simple types/);
    expect(() => rethrowCdsFeatureError('DSFD', new CliError('SAP_ERROR', 'Insufficient authorizations for modifying CDS Scalar Function X'))).toThrowError(/CDS scalar function/);
  });
});

describe('AFF schema validation', () => {
  it('accepts example documents for the four types', async () => {
    expect(await dtdcArtifact.validate({ formatVersion: '1', header: { description: 'x', originalLanguage: 'en' } })).toEqual([]);
    expect(await dtebArtifact.validate({ formatVersion: '1', header: { description: 'x', originalLanguage: 'en' } })).toEqual([]);
    expect(await dsfdArtifact.validate({ formatVersion: '1', header: { description: 'x', originalLanguage: 'en' } })).toEqual([]);
    expect(await drtyArtifact.validate({ formatVersion: '1', header: { description: 'x', originalLanguage: 'en' } })).toEqual([]);
    expect(
      await dsfiArtifact.validate({
        formatVersion: '1',
        header: { description: 'x', originalLanguage: 'en' },
        scalarFunctionName: 'ZCLI_TC_FUNC',
      }),
    ).toEqual([]);
  });

  it('rejects the schema-required fields when missing', async () => {
    expect((await dsfiArtifact.validate({ formatVersion: '1', header: { description: 'x', originalLanguage: 'en' } })).length).toBeGreaterThan(0);
    expect((await dsfiArtifact.validate({ formatVersion: '1', scalarFunctionName: 'X' })).length).toBeGreaterThan(0);
  });
});
