/**
 * VIEW local-extension mapping: view-v1 document ↔ ICF wire, schema +
 * semantic validation, view class normalisation and the agent example.
 */
import { describe, expect, it } from 'vitest';
import {
  getViewJsonExample,
  normaliseViewClass,
  validateViewObject,
  viewArtifact,
  VIEW_NAME_MAX_LENGTH,
  type ViewLocal,
  type ViewWire,
} from '../../src/abap_cli/formats/view/json.js';

const WIRE: ViewWire = {
  formatVersion: '1',
  header: { description: 'Demo view', originalLanguage: 'en' },
  type: 'VIEW',
  name: 'ZCLI_TC_VIEW',
  package: '$TMP',
  viewClass: 'databaseView',
  rootTable: 'MARA',
  tables: [
    { tableName: 'MARA', tablePosition: 1, foreignTableName: 'MARA', forField: '', forDirection: '' },
    { tableName: 'MAKT', tablePosition: 2, foreignTableName: 'MARA' },
  ],
  fields: [
    { viewFieldName: 'MANDT', tableName: 'MARA', fieldName: 'MANDT', keyFlag: true, rollName: 'MANDT', viewFieldRollName: 'MANDT' },
    { viewFieldName: 'MATNR', tableName: 'MARA', fieldName: 'MATNR', keyFlag: true, rollName: 'MATNR', viewFieldRollName: 'MATNR' },
    { viewFieldName: 'SPRAS', tableName: 'MAKT', fieldName: 'SPRAS', keyFlag: true, rollName: 'SPRAS', viewFieldRollName: 'SPRAS' },
    { viewFieldName: 'MAKTX', tableName: 'MAKT', fieldName: 'MAKTX', keyFlag: false, rollName: 'MAKTX', viewFieldRollName: 'MAKTX' },
  ],
  joinConditions: [
    { leftTable: 'MARA', leftField: 'MANDT', operator: 'EQ', rightTable: 'MAKT', rightField: 'MANDT', source: 'S' },
    { leftTable: 'MARA', leftField: 'MATNR', operator: 'EQ', rightTable: 'MAKT', rightField: 'MATNR', source: 'S' },
  ],
};

describe('VIEW wire → local', () => {
  it('normalises the ICF payload into a clean view-v1 document', () => {
    const local = viewArtifact.fromWire(WIRE);
    expect(local.formatVersion).toBe('1');
    expect(local.name).toBe('ZCLI_TC_VIEW');
    expect(local.package).toBe('$TMP');
    expect(local.header).toEqual({ description: 'Demo view', originalLanguage: 'en' });
    expect(local.viewClass).toBe('databaseView');
    expect(local.rootTable).toBe('MARA');
    expect(local.tables).toEqual([
      { tableName: 'MARA', tablePosition: 1, foreignTableName: 'MARA' },
      { tableName: 'MAKT', tablePosition: 2, foreignTableName: 'MARA' },
    ]);
    // viewFieldName equal to fieldName and viewFieldRollName equal to rollName
    // are dropped to keep the local document terse.
    expect(local.fields[0]).toEqual({ tableName: 'MARA', fieldName: 'MANDT', keyFlag: true, rollName: 'MANDT' });
    expect(local.fields[3]).toEqual({ tableName: 'MAKT', fieldName: 'MAKTX', rollName: 'MAKTX' });
    expect(local.joinConditions).toHaveLength(2);
    expect(local.joinConditions?.[0]).toEqual({
      leftTable: 'MARA',
      leftField: 'MANDT',
      operator: 'EQ',
      rightTable: 'MAKT',
      rightField: 'MANDT',
      source: 'S',
    });
  });

  it('fills table positions from the array order and uppercases names', () => {
    const local = viewArtifact.fromWire({
      name: 'zcli_tc_view',
      header: { description: 'x', originalLanguage: 'EN' },
      rootTable: 'mara',
      viewClass: 'D',
      tables: [{ tableName: 'mara' }],
      fields: [{ tableName: 'mara', fieldName: 'matnr', viewFieldName: 'material' }],
    });
    expect(local.name).toBe('ZCLI_TC_VIEW');
    expect(local.tables[0]).toEqual({ tableName: 'MARA', tablePosition: 1 });
    expect(local.fields[0]).toMatchObject({ tableName: 'MARA', fieldName: 'MATNR', viewFieldName: 'MATERIAL' });
    // DDIC letter classes are accepted on the read path.
    expect(local.viewClass).toBe('databaseView');
  });

  it('does not carry CLI envelope fields into the local document', () => {
    const local = viewArtifact.fromWire({ ...WIRE, transportRequest: 'NDK900123', type: 'VIEW' });
    expect(local).not.toHaveProperty('type');
    expect(local).not.toHaveProperty('transportRequest');
  });
});

describe('VIEW local → wire', () => {
  const LOCAL: ViewLocal = {
    formatVersion: '1',
    header: { description: 'Demo view', originalLanguage: 'en' },
    name: 'zcli_tc_view',
    package: '$TMP',
    viewClass: 'databaseView',
    rootTable: 'mara',
    tables: [{ tableName: 'mara', tablePosition: 1 }],
    fields: [{ tableName: 'mara', fieldName: 'matnr', keyFlag: true }],
  };

  it('uppercases DDIC identifiers and keeps the package for the write path', () => {
    const wire = viewArtifact.toWire(LOCAL);
    expect(wire.name).toBe('ZCLI_TC_VIEW');
    expect(wire.rootTable).toBe('MARA');
    expect(wire.package).toBe('$TMP');
    expect(wire.tables[0]).toEqual({ tableName: 'MARA', tablePosition: 1 });
    expect(wire.fields[0]).toEqual({ tableName: 'MARA', fieldName: 'MATNR', keyFlag: true });
    expect(wire.header).toEqual({ description: 'Demo view', originalLanguage: 'en' });
  });

  it('round-trips a pulled document without losing join/selection data', () => {
    const wire = { ...WIRE, selectionConditions: [{ fieldName: 'MTART', operator: 'EQ', constants: 'FERT' }] } as ViewWire;
    const local = viewArtifact.fromWire(wire);
    const back = viewArtifact.toWire(local);
    expect(back.tables).toEqual([
      { tableName: 'MARA', tablePosition: 1, foreignTableName: 'MARA' },
      { tableName: 'MAKT', tablePosition: 2, foreignTableName: 'MARA' },
    ]);
    expect(back.fields?.map((f) => f.fieldName)).toEqual(['MANDT', 'MATNR', 'SPRAS', 'MAKTX']);
    expect(back.joinConditions).toEqual(WIRE.joinConditions);
  });
});

describe('VIEW validation', () => {
  const VALID: ViewLocal = {
    formatVersion: '1',
    header: { description: 'Valid view', originalLanguage: 'en' },
    name: 'ZCLI_TC_VALID',
    viewClass: 'databaseView',
    rootTable: 'T000',
    tables: [{ tableName: 'T000', tablePosition: 1 }],
    fields: [
      { tableName: 'T000', fieldName: 'MANDT', keyFlag: true },
      { tableName: 'T000', fieldName: 'MTEXT' },
    ],
  };

  it('accepts a valid document through the AFF schema + semantic rules', async () => {
    expect(validateViewObject(VALID)).toEqual([]);
    await expect(viewArtifact.validate(VALID)).resolves.toEqual([]);
  });

  it('rejects documents that only JSON Schema catches (extra property / bad enum)', async () => {
    const extra = { ...VALID, unexpected: true } as unknown;
    const extraErrors = await viewArtifact.validate(extra);
    expect(extraErrors.join('; ')).toMatch(/additional properties/);
    const badClass = { ...VALID, viewClass: 'clusterView' };
    const classErrors = await viewArtifact.validate(badClass);
    expect(classErrors.join('; ')).toMatch(/viewClass/);
  });

  it('enforces the 16-character view name limit', () => {
    const errors = validateViewObject({ ...VALID, name: 'Z' + 'X'.repeat(VIEW_NAME_MAX_LENGTH) });
    expect(errors.join('; ')).toMatch(/at most 16 characters|must not exceed 16/);
  });

  it('requires header.description and a two-letter language', () => {
    const errors = validateViewObject({ ...VALID, header: { description: '', originalLanguage: 'english' } });
    expect(errors.join('; ')).toContain('header.description is required');
    expect(errors.join('; ')).toContain('two-letter ISO code');
  });

  it('requires tables[] and fields[]', () => {
    const errors = validateViewObject({ ...VALID, tables: [], fields: [] });
    expect(errors.join('; ')).toContain('tables[] must contain at least the root table');
    expect(errors.join('; ')).toContain('fields[] must contain at least one view field');
  });

  it('rejects fields that reference a table not declared in tables[]', () => {
    const errors = validateViewObject({ ...VALID, fields: [{ tableName: 'MARA', fieldName: 'MATNR' }] });
    expect(errors.join('; ')).toContain('is not in tables[]');
  });

  it('rejects a rootTable that differs from the first tables[] entry', () => {
    const errors = validateViewObject({
      ...VALID,
      rootTable: 'MARA',
      tables: [{ tableName: 'T000' }],
    });
    expect(errors.join('; ')).toContain('rootTable must equal the first tables[] entry');
  });

  it('rejects duplicate fields and duplicate view field names', () => {
    const errors = validateViewObject({
      ...VALID,
      fields: [
        { tableName: 'T000', fieldName: 'MANDT' },
        { tableName: 'T000', fieldName: 'MANDT' },
      ],
    });
    expect(errors.join('; ')).toContain('is declared more than once');
  });

  it('rejects join conditions that reference undeclared tables', () => {
    const errors = validateViewObject({
      ...VALID,
      tables: [
        { tableName: 'MARA' },
        { tableName: 'MAKT', tablePosition: 2 },
      ],
      rootTable: 'MARA',
      fields: [
        { tableName: 'MARA', fieldName: 'MANDT' },
        { tableName: 'MAKT', fieldName: 'SPRAS' },
      ],
      joinConditions: [{ leftTable: 'MARA', leftField: 'MANDT', rightTable: 'T001', rightField: 'MANDT' }],
    });
    expect(errors.join('; ')).toContain('"T001" is not in tables[]');
  });
});

describe('VIEW helpers', () => {
  it('normalises DDIC view-class letters', () => {
    expect(normaliseViewClass('D')).toBe('databaseView');
    expect(normaliseViewClass('C')).toBe('maintenanceView');
    expect(normaliseViewClass('H')).toBe('helpView');
    expect(normaliseViewClass('P')).toBe('projectionView');
    expect(normaliseViewClass('databaseView')).toBe('databaseView');
    expect(normaliseViewClass(undefined)).toBe('databaseView');
  });

  it('ships an agent example usable by `create --schema VIEW`', () => {
    const example = getViewJsonExample();
    expect(example).toContain('"formatVersion": "1"');
    expect(example).toContain('"viewClass": "databaseView"');
    expect(example).toContain('"joinConditions"');
  });
});
