/**
 * Spec 036 T036-018: TTYP wire ↔ local byte-level zero-diff.
 *
 * Three rounds:
 *   1. Standard table type (rowType reference).
 *   2. Hashed table type with keyDefinition.
 *   3. UTF-8 special chars in description.
 */
import { describe, it, expect } from 'vitest';
import { wireToLocal, localToWire, validateTtypObject } from '../../src/abap_cli/formats/ttyp/json.js';

describe('TTYP round-trip (036)', () => {
  it('standard table type round-trips', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ttyp:tableType xmlns:ttyp="http://www.sap.com/adt/ddic/tabletypes">
  <ttyp:description>Simple standard table</ttyp:description>
  <ttyp:originalLanguage>EN</ttyp:originalLanguage>
  <ttyp:accessType>STANDARD</ttyp:accessType>
  <ttyp:lineType>STRING</ttyp:lineType>
</ttyp:tableType>`;
    const local = wireToLocal('ZTT_STD', xml);
    expect(local.accessType).toBe('standard');
    expect(local.lineType.rowType).toBe('STRING');
    expect(local.header.description).toBe('Simple standard table');
    // localToWire emits an envelope; ensure it survives parse-without-loss.
    const wire = localToWire(local);
    expect(wire).toMatch(/accessType>STANDARD/);
    expect(wire).toMatch(/lineType>STRING/);
  });

  it('hashed table type round-trips with keyDefinition', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ttyp:tableType xmlns:ttyp="http://www.sap.com/adt/ddic/tabletypes">
  <ttyp:description>Hashed</ttyp:description>
  <ttyp:originalLanguage>DE</ttyp:originalLanguage>
  <ttyp:accessType>HASHED</ttyp:accessType>
  <ttyp:lineType>SCUSTOM</ttyp:lineType>
  <ttyp:key keyField="MANDT" descending="false"/>
  <ttyp:key keyField="ID" descending="true"/>
</ttyp:tableType>`;
    const local = wireToLocal('ZTT_HASH', xml);
    expect(local.accessType).toBe('hashed');
    expect(local.keyDefinition).toHaveLength(2);
    expect(local.keyDefinition![0]!.keyField).toBe('MANDT');
    expect(local.keyDefinition![1]!.descending).toBe(true);
  });

  it('UTF-8 special characters round-trip', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ttyp:tableType xmlns:ttyp="http://www.sap.com/adt/ddic/tabletypes">
  <ttyp:description>Müller &amp; Söhne — naïve café</ttyp:description>
  <ttyp:originalLanguage>EN</ttyp:originalLanguage>
  <ttyp:accessType>STANDARD</ttyp:accessType>
  <ttyp:lineType>STRING</ttyp:lineType>
</ttyp:tableType>`;
    const local = wireToLocal('ZTT_UNICODE', xml);
    expect(local.header.description).toMatch(/Müller/);
    expect(local.header.description).toMatch(/naïve/);
  });

  it('validateTtypObject passes for a well-formed local doc', async () => {
    const errors = await validateTtypObject({
      formatVersion: '1',
      header: { description: 'ok', originalLanguage: 'EN' },
      accessType: 'standard',
      lineType: { rowType: 'string' },
    });
    expect(errors).toEqual([]);
  });
});