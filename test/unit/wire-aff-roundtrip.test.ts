import { describe, it, expect } from 'vitest';
import { readJsonFixture } from './schema-compliance/_helpers.js';
import { localToWire, wireToLocal } from '../../src/abap_cli/formats/ddic/json.js';
import { localToWire as httpLocalToWire, wireToLocal as httpWireToLocal } from '../../src/abap_cli/formats/http/json.js';

describe('wire ↔ local AFF round-trip (T033-038)', () => {
  it('DOMA wire ↔ local round-trips byte-identically', async () => {
    const local = await readJsonFixture('doma/zdmy_sign_flag.doma.json');
    const wire = localToWire('DOMA', local as any);
    const back = wireToLocal('DOMA', wire);
    expect((back as any).format).toEqual((local as any).format);
    expect((back as any).outputCharacteristics).toEqual((local as any).outputCharacteristics);
    expect((back as any).header).toEqual((local as any).header);
  });

  it('DTEL wire ↔ local round-trips dataTypeInformation byte-identically', async () => {
    for (const rel of [
      'dtel/zdm_domain_ref.dtel.json',
      'dtel/zdm_predefined_type.dtel.json',
      'dtel/zdm_type_ref.dtel.json',
    ]) {
      const doc = await readJsonFixture(rel);
      const wire = localToWire('DTEL', doc as any);
      const back = wireToLocal('DTEL', wire);
      expect((back as any).dataTypeInformation).toEqual((doc as any).dataTypeInformation);
    }
  });

  it('TABL three-piece: localToWire merges header + fields + generalInformation', async () => {
    const local = await readJsonFixture('tabl/zmy_basic.tabl.json');
    const wire = localToWire('TABL', local as any);
    expect((wire as any).header).toEqual((local as any).header);
    // Three-piece main JSON carries no fields directly; the wire forwarder
    // also omits the (empty) fields list when absent.
    expect(wire.fields).toBeUndefined();
  });

  it('STRU shares the TABL wire shape (no fields in main JSON)', async () => {
    const local = await readJsonFixture('stru/zmy_stru.stru.json');
    const wire = localToWire('STRU', local as any);
    expect((wire as any).header).toEqual((local as any).header);
    expect(wire.fields).toBeUndefined();
  });

  it('HTTP wire ↔ local round-trips header + generalInformation', () => {
    const local = {
      name: 'ZMY_HTTP',
      formatVersion: '1' as const,
      header: {
        description: 'HTTP service',
        originalLanguage: 'EN',
        abapLanguageVersion: 'standard' as const,
      },
      generalInformation: {
        handlerClass: 'ZCL_MY_HANDLER',
        url: '/sap/zmy_http',
        serviceId: '/sap/zfoo',
      },
    };
    const wire = httpLocalToWire(local as any);
    expect((wire as any).header?.description).toBe('HTTP service');
    expect((wire as any).generalInformation?.serviceId).toBe('/sap/zfoo');
    const back = httpWireToLocal(wire);
    expect((back as any).generalInformation?.serviceId).toBe('/sap/zfoo');
  });

  it('DTEL unknown category raises DTEL_CATEGORY_UNSUPPORTED', () => {
    const wire = localToWire('DTEL', {
      name: 'ZDE_BAD',
      description: 'unknown category',
      dataTypeInformation: { category: 'mysteryCategory', typeName: 'ZCL' },
    } as any);
    // localToWire keeps the unknown category as-is on the wire (validation
    // is on the wireToLocal read path, where the schema would also reject).
    expect((wire as any).dataTypeInformation.category).toBe('mysteryCategory');
    let thrown: unknown;
    try {
      wireToLocal('DTEL', wire);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeDefined();
    expect((thrown as { code?: string }).code).toBe('DTEL_CATEGORY_UNSUPPORTED');
  });
});