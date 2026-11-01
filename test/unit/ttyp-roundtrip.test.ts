/**
 * TTYP wire ↔ local round-trip against the real ADT DDIC table-type shape.
 *
 * Real GET body (S/4HANA, `/sap/bc/adt/ddic/tabletypes/<name>`): header in
 * `adtcore` attributes, `<ttyp:rowType>` with typeKind/typeName/builtInType,
 * `<ttyp:accessType>`, and `<ttyp:primaryKey>` with either the `standard` or
 * `keyComponents` definition.
 */
import { describe, it, expect } from 'vitest';
import { ttypArtifact, wireToLocal, localToWire, buildTypeSource } from '../../src/abap_cli/formats/ttyp/json.js';

const STANDARD_XML = `<?xml version="1.0" encoding="utf-8"?><ttyp:tableType adtcore:responsible="SAP" adtcore:masterLanguage="EN" adtcore:name="LVC_T_TABL" adtcore:type="TTYP/DA" adtcore:description="Mini ALV: Datentabelle" adtcore:language="ZH" xmlns:ttyp="http://www.sap.com/dictionary/tabletype" xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:packageRef adtcore:uri="/sap/bc/adt/packages/slis" adtcore:type="DEVC/K" adtcore:name="SLIS"/><ttyp:rowType><ttyp:typeKind>dictionaryType</ttyp:typeKind><ttyp:typeName>LVC_S_TABL</ttyp:typeName><ttyp:builtInType><ttyp:dataType>STRU</ttyp:dataType><ttyp:length>000000</ttyp:length><ttyp:decimals>000000</ttyp:decimals></ttyp:builtInType><ttyp:rangeType/></ttyp:rowType><ttyp:accessType>standard</ttyp:accessType><ttyp:primaryKey><ttyp:definition>standard</ttyp:definition><ttyp:kind>nonUnique</ttyp:kind><ttyp:components ttyp:isVisible="false"/><ttyp:alias/></ttyp:primaryKey></ttyp:tableType>`;

const HASHED_XML = `<?xml version="1.0" encoding="utf-8"?><ttyp:tableType adtcore:masterLanguage="EN" adtcore:name="FEH_TEST_SFLIGHT_T_HASH_UNIQ" adtcore:type="TTYP/DA" adtcore:description="Hashed probe" adtcore:language="EN" xmlns:ttyp="http://www.sap.com/dictionary/tabletype" xmlns:adtcore="http://www.sap.com/adt/core"><ttyp:rowType><ttyp:typeKind>dictionaryType</ttyp:typeKind><ttyp:typeName>FEH_TEST_SFLIGHT_S</ttyp:typeName><ttyp:builtInType><ttyp:dataType>STRU</ttyp:dataType><ttyp:length>000000</ttyp:length><ttyp:decimals>000000</ttyp:decimals></ttyp:builtInType><ttyp:rangeType/></ttyp:rowType><ttyp:accessType>hashed</ttyp:accessType><ttyp:primaryKey ttyp:isVisible="true"><ttyp:definition>keyComponents</ttyp:definition><ttyp:kind>unique</ttyp:kind><ttyp:components ttyp:isVisible="true"><ttyp:component ttyp:name="CARRID"/><ttyp:component ttyp:name="CONNID"/><ttyp:component ttyp:name="FLDATE"/></ttyp:components><ttyp:alias/></ttyp:primaryKey></ttyp:tableType>`;

const PREDEFINED_XML = `<?xml version="1.0" encoding="utf-8"?><ttyp:tableType adtcore:masterLanguage="EN" adtcore:name="ZMY_STRINGS" adtcore:type="TTYP/DA" adtcore:description="Predefined row" adtcore:language="EN" xmlns:ttyp="http://www.sap.com/dictionary/tabletype" xmlns:adtcore="http://www.sap.com/adt/core"><ttyp:rowType><ttyp:typeKind>predefinedAbapType</ttyp:typeKind><ttyp:typeName/><ttyp:builtInType><ttyp:dataType>STRING</ttyp:dataType><ttyp:length>000000</ttyp:length><ttyp:decimals>000000</ttyp:decimals></ttyp:builtInType><ttyp:rangeType/></ttyp:rowType><ttyp:accessType>standard</ttyp:accessType><ttyp:primaryKey><ttyp:definition>standard</ttyp:definition><ttyp:kind>nonUnique</ttyp:kind><ttyp:components/><ttyp:alias/></ttyp:primaryKey></ttyp:tableType>`;

describe('TTYP wire → local', () => {
  it('parses a standard table type with a dictionary row type', () => {
    const local = wireToLocal(STANDARD_XML);
    expect(local.header.description).toBe('Mini ALV: Datentabelle');
    // masterLanguage wins over the logon language.
    expect(local.header.originalLanguage).toBe('EN');
    expect(local.accessType).toBe('standard');
    expect(local.lineType.rowType).toBe('LVC_S_TABL');
    expect(local.keyDefinition).toBeUndefined();
  });

  it('parses a hashed table type with key components and uniqueness', () => {
    const local = wireToLocal(HASHED_XML);
    expect(local.accessType).toBe('hashed');
    expect(local.keyDefinition).toEqual([
      { keyField: 'CARRID', descending: false },
      { keyField: 'CONNID', descending: false },
      { keyField: 'FLDATE', descending: false },
    ]);
    expect(local.keyKind).toBe('unique');
  });

  it('parses a predefined ABAP row type by its data-type name', () => {
    const local = wireToLocal(PREDEFINED_XML);
    expect(local.lineType.rowType).toBe('STRING');
  });
});

describe('TTYP local → wire', () => {
  it('emits the ADT DDIC document with the create package reference', () => {
    const wire = localToWire(
      {
        formatVersion: '1',
        header: { description: 'My "type" & more', originalLanguage: 'en' },
        accessType: 'standard',
        lineType: { rowType: 'lvc_s_tabl' },
      },
      'zmy_ttyp',
      { packageName: '$TMP' },
    );
    expect(wire).toContain('xmlns:ttyp="http://www.sap.com/dictionary/tabletype"');
    expect(wire).toContain('adtcore:name="ZMY_TTYP" adtcore:type="TTYP/DA"');
    expect(wire).toContain('adtcore:description="My &quot;type&quot; &amp; more"');
    expect(wire).toContain('adtcore:language="EN" adtcore:masterLanguage="EN"');
    expect(wire).toContain('<adtcore:packageRef adtcore:name="$TMP"/>');
    expect(wire).toContain('<ttyp:typeKind>dictionaryType</ttyp:typeKind>');
    expect(wire).toContain('<ttyp:typeName>LVC_S_TABL</ttyp:typeName>');
    expect(wire).toContain('<ttyp:accessType>standard</ttyp:accessType>');
    expect(wire).toContain('<ttyp:definition>standard</ttyp:definition>');
  });

  it('emits a predefined ABAP row type without a package reference on update', () => {
    const wire = localToWire(
      {
        formatVersion: '1',
        header: { description: 'strings', originalLanguage: 'EN' },
        accessType: 'standard',
        lineType: { rowType: 'string' },
      },
      'ZMY_STRINGS',
    );
    expect(wire).toContain('<ttyp:typeKind>predefinedAbapType</ttyp:typeKind>');
    expect(wire).toContain('<ttyp:dataType>STRING</ttyp:dataType>');
    expect(wire).not.toContain('packageRef');
  });

  it('emits key components with the recorded uniqueness', () => {
    const wire = localToWire(
      {
        formatVersion: '1',
        header: { description: 'hashed', originalLanguage: 'EN' },
        accessType: 'hashed',
        lineType: { rowType: 'FEH_TEST_SFLIGHT_S' },
        keyDefinition: [{ keyField: 'carrid' }, { keyField: 'connid' }],
        keyKind: 'unique',
      },
      'ZMY_HASHED',
    );
    expect(wire).toContain('<ttyp:definition>keyComponents</ttyp:definition>');
    expect(wire).toContain('<ttyp:kind>unique</ttyp:kind>');
    expect(wire).toContain('<ttyp:component ttyp:name="CARRID"/>');
    expect(wire).toContain('<ttyp:component ttyp:name="CONNID"/>');
  });

  it('round-trips local → wire → local', () => {
    const local = wireToLocal(HASHED_XML);
    expect(wireToLocal(localToWire(local, 'FEH_TEST_SFLIGHT_T_HASH_UNIQ'))).toEqual(local);
  });
});

describe('TTYP sidecar and schema', () => {
  it('builds the pseudo-DDL sidecar with the key list', () => {
    const local = wireToLocal(HASHED_XML);
    expect(buildTypeSource('zmy_hashed', local)).toBe(
      'define type zmy_hashed: hashed table of feh_test_sflight_s with unique key carrid connid fldate.',
    );
  });

  it('passes AFF schema validation for a well-formed local doc', async () => {
    const errors = await ttypArtifact.validate({
      formatVersion: '1',
      header: { description: 'ok', originalLanguage: 'EN' },
      accessType: 'standard',
      lineType: { rowType: 'string' },
    });
    expect(errors).toEqual([]);
  });

  it('accepts the optional keyKind extension', async () => {
    const errors = await ttypArtifact.validate({
      formatVersion: '1',
      header: { description: 'ok', originalLanguage: 'EN' },
      accessType: 'hashed',
      lineType: { rowType: 'lvc_s_tabl' },
      keyDefinition: [{ keyField: 'CARRID' }],
      keyKind: 'unique',
    });
    expect(errors).toEqual([]);
  });
});
