/**
 * SHLP local-extension mapping: shlp-v1 document ↔ ICF wire, schema +
 * semantic validation, kind normalisation and the agent example.
 */
import { describe, expect, it } from 'vitest';
import {
  getShlpJsonExample,
  normaliseDialogType,
  normaliseSelectionMethodType,
  normaliseValueDirection,
  shlpArtifact,
  validateShlpObject,
  SHLP_NAME_MAX_LENGTH,
  type ShlpLocal,
} from '../../src/abap_cli/formats/shlp/json.js';

const ELEMENTARY_WIRE = {
  formatVersion: '1',
  header: { description: 'Language', originalLanguage: 'en' },
  type: 'SHLP',
  name: 'ZCLI_TC_SHLP',
  package: '$TMP',
  kind: 'elementary',
  selectionMethod: 'T002',
  selectionMethodType: 'table',
  textTable: 'T002T',
  dialogType: 'displayValuesList',
  hotkey: '',
  parameters: [
    { fieldName: 'SPRAS', position: 1, rollName: 'SPRAS', input: true, output: true, selectionPosition: 1, listPosition: 1, defaultValue: '' },
    { fieldName: 'LAISO', position: 2, rollName: 'LAISO', output: true, selectionPosition: 0, listPosition: 2, defaultValue: '' },
  ],
  includedSearchHelps: [],
  parameterMappings: [],
};

const COLLECTIVE_WIRE = {
  formatVersion: '1',
  header: { description: 'Language (collective)', originalLanguage: 'en' },
  type: 'SHLP',
  name: 'ZCLI_TC_SHLPC',
  package: '$TMP',
  kind: 'collective',
  parameters: [
    { fieldName: 'SPRAS', position: 1, rollName: 'SPRAS', input: true, output: true, selectionPosition: 1, listPosition: 1 },
  ],
  includedSearchHelps: [
    { searchHelp: 'ZCLI_TC_SHLP', position: 1, viaSearchHelp: 'ZCLI_TC_SHLPC', hide: false },
  ],
  parameterMappings: [
    { fieldName: 'SPRAS', subSearchHelp: 'ZCLI_TC_SHLP', subFieldName: 'SPRAS', valueDirection: 'import' },
  ],
};

describe('SHLP wire → local', () => {
  it('normalises an elementary ICF payload into a clean shlp-v1 document', () => {
    const local = shlpArtifact.fromWire(ELEMENTARY_WIRE);
    expect(local).toMatchObject({
      formatVersion: '1',
      name: 'ZCLI_TC_SHLP',
      package: '$TMP',
      kind: 'elementary',
      selectionMethod: 'T002',
      selectionMethodType: 'table',
      textTable: 'T002T',
      dialogType: 'displayValuesList',
    });
    expect(local.header).toEqual({ description: 'Language', originalLanguage: 'en' });
    expect(local.parameters).toEqual([
      { fieldName: 'SPRAS', position: 1, rollName: 'SPRAS', input: true, output: true, selectionPosition: 1, listPosition: 1 },
      { fieldName: 'LAISO', position: 2, rollName: 'LAISO', output: true, listPosition: 2 },
    ]);
    expect(local.includedSearchHelps).toBeUndefined();
    expect(local.parameterMappings).toBeUndefined();
    expect(local).not.toHaveProperty('type');
  });

  it('keeps the collective include + mapping structure', () => {
    const local = shlpArtifact.fromWire(COLLECTIVE_WIRE);
    expect(local.kind).toBe('collective');
    expect(local.includedSearchHelps).toEqual([
      { searchHelp: 'ZCLI_TC_SHLP', position: 1, viaSearchHelp: 'ZCLI_TC_SHLPC' },
    ]);
    expect(local.parameterMappings).toEqual([
      { fieldName: 'SPRAS', subSearchHelp: 'ZCLI_TC_SHLP', subFieldName: 'SPRAS', valueDirection: 'import' },
    ]);
    expect(local.selectionMethod).toBeUndefined();
  });

  it('accepts DDIC letters on the read path and fills positions from the array order', () => {
    const local = shlpArtifact.fromWire({
      name: 'zcli_tc_shlp',
      header: { description: 'x', originalLanguage: 'EN' },
      kind: 'elementary',
      selectionMethod: 't002',
      selectionMethodType: 'X',
      dialogType: 'C',
      parameters: [{ fieldName: 'spras', rollName: 'spras', input: true }],
      includedSearchHelps: [{ searchHelp: 'zcli_tc_other', hide: true }],
      parameterMappings: [
        { fieldName: 'spras', subSearchHelp: 'zcli_tc_other', subFieldName: 'spras', valueDirection: 'E' },
      ],
    });
    expect(local.name).toBe('ZCLI_TC_SHLP');
    expect(local.selectionMethodType).toBe('table');
    expect(local.dialogType).toBe('dialog');
    expect(local.parameters[0]).toMatchObject({ fieldName: 'SPRAS', position: 1, rollName: 'SPRAS', input: true });
    expect(local.parameterMappings?.[0]?.valueDirection).toBe('export');
  });
});

describe('SHLP local → wire', () => {
  it('uppercases DDIC identifiers and keeps the package for the write path', () => {
    const wire = shlpArtifact.toWire({
      formatVersion: '1',
      header: { description: 'Language', originalLanguage: 'en' },
      name: 'zcli_tc_shlp',
      package: '$tmp',
      kind: 'elementary',
      selectionMethod: 't002',
      parameters: [
        { fieldName: 'spras', position: 1, rollName: 'spras', input: true, output: true },
      ],
    });
    expect(wire.name).toBe('ZCLI_TC_SHLP');
    expect(wire.package).toBe('$TMP');
    expect(wire.selectionMethod).toBe('T002');
    expect(wire.parameters[0]).toEqual({
      fieldName: 'SPRAS',
      position: 1,
      rollName: 'SPRAS',
      input: true,
      output: true,
    });
  });

  it('round-trips a pulled elementary document without losing parameters', () => {
    const local = shlpArtifact.fromWire(ELEMENTARY_WIRE);
    const back = shlpArtifact.toWire(local);
    expect(back.parameters?.map((p) => p.fieldName)).toEqual(['SPRAS', 'LAISO']);
    expect(back.parameters?.[0]).toMatchObject({ input: true, output: true, selectionPosition: 1, listPosition: 1 });
    expect(back.textTable).toBe('T002T');
    expect(back.includedSearchHelps).toBeUndefined();
  });

  it('round-trips a pulled collective document', () => {
    const local = shlpArtifact.fromWire(COLLECTIVE_WIRE);
    const back = shlpArtifact.toWire(local);
    expect(back.kind).toBe('collective');
    expect(back.includedSearchHelps).toHaveLength(1);
    expect(back.parameterMappings?.[0]).toMatchObject({ subSearchHelp: 'ZCLI_TC_SHLP', valueDirection: 'import' });
  });
});

describe('SHLP validation', () => {
  const ELEMENTARY: ShlpLocal = {
    formatVersion: '1',
    header: { description: 'Elementary', originalLanguage: 'en' },
    name: 'ZCLI_TC_SHLP',
    kind: 'elementary',
    selectionMethod: 'T002',
    parameters: [
      { fieldName: 'SPRAS', position: 1, rollName: 'SPRAS', input: true, output: true },
    ],
  };

  const COLLECTIVE: ShlpLocal = {
    formatVersion: '1',
    header: { description: 'Collective', originalLanguage: 'en' },
    name: 'ZCLI_TC_SHLPC',
    kind: 'collective',
    parameters: [{ fieldName: 'SPRAS', position: 1, rollName: 'SPRAS', input: true, output: true }],
    includedSearchHelps: [{ searchHelp: 'ZCLI_TC_SHLP', position: 1 }],
    parameterMappings: [
      { fieldName: 'SPRAS', subSearchHelp: 'ZCLI_TC_SHLP', subFieldName: 'SPRAS', valueDirection: 'import' },
    ],
  };

  it('accepts valid elementary and collective documents through schema + semantic rules', async () => {
    expect(validateShlpObject(ELEMENTARY)).toEqual([]);
    await expect(shlpArtifact.validate(ELEMENTARY)).resolves.toEqual([]);
    expect(validateShlpObject(COLLECTIVE)).toEqual([]);
    await expect(shlpArtifact.validate(COLLECTIVE)).resolves.toEqual([]);
  });

  it('rejects documents that only JSON Schema catches (extra property / bad enum)', async () => {
    const extra = await shlpArtifact.validate({ ...ELEMENTARY, unexpected: true } as unknown);
    expect(extra.join('; ')).toMatch(/additional properties/);
    const badKind = await shlpArtifact.validate({ ...ELEMENTARY, kind: 'appending' } as unknown);
    expect(badKind.join('; ')).toMatch(/kind/);
  });

  it('enforces the 30-character name limit', () => {
    const errors = validateShlpObject({ ...ELEMENTARY, name: 'Z' + 'X'.repeat(SHLP_NAME_MAX_LENGTH) });
    expect(errors.join('; ')).toMatch(/at most 30 characters|must not exceed 30/);
  });

  it('requires header.description and a two-letter language', () => {
    const errors = validateShlpObject({ ...ELEMENTARY, header: { description: '', originalLanguage: 'english' } });
    expect(errors.join('; ')).toContain('header.description is required');
    expect(errors.join('; ')).toContain('two-letter ISO code');
  });

  it('requires selectionMethod for an elementary search help and rejects mappings there', () => {
    const errors = validateShlpObject({
      ...ELEMENTARY,
      selectionMethod: '',
      includedSearchHelps: [{ searchHelp: 'ZCLI_TC_OTHER' }],
      parameterMappings: [{ fieldName: 'SPRAS', subSearchHelp: 'ZCLI_TC_OTHER', subFieldName: 'SPRAS' }],
    });
    expect(errors.join('; ')).toContain('selectionMethod is required');
    expect(errors.join('; ')).toContain('includedSearchHelps[] only applies');
    expect(errors.join('; ')).toContain('parameterMappings[] only applies');
  });

  it('requires includes + mappings for a collective search help', () => {
    const errors = validateShlpObject({ ...COLLECTIVE, includedSearchHelps: [], parameterMappings: [] });
    expect(errors.join('; ')).toContain('includedSearchHelps[] must contain');
    expect(errors.join('; ')).toContain('parameterMappings[] must map');
  });

  it('checks mapping references against declared parameters and includes', () => {
    const errors = validateShlpObject({
      ...COLLECTIVE,
      parameterMappings: [
        { fieldName: 'MATNR', subSearchHelp: 'ZCLI_TC_MISSING', subFieldName: 'MATNR' },
      ],
    });
    expect(errors.join('; ')).toContain('is not an interface parameter');
    expect(errors.join('; ')).toContain('is not in includedSearchHelps[]');
  });

  it('rejects duplicate parameters and duplicate includes', () => {
    const errors = validateShlpObject({
      ...COLLECTIVE,
      parameters: [
        { fieldName: 'SPRAS', position: 1 },
        { fieldName: 'SPRAS', position: 2 },
      ],
      includedSearchHelps: [
        { searchHelp: 'ZCLI_TC_SHLP', position: 1 },
        { searchHelp: 'ZCLI_TC_SHLP', position: 2 },
      ],
    });
    expect(errors.join('; ')).toContain('is declared more than once');
  });
});

describe('SHLP helpers', () => {
  it('normalises kind-related enums', () => {
    expect(normaliseSelectionMethodType('V')).toBe('view');
    expect(normaliseSelectionMethodType('X')).toBe('table');
    expect(normaliseSelectionMethodType(undefined)).toBe('table');
    expect(normaliseDialogType('C')).toBe('dialog');
    expect(normaliseDialogType('D')).toBe('displayValuesList');
    expect(normaliseValueDirection('E')).toBe('export');
    expect(normaliseValueDirection('I')).toBe('import');
    expect(normaliseValueDirection('C')).toBe('import');
  });

  it('ships an agent example usable by `create --schema SHLP`', () => {
    const example = getShlpJsonExample();
    expect(example).toContain('"kind": "elementary"');
    expect(example).toContain('"selectionMethod": "T002"');
    expect(example).toContain('"parameterMappings"');
  });
});
