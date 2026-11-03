/**
 * Type pool (TYPE) — AFF contract + ADT wire mapping.
 *
 * Pins the upstream AFF layout (`type-v1.json` header + `.type.abap` classic
 * source), the five-character type-pool name rule, and the `atypgr` metadata
 * body used by create / metadata sync.
 */
import { describe, expect, it } from 'vitest';
import {
  TYPEGROUP_MEDIA,
  withTypegroupDescription,
  TYPEGROUP_OBJTYPE,
  assertTypegroupName,
  buildTypegroupBody,
  parseTypegroupMeta,
  typegroupSourceUrl,
  typegroupUrl,
} from '../../src/abap_cli/clients/typegroups.js';
import { typeArtifact, typeSourceFileName } from '../../src/abap_cli/formats/type/json.js';
import { CliError } from '../../src/abap_cli/output/json.js';

const ADT = 'http://www.sap.com/adt/core';
const TYPEGROUP_XML =
  '<?xml version="1.0" encoding="utf-8"?>' +
  `<atypgr:abapTypeGroup abapsource:sourceUri="source/main" abapsource:activeUnicodeCheck="false" adtcore:responsible="SAP103" adtcore:masterLanguage="EN"` +
  ' adtcore:abapLanguageVersion="X" adtcore:name="ZMYTY" adtcore:type="TYPE/DG" adtcore:version="active"' +
  ` adtcore:description="my type pool" adtcore:language="ZH" xmlns:atypgr="http://www.sap.com/adt/ddic/typegroups" xmlns:adtcore="${ADT}">` +
  '<atom:link href="source/main" rel="http://www.sap.com/adt/relations/source" type="text/plain"/>' +
  '<adtcore:packageRef adtcore:name="$TMP"/></atypgr:abapTypeGroup>';

describe('TYPE ADT wire', () => {
  it('projects the atypgr metadata onto the AFF header', () => {
    expect(parseTypegroupMeta(TYPEGROUP_XML)).toEqual({
      header: { description: 'my type pool', originalLanguage: 'en' },
      packageName: '$TMP',
    });
  });

  it('rejects a response without the abapTypeGroup root', () => {
    expect(() => parseTypegroupMeta('<blue:blueSource xmlns:blue="http://www.sap.com/wbobj/blue"/>')).toThrowError(/abapTypeGroup/);
  });

  it('builds the create body with package and description', () => {
    const body = buildTypegroupBody('ZMYTY', {
      packageName: '$TMP',
      description: 'my type pool',
      language: 'en',
      originalLanguage: 'en',
    });
    expect(body).toContain('<atypgr:abapTypeGroup');
    expect(body).toContain('adtcore:name="ZMYTY"');
    expect(body).toContain('adtcore:type="TYPE/DG"');
    expect(body).toContain('adtcore:description="my type pool"');
    expect(body).toContain('<adtcore:packageRef adtcore:name="$TMP"/>');
  });

  it('omits the package reference on metadata updates', () => {
    expect(buildTypegroupBody('ZMYTY', { description: 'new', language: 'EN' })).not.toContain('packageRef');
  });

  it('patches only the description inside SAP metadata (keeps unicode/syntax attrs)', () => {
    const patched = withTypegroupDescription(TYPEGROUP_XML, 'renamed "pool"');
    expect(patched).toContain('adtcore:description="renamed &quot;pool&quot;"');
    expect(patched).toContain('abapsource:activeUnicodeCheck="false"');
    expect(patched).toContain('abapsource:sourceUri="source/main"');
    expect(patched).not.toContain('adtcore:description="my type pool"');
    // A response without the attribute gets it injected next to the type.
    expect(withTypegroupDescription('<atypgr:abapTypeGroup adtcore:type="TYPE/DG"/>', 'x')).toContain('adtcore:description="x"');
  });

  it('URLs / media types / object type match the ADT resource', () => {
    expect(typegroupUrl('zmyty')).toBe('/sap/bc/adt/ddic/typegroups/zmyty');
    expect(typegroupSourceUrl('zmyty')).toBe('/sap/bc/adt/ddic/typegroups/zmyty/source/main');
    expect(TYPEGROUP_MEDIA).toBe('application/vnd.sap.adt.ddic.typegroups.v3+xml');
    expect(TYPEGROUP_OBJTYPE).toBe('TYPE/DG');
  });

  it('validates the five-character type-pool name rule', () => {
    expect(assertTypegroupName('zmyty')).toBe('ZMYTY');
    expect(assertTypegroupName('A1_B2')).toBe('A1_B2');
    expect(() => assertTypegroupName('ZMYTYP')).toThrowError(/1-5 characters/);
    expect(() => assertTypegroupName('1BAD')).toThrowError(/starts with a letter/);
    expect(() => assertTypegroupName('BAD-NAME')).toThrowError(/starts with a letter/);
    try {
      assertTypegroupName('TOOLONG');
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      expect((error as CliError).code).toBe('VALIDATION_ERROR');
    }
  });
});

describe('TYPE AFF documents', () => {
  it('accepts the header-only schema document', async () => {
    expect(await typeArtifact.validate({ formatVersion: '1', header: { description: 'x', originalLanguage: 'en' } })).toEqual([]);
  });

  it('rejects a missing header / unsupported fields', async () => {
    expect((await typeArtifact.validate({ formatVersion: '1' })).length).toBeGreaterThan(0);
    expect(
      (await typeArtifact.validate({ formatVersion: '1', header: { description: 'x', originalLanguage: 'en' }, extra: 1 })).length,
    ).toBeGreaterThan(0);
  });

  it('derives the classic ABAP companion filename', () => {
    expect(typeSourceFileName('zmyty.type.json')).toBe('zmyty.type.abap');
  });
});
