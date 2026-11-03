/**
 * TTYP wire ↔ local round-trip against the real ADT DDIC table-type shape.
 *
 * Real GET body (S/4HANA, `/sap/bc/adt/ddic/tabletypes/<name>`): header in
 * `adtcore` attributes, `<ttyp:rowType>` with typeKind/typeName/builtInType,
 * `<ttyp:accessType>`, and `<ttyp:primaryKey>` with either the `standard` or
 * `keyComponents` definition.
 */
import { describe, it, expect } from 'vitest';
import { ttypArtifact, wireToLocal, localToWire } from '../../src/abap_cli/formats/ttyp/json.js';

const STANDARD_XML = `<?xml version="1.0" encoding="utf-8"?><ttyp:tableType adtcore:responsible="SAP" adtcore:masterLanguage="EN" adtcore:name="LVC_T_TABL" adtcore:type="TTYP/DA" adtcore:description="Mini ALV: Datentabelle" adtcore:language="ZH" xmlns:ttyp="http://www.sap.com/dictionary/tabletype" xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:packageRef adtcore:uri="/sap/bc/adt/packages/slis" adtcore:type="DEVC/K" adtcore:name="SLIS"/><ttyp:rowType><ttyp:typeKind>dictionaryType</ttyp:typeKind><ttyp:typeName>LVC_S_TABL</ttyp:typeName><ttyp:builtInType><ttyp:dataType>STRU</ttyp:dataType><ttyp:length>000000</ttyp:length><ttyp:decimals>000000</ttyp:decimals></ttyp:builtInType><ttyp:rangeType/></ttyp:rowType><ttyp:accessType>standard</ttyp:accessType><ttyp:primaryKey><ttyp:definition>standard</ttyp:definition><ttyp:kind>nonUnique</ttyp:kind><ttyp:components ttyp:isVisible="false"/><ttyp:alias/></ttyp:primaryKey></ttyp:tableType>`;

const HASHED_XML = `<?xml version="1.0" encoding="utf-8"?><ttyp:tableType adtcore:masterLanguage="EN" adtcore:name="FEH_TEST_SFLIGHT_T_HASH_UNIQ" adtcore:type="TTYP/DA" adtcore:description="Hashed probe" adtcore:language="EN" xmlns:ttyp="http://www.sap.com/dictionary/tabletype" xmlns:adtcore="http://www.sap.com/adt/core"><ttyp:rowType><ttyp:typeKind>dictionaryType</ttyp:typeKind><ttyp:typeName>FEH_TEST_SFLIGHT_S</ttyp:typeName><ttyp:builtInType><ttyp:dataType>STRU</ttyp:dataType><ttyp:length>000000</ttyp:length><ttyp:decimals>000000</ttyp:decimals></ttyp:builtInType><ttyp:rangeType/></ttyp:rowType><ttyp:accessType>hashed</ttyp:accessType><ttyp:primaryKey ttyp:isVisible="true"><ttyp:definition>keyComponents</ttyp:definition><ttyp:kind>unique</ttyp:kind><ttyp:components ttyp:isVisible="true"><ttyp:component ttyp:name="CARRID"/><ttyp:component ttyp:name="CONNID"/><ttyp:component ttyp:name="FLDATE"/></ttyp:components><ttyp:alias/></ttyp:primaryKey></ttyp:tableType>`;

const PREDEFINED_XML = `<?xml version="1.0" encoding="utf-8"?><ttyp:tableType adtcore:masterLanguage="EN" adtcore:name="ZMY_STRINGS" adtcore:type="TTYP/DA" adtcore:description="Predefined row" adtcore:language="EN" xmlns:ttyp="http://www.sap.com/dictionary/tabletype" xmlns:adtcore="http://www.sap.com/adt/core"><ttyp:rowType><ttyp:typeKind>predefinedAbapType</ttyp:typeKind><ttyp:typeName/><ttyp:builtInType><ttyp:dataType>STRING</ttyp:dataType><ttyp:length>000000</ttyp:length><ttyp:decimals>000000</ttyp:decimals></ttyp:builtInType><ttyp:rangeType/></ttyp:rowType><ttyp:accessType>standard</ttyp:accessType><ttyp:primaryKey><ttyp:definition>standard</ttyp:definition><ttyp:kind>nonUnique</ttyp:kind><ttyp:components/><ttyp:alias/></ttyp:primaryKey></ttyp:tableType>`;

/** Real ADT body of a `table of char10` (S/4HANA probe: dataType CHAR, length 000010). */
const PREDEFINED_CHAR10_XML = `<?xml version="1.0" encoding="utf-8"?><ttyp:tableType adtcore:masterLanguage="EN" adtcore:name="ZMY_CHARS" adtcore:type="TTYP/DA" adtcore:description="char10 rows" adtcore:language="EN" xmlns:ttyp="http://www.sap.com/dictionary/tabletype" xmlns:adtcore="http://www.sap.com/adt/core"><ttyp:rowType><ttyp:typeKind>predefinedAbapType</ttyp:typeKind><ttyp:typeName/><ttyp:builtInType><ttyp:dataType>CHAR</ttyp:dataType><ttyp:length>000010</ttyp:length><ttyp:decimals>000000</ttyp:decimals></ttyp:builtInType><ttyp:rangeType/></ttyp:rowType><ttyp:accessType>standard</ttyp:accessType><ttyp:primaryKey><ttyp:definition>standard</ttyp:definition><ttyp:kind>nonUnique</ttyp:kind><ttyp:components/><ttyp:alias/></ttyp:primaryKey></ttyp:tableType>`;

/** Real ADT body of a `table of dec15(2)` (length + decimals). */
const PREDEFINED_DEC_XML = `<?xml version="1.0" encoding="utf-8"?><ttyp:tableType adtcore:masterLanguage="EN" adtcore:name="ZMY_DECS" adtcore:type="TTYP/DA" adtcore:description="dec rows" adtcore:language="EN" xmlns:ttyp="http://www.sap.com/dictionary/tabletype" xmlns:adtcore="http://www.sap.com/adt/core"><ttyp:rowType><ttyp:typeKind>predefinedAbapType</ttyp:typeKind><ttyp:typeName/><ttyp:builtInType><ttyp:dataType>DEC</ttyp:dataType><ttyp:length>000015</ttyp:length><ttyp:decimals>000002</ttyp:decimals></ttyp:builtInType><ttyp:rangeType/></ttyp:rowType><ttyp:accessType>standard</ttyp:accessType><ttyp:primaryKey><ttyp:definition>standard</ttyp:definition><ttyp:kind>nonUnique</ttyp:kind><ttyp:components/><ttyp:alias/></ttyp:primaryKey></ttyp:tableType>`;

describe('TTYP wire → local', () => {


  it('passes AFF schema validation for a well-formed local doc', async () => {
    const errors = await ttypArtifact.validate({
      formatVersion: '1',
      header: { description: 'ok', originalLanguage: 'EN' },
      accessType: 'standard',
      lineType: { rowType: 'string' },
    });
    expect(errors).toEqual([]);
  });

  it('accepts rowTypeLength/rowTypeDecimals and keeps old files valid', async () => {
    const withLength = await ttypArtifact.validate({
      formatVersion: '1',
      header: { description: 'ok', originalLanguage: 'EN' },
      accessType: 'standard',
      lineType: { rowType: 'CHAR', rowTypeLength: 10, rowTypeDecimals: 0 },
    });
    expect(withLength).toEqual([]);
    const legacy = await ttypArtifact.validate({
      formatVersion: '1',
      header: { description: 'ok', originalLanguage: 'EN' },
      accessType: 'standard',
      lineType: { rowType: 'LVC_S_TABL' },
    });
    expect(legacy).toEqual([]);
  });

  it('rejects a negative rowTypeLength', async () => {
    const errors = await ttypArtifact.validate({
      formatVersion: '1',
      header: { description: 'bad', originalLanguage: 'EN' },
      accessType: 'standard',
      lineType: { rowType: 'CHAR', rowTypeLength: -1 },
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects rowTypeLength without rowType (inline row structure)', async () => {
    const errors = await ttypArtifact.validate({
      formatVersion: '1',
      header: { description: 'bad', originalLanguage: 'EN' },
      accessType: 'standard',
      lineType: { rowStructure: { fieldName: 'ROW', dataType: 'CHAR', length: 1 }, rowTypeLength: 1 },
    });
    expect(errors.length).toBeGreaterThan(0);
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
