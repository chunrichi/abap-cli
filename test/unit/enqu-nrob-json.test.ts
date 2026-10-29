import { describe, expect, it } from 'vitest';
import { wireToLocal, localToWire, validateEnquObject } from '../../src/abap_cli/formats/enqu/json.js';
import { wireToLocal as nrobWireToLocal, localToWire as nrobLocalToWire, validateNrobObject } from '../../src/abap_cli/formats/nrob/json.js';

const SAMPLE_ENQU = {
  formatVersion: '1',
  header: { description: 'Lock test', originalLanguage: 'EN' },
  primaryTable: { name: 'ZMY_TABL', lockMode: 'exclusive' },
  lockParameters: [
    { name: 'CLIENT', table: 'ZMY_TABL', field: 'CLIENT', active: true },
    { name: 'ID', table: 'ZMY_TABL', field: 'ID', active: true },
  ],
  lockModules: { allowRfc: false },
};

const SAMPLE_NROB = {
  formatVersion: '1',
  header: { description: 'Document ID', originalLanguage: 'en' },
  interval: {
    numberLengthDomain: 'ZNR_DOC_ID',
    percentWarning: 10,
    subType: 'ZDE_DOC_ID',
    untilYear: false,
    rolling: true,
    prefix: false,
  },
  configuration: { buffering: 'mainBuffer', bufferedNumbers: 10 },
};

describe('ENQU wire <-> local', () => {
  it('round-trips a basic ENQU document', () => {
    const local = wireToLocal(SAMPLE_ENQU);
    expect(local.primaryTable.name).toBe('ZMY_TABL');
    expect(local.primaryTable.lockMode).toBe('exclusive');
    expect(local.lockParameters).toHaveLength(2);
    expect(local.lockParameters[0]!.active).toBe(true);
    expect(local.lockModules.allowRfc).toBe(false);

    const wire = localToWire(local);
    expect((wire as typeof SAMPLE_ENQU).primaryTable).toEqual(SAMPLE_ENQU.primaryTable);
    expect((wire as typeof SAMPLE_ENQU).lockParameters).toEqual(SAMPLE_ENQU.lockParameters);
  });

  it('uppercases table / parameter names and defaults lockMode to exclusive', () => {
    const local = wireToLocal({
      formatVersion: '1',
      header: { description: 'x', originalLanguage: 'en' },
      primaryTable: { name: 'zmy_tabl' },
      lockParameters: [{ name: 'id', table: 'zmy_tabl', field: 'id' }],
      lockModules: {},
    });
    expect(local.primaryTable.name).toBe('ZMY_TABL');
    expect(local.primaryTable.lockMode).toBe('exclusive');
    expect(local.lockParameters[0]!.name).toBe('ID');
    expect(local.lockParameters[0]!.active).toBe(true);
  });

  it('validates against the AFF schema', async () => {
    const ok = await validateEnquObject(SAMPLE_ENQU);
    expect(ok).toEqual([]);
    const bad = await validateEnquObject({ formatVersion: '1' });
    expect(bad.length).toBeGreaterThan(0);
  });
});

describe('NROB wire <-> local', () => {
  it('round-trips a basic NROB document', () => {
    const local = nrobWireToLocal(SAMPLE_NROB);
    expect(local.interval.numberLengthDomain).toBe('ZNR_DOC_ID');
    expect(local.interval.percentWarning).toBe(10);
    expect(local.configuration.buffering).toBe('mainBuffer');
    expect(local.configuration.bufferedNumbers).toBe(10);

    const wire = nrobLocalToWire(local);
    expect((wire as typeof SAMPLE_NROB).interval).toEqual(SAMPLE_NROB.interval);
    expect((wire as typeof SAMPLE_NROB).configuration).toEqual(SAMPLE_NROB.configuration);
  });

  it('applies sensible defaults for the optional fields', () => {
    const local = nrobWireToLocal({
      formatVersion: '1',
      header: { description: 'x', originalLanguage: 'en' },
      interval: {
        numberLengthDomain: 'ZNR_TEST',
        percentWarning: 5,
        subType: 'ZDE_TEST',
        untilYear: false,
        rolling: true,
        prefix: false,
      },
      configuration: { buffering: 'none', bufferedNumbers: 5 },
    });
    expect(local.interval.numberLengthDomain).toBe('ZNR_TEST');
    expect(local.interval.percentWarning).toBe(5);
    expect(local.configuration.buffering).toBe('none');
    expect(local.configuration.bufferedNumbers).toBe(5);
  });

  it('validates against the AFF schema', async () => {
    const ok = await validateNrobObject(SAMPLE_NROB);
    expect(ok).toEqual([]);
    const bad = await validateNrobObject({ formatVersion: '1' });
    expect(bad.length).toBeGreaterThan(0);
  });
});
