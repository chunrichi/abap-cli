/**
 * DOCU companion contract: filename routing, AFF schema validation
 * (`docu-v1.json`), line limits and the wire→local normalization.
 *
 * DOCU is a companion schema identifier, never an object type: these tests
 * pin that it stays out of the type registry while `validate:aff` still routes
 * `*.doma.docu.json` / `*.dtel.docu.json` to it.
 */
import { describe, expect, it } from 'vitest';
import { routeAffSchema, routeType, schemaFileFor } from '../../src/abap_cli/aff/router.js';
import { affSupportedTypes } from '../../src/abap_cli/aff/schema-paths.js';
import { validateAff } from '../../src/abap_cli/aff/schema-validator.js';
import { allSupportedTypes, isSupportedType } from '../../src/abap_cli/types/registry.js';
import { TYPE_ROUTES } from '../../src/abap_cli/flows/edit/routing.js';
import {
  DOCU_FORMAT_VERSION,
  DOCU_MAX_FORMAT_LENGTH,
  DOCU_MAX_LINE_LENGTH,
  docuArtifact,
  docuCompanionPathFor,
  docuDocumentFromWire,
  isDocuSupportedType,
} from '../../src/abap_cli/formats/docu/json.js';

describe('docu router (companion suffix)', () => {
  it('routes .doma.docu.json / .dtel.docu.json to the docu schema', () => {
    expect(routeAffSchema('src/zmy_doma.doma.docu.json')).toEqual({
      type: 'DOCU',
      isJson: true,
      schemaFile: 'docu-v1.json',
    });
    expect(routeAffSchema('src/zmy_dtel.dtel.docu.json')).toEqual({
      type: 'DOCU',
      isJson: true,
      schemaFile: 'docu-v1.json',
    });
    expect(schemaFileFor('DOCU')).toBe('docu-v1.json');
  });

  it('keeps the main object documents on their own schemas', () => {
    expect(routeAffSchema('zmy_doma.doma.json')).toEqual({
      type: 'DOMA',
      isJson: true,
      schemaFile: 'doma-v1.json',
    });
    expect(routeAffSchema('zmy_dtel.dtel.json')).toEqual({
      type: 'DTEL',
      isJson: true,
      schemaFile: 'dtel-v1.json',
    });
  });

  it('does not make DOCU an object type', () => {
    expect(isSupportedType('DOCU')).toBe(false);
    expect(allSupportedTypes()).not.toContain('DOCU');
    expect(Object.keys(TYPE_ROUTES)).not.toContain('DOCU');
    // The schema resolver knows the companion schema; the registry does not.
    expect(affSupportedTypes()).toContain('DOCU');
    expect(routeType('zmy.tabl.docu.json')).toBeUndefined();
  });
});

describe('docu companion filename helper', () => {
  it('maps a DOMA/DTEL main document to its companion', () => {
    expect(docuCompanionPathFor('/w/src/zmy_doma.doma.json')).toBe('/w/src/zmy_doma.doma.docu.json');
    expect(docuCompanionPathFor('/w/src/zmy_dtel.dtel.json')).toBe('/w/src/zmy_dtel.dtel.docu.json');
    expect(docuCompanionPathFor('src/(ui2)cl_json.doma.JSON'.toLowerCase())).toBe(
      'src/(ui2)cl_json.doma.docu.json',
    );
  });

  it('ignores other files (including the companion itself)', () => {
    expect(docuCompanionPathFor('src/zmy.tabl.json')).toBeUndefined();
    expect(docuCompanionPathFor('src/zmy.doma.docu.json')).toBeUndefined();
    expect(docuCompanionPathFor('src/zcl_demo.clas.abap')).toBeUndefined();
  });

  it('narrows the docu-capable object types', () => {
    expect(isDocuSupportedType('DOMA')).toBe(true);
    expect(isDocuSupportedType('dtel')).toBe(true);
    expect(isDocuSupportedType('TABL')).toBe(false);
    expect(isDocuSupportedType(undefined)).toBe(false);
  });
});

describe('docu-v1.json validation', () => {
  it('accepts a minimal valid document', async () => {
    const result = await validateAff('DOCU', {
      formatVersion: DOCU_FORMAT_VERSION,
      lines: [{ format: '', line: 'Line one' }],
    });
    expect(result.status).toBe('pass');
    expect(result.errors).toEqual([]);
  });

  it('accepts an empty lines array (push deletes the remote long text)', async () => {
    const result = await validateAff('DOCU', { formatVersion: '1', lines: [] });
    expect(result.status).toBe('pass');
  });

  it(`rejects a line over ${DOCU_MAX_LINE_LENGTH} characters`, async () => {
    const result = await validateAff('DOCU', {
      formatVersion: '1',
      lines: [{ format: '', line: 'x'.repeat(DOCU_MAX_LINE_LENGTH + 1) }],
    });
    expect(result.status).toBe('fail');
    expect(result.errors.some((e) => e.instancePath === '/lines/0/line')).toBe(true);
  });

  it(`accepts a line at exactly ${DOCU_MAX_LINE_LENGTH} characters`, async () => {
    const result = await validateAff('DOCU', {
      formatVersion: '1',
      lines: [{ format: '', line: 'x'.repeat(DOCU_MAX_LINE_LENGTH) }],
    });
    expect(result.status).toBe('pass');
  });

  it(`rejects a paragraph format over ${DOCU_MAX_FORMAT_LENGTH} characters`, async () => {
    const result = await validateAff('DOCU', {
      formatVersion: '1',
      lines: [{ format: 'ABC', line: 'x' }],
    });
    expect(result.status).toBe('fail');
    expect(result.errors.some((e) => e.instancePath === '/lines/0/format')).toBe(true);
  });

  it('requires formatVersion "1" and rejects undeclared fields', async () => {
    expect((await validateAff('DOCU', { lines: [] })).status).toBe('fail');
    expect((await validateAff('DOCU', { formatVersion: '2', lines: [] })).status).toBe('fail');
    expect(
      (await validateAff('DOCU', { formatVersion: '1', lines: [], url: 'x' })).status,
    ).toBe('fail');
  });

  it('load() throws AFF_FIXTURE_INVALID for a bad companion file', async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const dir = mkdtempSync(path.join(os.tmpdir(), 'docu-artifact-'));
    try {
      const file = path.join(dir, 'zmy.doma.docu.json');
      writeFileSync(file, JSON.stringify({ formatVersion: '1', lines: [{ format: '', line: 'x'.repeat(73) }] }));
      await expect(docuArtifact.load(file)).rejects.toMatchObject({ code: 'AFF_FIXTURE_INVALID' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('docu wire normalization', () => {
  it('normalizes a success payload into the local document', () => {
    expect(
      docuDocumentFromWire({
        formatVersion: '1',
        lines: [{ format: 'H1', line: 'Title' }, { format: '', line: 'Body' }],
      }),
    ).toEqual({
      formatVersion: '1',
      lines: [{ format: 'H1', line: 'Title' }, { format: '', line: 'Body' }],
    });
  });

  it('treats an empty / missing lines payload as "no documentation"', () => {
    expect(docuDocumentFromWire({ formatVersion: '1', lines: [] })).toBeUndefined();
    expect(docuDocumentFromWire({ formatVersion: '1' })).toBeUndefined();
    expect(docuDocumentFromWire(null)).toBeUndefined();
  });
});
