import { describe, expect, it } from 'vitest';
import {
  buildDryRun,
  runSelect,
  validateLimit,
  validateOffset,
  validateWhere,
  validateFields,
  validateOrderBy,
  type SelectResult,
} from '../../src/abap_cli/flows/select-flow.js';
import { IcfClient } from '../../src/abap_cli/clients/icf-client.js';
import { CliError } from '../../src/abap_cli/output/json.js';

/**
 * Build a fake IcfClient that returns the given payload verbatim from
 * `postDataQuery`. Captures the request body so tests can assert the wire
 * payload shape.
 */
function fakeClient(
  payload: { status: 'success' | 'error'; data?: unknown; error?: unknown },
  onCall: (body: unknown) => void,
): IcfClient {
  return {
    postDataQuery: async (body: unknown) => {
      onCall(body);
      return payload as { status: 'success'; data: unknown };
    },
  } as unknown as IcfClient;
}

describe('select-flow-basic-success (US1)', () => {
  it('returns success envelope with rows + rowCount + truncated', async () => {
    const client = fakeClient(
      {
        status: 'success',
        data: {
          table: 'ZTAB_FIXTURE',
          objectType: 'TABL',
          fields: ['MANDT', 'ID', 'STATUS'],
          rows: [
            { MANDT: '001', ID: '0000000001', STATUS: 'X' },
            { MANDT: '001', ID: '0000000002', STATUS: 'X' },
          ],
          rowCount: 2,
          truncated: false,
          excludedFields: [],
          durationMs: 12,
        },
      },
      () => {},
    );
    const result = await runSelect('ZTAB_FIXTURE', { limit: 10 }, client);
    expect(result.table).toBe('ZTAB_FIXTURE');
    expect(result.objectType).toBe('TABL');
    expect(result.rowCount).toBe(2);
    expect(result.truncated).toBe(false);
    expect(result.rows).toHaveLength(2);
    expect(result.fields).toEqual(['MANDT', 'ID', 'STATUS']);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('sends the table name (uppercased) in the wire payload', async () => {
    let capturedBody: unknown;
    const client = fakeClient(
      {
        status: 'success',
        data: { table: 'ZTAB_FIXTURE', objectType: 'TABL', fields: [], rows: [], rowCount: 0, truncated: false, excludedFields: [] },
      },
      (b) => { capturedBody = b; },
    );
    await runSelect('ztab_fixture', {}, client);
    expect(capturedBody).toMatchObject({ table: 'ZTAB_FIXTURE' });
  });
});

describe('select-flow-empty-result (US1)', () => {
  it('returns empty rows + rowCount=0 + truncated=false', async () => {
    const client = fakeClient(
      {
        status: 'success',
        data: { table: 'ZTAB_FIXTURE', objectType: 'TABL', fields: ['MANDT'], rows: [], rowCount: 0, truncated: false, excludedFields: [] },
      },
      () => {},
    );
    const result = await runSelect('ZTAB_FIXTURE', { limit: 50 }, client);
    expect(result.rows).toEqual([]);
    expect(result.rowCount).toBe(0);
    expect(result.truncated).toBe(false);
  });
});

describe('select-flow-default-limit (US1)', () => {
  it('defaults limit to 100 when not specified', async () => {
    let capturedBody: unknown;
    const client = fakeClient(
      {
        status: 'success',
        data: { table: 'ZTAB_FIXTURE', objectType: 'TABL', fields: [], rows: [], rowCount: 0, truncated: false, excludedFields: [] },
      },
      (b) => { capturedBody = b; },
    );
    await runSelect('ZTAB_FIXTURE', {}, client);
    expect(capturedBody).toMatchObject({ limit: 100 });
    expect(capturedBody).toMatchObject({ offset: 0 });
  });
});

describe('select-flow-truncation (US1)', () => {
  it('returns truncated=true when rowCount equals limit (probe fetched limit+1)', async () => {
    const client = fakeClient(
      {
        status: 'success',
        data: {
          table: 'ZTAB_FIXTURE',
          objectType: 'TABL',
          fields: ['ID'],
          rows: Array.from({ length: 50 }, (_, i) => ({ ID: String(i + 1).padStart(10, '0') })),
          rowCount: 50,
          truncated: true,
          excludedFields: [],
        },
      },
      () => {},
    );
    const result = await runSelect('ZTAB_FIXTURE', { limit: 50 }, client);
    expect(result.rowCount).toBe(50);
    expect(result.truncated).toBe(true);
  });
});

describe('select-flow-dry-run (US1)', () => {
  it('returns a dry-run envelope without invoking the ICF client', () => {
    const dry: SelectResult = buildDryRun('ZTAB_FIXTURE', { limit: 10, where: "STATUS = 'X'" });
    expect(dry.dryRun).toBe(true);
    expect(dry.wouldRun).toBe(true);
    expect(dry.table).toBe('ZTAB_FIXTURE');
    expect(dry.limit).toBe(10);
    expect(dry.rows).toEqual([]);
    expect(dry.rowCount).toBe(0);
  });
});

describe('select validateLimit / validateOffset (US1)', () => {
  it('accepts integer in [1, 10000]', () => {
    expect(validateLimit('100')).toBe(100);
    expect(validateLimit(1)).toBe(1);
    expect(validateLimit(10000)).toBe(10000);
    expect(validateLimit(undefined)).toBe(100);
  });
  it('rejects out-of-range values', () => {
    expect(() => validateLimit(0)).toThrow(CliError);
    expect(() => validateLimit(10001)).toThrow(CliError);
    expect(() => validateLimit('abc')).toThrow(CliError);
  });
  it('accepts integer in [0, 100000]', () => {
    expect(validateOffset('0')).toBe(0);
    expect(validateOffset(100000)).toBe(100000);
    expect(validateOffset(undefined)).toBe(0);
  });
  it('rejects out-of-range offset', () => {
    expect(() => validateOffset(-1)).toThrow(CliError);
    expect(() => validateOffset(100001)).toThrow(CliError);
  });
  it('rejects where clause longer than 2000 chars', () => {
    expect(() => validateWhere('X'.repeat(2001))).toThrow(CliError);
    expect(validateWhere('X'.repeat(2000))).toBe('X'.repeat(2000));
  });
  it('validateFields: splits CSV, dedupes, uppercases', () => {
    expect(validateFields('id,STATUS,id')).toEqual(['ID', 'STATUS']);
    expect(validateFields(undefined)).toBeUndefined();
    expect(() => validateFields('123abc')).toThrow(CliError);
  });
  it('validateOrderBy: rejects bad direction', () => {
    expect(validateOrderBy('ID:ASC,AMOUNT:DESC')).toEqual([
      { field: 'ID', direction: 'ASC' },
      { field: 'AMOUNT', direction: 'DESC' },
    ]);
    expect(() => validateOrderBy('ID:UP')).toThrow(CliError);
    expect(() => validateOrderBy('IDNoColon')).toThrow(CliError);
  });
});

describe('select error mapping (US1)', () => {
  it('maps TABLE_NOT_FOUND to CliError with NOT_FOUND category', async () => {
    const client = fakeClient(
      {
        status: 'error',
        error: { code: 'TABLE_NOT_FOUND', message: 'table ZNOTFOUND does not exist' },
      },
      () => {},
    );
    await expect(runSelect('ZNOTFOUND', {}, client)).rejects.toMatchObject({
      code: 'TABLE_NOT_FOUND',
      message: expect.stringContaining('ZNOTFOUND'),
    });
  });

  it('maps TABLE_TYPE_NOT_SUPPORTED with details.objectType', async () => {
    const client = fakeClient(
      {
        status: 'error',
        error: {
          code: 'TABLE_TYPE_NOT_SUPPORTED',
          message: 'pool/cluster not queryable',
          details: { objectType: 'POOL' },
        },
      },
      () => {},
    );
    await expect(runSelect('ZPOOL', {}, client)).rejects.toMatchObject({
      code: 'TABLE_TYPE_NOT_SUPPORTED',
      details: expect.objectContaining({ objectType: 'POOL' }),
    });
  });

  it('maps INVALID_FIELD with validFields', async () => {
    const client = fakeClient(
      {
        status: 'error',
        error: {
          code: 'INVALID_FIELD',
          message: 'field NOPE not in table',
          details: { validFields: ['ID', 'STATUS'] },
        },
      },
      () => {},
    );
    await expect(runSelect('ZTAB_FIXTURE', { fields: 'NOPE' }, client)).rejects.toMatchObject({
      code: 'INVALID_FIELD',
      details: expect.objectContaining({ validFields: ['ID', 'STATUS'] }),
    });
  });

  it('falls back to SAP_ERROR for unknown codes', async () => {
    const client = fakeClient(
      { status: 'error', error: { code: 'SOMETHING_NEW', message: 'unexpected' } },
      () => {},
    );
    await expect(runSelect('ZTAB_FIXTURE', {}, client)).rejects.toMatchObject({
      code: 'SAP_ERROR',
    });
  });
});
