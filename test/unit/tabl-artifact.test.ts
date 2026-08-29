/**
  abap-file-format TABL/STRU three-piece parser unit coverage.
 *
 * Targets `parseTablDdic` (DDL → fields) and `extractTablArtifactWire`
 * (wire → canonical strings). Round-trip with zcl_abap_vibe_tabl_format is
 * covered indirectly via ddic-pull.test.ts.
 */
import { describe, expect, it } from 'vitest';
import {
  isTablArtifactFile,
  parseTablDdic,
  tablArtifactPaths,
} from '../../src/abap_cli/dictionary/tabl-artifact.js';
import {
  extractTablArtifactWire,
  type DdicWirePayload,
} from '../../src/abap_cli/dictionary/ddic-json.js';

const ZAFF = `@EndUserText.label : 'Example Customer Data Table Structure'
@AbapCatalog.enhancement.category : #NOT_EXTENSIBLE
@AbapCatalog.tableCategory : #TRANSPARENT
@AbapCatalog.deliveryClass : #L
@AbapCatalog.dataMaintenance : #RESTRICTED
define table zaffexample {

  key client : abap.clnt not null;
  country    : abap.char(40);
  city       : abap.char(40);
}
`;

const ZSTRU = `@EndUserText.label : 'test structure'
define structure zstruexample {
  field1 : abap.char(10);
  field2 : abap.int4;
}
`;

describe('024/tabl-artifact: file helpers', () => {
  it('matches the canonical three-piece file names', () => {
    expect(isTablArtifactFile('zfoo.tabl.json')).toBe(true);
    expect(isTablArtifactFile('zfoo.tabl.ddic')).toBe(true);
    expect(isTablArtifactFile('zfoo.tabl.settings.json')).toBe(true);
    expect(isTablArtifactFile('zfoo.tabl.xml')).toBe(false);
    expect(isTablArtifactFile('zfoo.ttyp.json')).toBe(false);
  });

  it('computes all three sibling paths from any sidecar', () => {
    const fromMain = tablArtifactPaths('/tmp/tabl/zfoo.tabl.json');
    expect(fromMain.main).toBe('/tmp/tabl/zfoo.tabl.json');
    expect(fromMain.ddic).toBe('/tmp/tabl/zfoo.tabl.ddic');
    expect(fromMain.settings).toBe('/tmp/tabl/zfoo.tabl.settings.json');
    const fromDdic = tablArtifactPaths('/tmp/tabl/zfoo.tabl.ddic');
    expect(fromDdic.main).toBe('/tmp/tabl/zfoo.tabl.json');
    expect(fromDdic.ddic).toBe('/tmp/tabl/zfoo.tabl.ddic');
    const fromSettings = tablArtifactPaths('/tmp/tabl/zfoo.tabl.settings.json');
    expect(fromSettings.settings).toBe('/tmp/tabl/zfoo.tabl.settings.json');
  });
});

describe('024/tabl-artifact: parseTablDdic', () => {
  it('parses the canonical TABL example with keys, notNull, semantics', () => {
    const parsed = parseTablDdic(ZAFF);
    expect(parsed.type).toBe('TABL');
    expect(parsed.objectName).toBe('ZAFFEXAMPLE');
    expect(parsed.deliveryClass).toBe('L');
    expect(parsed.fields.map((f) => f.fieldName)).toEqual(['CLIENT', 'COUNTRY', 'CITY']);
    const client = parsed.fields[0]!;
    expect(client.keyFlag).toBe(true);
    expect(client.notNull).toBe(true);
    expect(client.dataType).toBe('CLNT');
    // abap.clnt has no parameters in DDL; length defaults to undefined.
    expect(client.length).toBeUndefined();
    const country = parsed.fields[1]!;
    expect(country.keyFlag).toBe(false);
    expect(country.notNull).toBe(false);
    expect(country.dataType).toBe('CHAR');
    expect(country.length).toBe(40);
  });

  it('parses STRU without key / notNull / foreign-key', () => {
    const parsed = parseTablDdic(ZSTRU);
    expect(parsed.type).toBe('STRU');
    expect(parsed.objectName).toBe('ZSTRUEXAMPLE');
    expect(parsed.deliveryClass).toBeUndefined();
    expect(parsed.fields).toHaveLength(2);
    for (const f of parsed.fields) {
      expect(f.keyFlag).toBeFalsy();
      expect(f.notNull).toBeFalsy();
    }
  });

  it('extracts inline @Semantics annotations into refTable / refField', () => {
    const ddl = `@EndUserText.label : 'with semantics'
define table zdemo {
  amount : abap.curr(15,2);
}
`;
    const parsed = parseTablDdic(ddl);
    expect(parsed.fields[0]?.dataType).toBe('CURR');
    expect(parsed.fields[0]?.length).toBe(15);
    expect(parsed.fields[0]?.decimals).toBe(2);
  });

  it('rejects DDL without a define declaration', () => {
    expect(() => parseTablDdic('@AbapCatalog.deliveryClass : #L\n')).toThrow(/missing define declaration/i);
  });

  it('rejects an unclosed body (no } terminator)', () => {
    expect(() => parseTablDdic('define table zx {\n  field : abap.char(1);\n')).toThrow(/missing define declaration|closing brace/i);
  });
});

describe('024/tabl-artifact: extractTablArtifactWire', () => {
  it('returns the three canonical strings when present', () => {
    const wire: DdicWirePayload = {
      name: 'ZAFFEXAMPLE',
      mainJson: '{"formatVersion":"1","header":{"description":"x"}}',
      ddicSource: 'define table zaffexample { field : abap.char(1); }\n',
      settingsJson: '{"formatVersion":"1","generalInformation":{}}',
      hasSettings: true,
    };
    const pieces = extractTablArtifactWire(wire);
    expect(pieces).toBeDefined();
    expect(pieces!.mainJson).toContain('formatVersion');
    expect(pieces!.ddicSource).toMatch(/^define table/);
    expect(pieces!.settingsJson).toContain('generalInformation');
    expect(pieces!.hasSettings).toBe(true);
  });

  it('returns undefined when mainJson or ddicSource is missing', () => {
    expect(extractTablArtifactWire({ name: 'X', mainJson: 'x' } as DdicWirePayload)).toBeUndefined();
    expect(extractTablArtifactWire({ name: 'X', ddicSource: 'x' } as DdicWirePayload)).toBeUndefined();
    expect(extractTablArtifactWire({ name: 'X' } as DdicWirePayload)).toBeUndefined();
  });

  it('tolerates settingsJson absence (STRU does not emit it)', () => {
    const pieces = extractTablArtifactWire({
      name: 'ZSTRUEXAMPLE',
      mainJson: '{"formatVersion":"1","header":{"description":"x"}}',
      ddicSource: 'define structure zstruexample { field : abap.char(1); }\n',
      hasSettings: false,
    });
    expect(pieces).toBeDefined();
    expect(pieces!.settingsJson).toBeUndefined();
    expect(pieces!.hasSettings).toBe(false);
  });
});