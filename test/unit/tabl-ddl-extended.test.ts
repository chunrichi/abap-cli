import { describe, expect, it } from 'vitest';
import { parseTablDdic } from '../../src/abap_cli/formats/ddic/tabl-artifact.js';

describe('032 US6: TABL DDL parser extensions', () => {
  it('parses `.INCLUDE` with suffix into includeSuffix', () => {
    const ddl = [
      'define table ztab_inc {',
      '  include zstruct with suffix inc;',
      '  field2 : abap.char(10);',
      '}',
    ].join('\n');
    const parsed = parseTablDdic(ddl);
    expect(parsed.type).toBe('TABL');
    expect(parsed.fields[0]?.fieldName).toBe('.INCLUDE');
    expect(parsed.fields[0]?.precField).toBe('ZSTRUCT');
    expect(parsed.fields[0]?.includeSuffix).toBe('INC');
  });

  it('captures composite key on multiple key columns', () => {
    const ddl = [
      'define table ztab_compkey {',
      '  key mandt : abap.clnt not null;',
      '  key bukrs : abap.char(4) not null;',
      '  key docnr : abap.char(10) not null;',
      '  amount  : abap.curr(15,2);',
      '}',
    ].join('\n');
    const parsed = parseTablDdic(ddl);
    expect(parsed.fields[0]?.keyFlag).toBe(true);
    expect(parsed.fields[0]?.notNull).toBe(true);
    expect(parsed.fields[1]?.keyFlag).toBe(true);
    expect(parsed.fields[2]?.keyFlag).toBe(true);
    expect(parsed.fields[3]?.keyFlag).toBe(false);
  });

  it('captures @AbapCatalog.foreignKeys block on a field', () => {
    const ddl = [
      'define table ztab_fk {',
      '  key mandt : abap.clnt not null;',
      '  country : abap.char(3) with foreign key [dependent] check t005;',
      '}',
    ].join('\n');
    const parsed = parseTablDdic(ddl);
    const country = parsed.fields.find(f => f.fieldName === 'COUNTRY');
    expect(country).toBeDefined();
    expect(country?.checkTable).toBe('T005');
  });

  it('recognizes @ClientHandling.type CLIENT_DEPENDENT', () => {
    const ddl = [
      '@ClientHandling.type : #CLIENT_DEPENDENT',
      'define table ztab_ch {',
      '  key mandt : abap.clnt not null;',
      '  field2   : abap.char(10);',
      '}',
    ].join('\n');
    const parsed = parseTablDdic(ddl);
    expect(parsed.type).toBe('TABL');
    // The sentinel @ClientHandling.type field exists before declaration; we filter
    // it out at the artifact layer (readTablArtifact). parseTablDdic itself retains
    // the marker so callers can pick it up.
    expect(parsed.fields.some(f => f.fieldName === '@ClientHandling.type')).toBe(true);
  });

  it('still parses the canonical TABL example with deliveryClass + inline semantics', () => {
    // abap-file-format / DDL convention: @Semantics is inline before the
    // field it annotates (not a header-level declaration).
    const ddl = [
      '@AbapCatalog.deliveryClass : #L',
      'define table ztab_demo {',
      '  key mandt   : abap.clnt not null;',
      '  @Semantics.amount.currencyCode : \'t005.currcode\'',
      '  amount      : abap.curr(15,2);',
      '}',
    ].join('\n');
    const parsed = parseTablDdic(ddl);
    expect(parsed.deliveryClass).toBe('L');
    const amount = parsed.fields.find(f => f.fieldName === 'AMOUNT');
    expect(amount?.refTable).toBe('T005');
    expect(amount?.refField).toBe('CURRCODE');
  });
});
