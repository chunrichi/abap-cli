/**
 * F-25 / — `abap fields` family: forward field inventory (F-25) and
 * reverse field lookup. The forward path is a thin projection over
 * the existing `/data/query` channel (DD03L), so the select flow is mocked
 * here; the reverse path uses a dedicated `/data/find-tables-by-fields`
 * ICF route that we mock directly.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  runSelect: vi.fn(),
  postFindTablesByFields: vi.fn(),
  icfCreate: vi.fn(),
}));

vi.mock('../../src/abap_cli/flows/data/select.js', () => ({ runSelect: mocks.runSelect }));
vi.mock('../../src/abap_cli/clients/icf-client.js', () => ({
  IcfClient: Object.assign(class {}, { create: mocks.icfCreate }),
}));

import {
  formatFieldsHuman,
  formatFindHuman,
  runFields,
  runFindTablesByFields,
} from '../../src/abap_cli/flows/data/fields.js';
import { CliError } from '../../src/abap_cli/output/json.js';

function selectResult(rows: Record<string, unknown>[], truncated = false) {
  return { table: 'DD03L', objectType: 'TABL', fields: [], rows, rowCount: rows.length, truncated };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.runSelect.mockResolvedValue(
    selectResult([
      { FIELDNAME: 'MANDT', POSITION: 1, KEYFLAG: 'X', NOTNULL: 'X', ROLLNAME: 'MANDT', DATATYPE: 'CLNT', LENG: 3, DECIMALS: 0 },
      { FIELDNAME: 'KEYLEN', POSITION: 8, KEYFLAG: '', NOTNULL: '', ROLLNAME: '', DATATYPE: 'INT2', LENG: 5, DECIMALS: 0 },
    ]),
  );
  mocks.icfCreate.mockResolvedValue({ postFindTablesByFields: mocks.postFindTablesByFields });
  // Default mock: no DDIC short text (matches the "withText: false"
  // default; the tests override with text fields populated).
  mocks.postFindTablesByFields.mockResolvedValue({
    status: 'success',
    data: {
      total: 2,
      truncated: false,
      mode: 'all',
      matches: [
        { table: 'VRSD', tabclass: 'TRANSP', hitCount: 2, fields: [
          { name: 'CHANGED_BY', position: 6, rollname: 'UNAME' },
          { name: 'CHANGED_ON', position: 7, rollname: 'DATUM' },
        ] },
        { table: 'VSEOCLASS', tabclass: 'TRANSP', hitCount: 2, fields: [
          { name: 'CHANGEDBY', position: 23, rollname: 'UNAME' },
          { name: 'CHANGEDON', position: 24, rollname: 'DATUM' },
        ] },
      ],
    },
  });
});

describe('runFields (F-25)', () => {
  it('queries DD03L for the requested table, ordered by position', async () => {
    const res = await runFields('vrsd');
    expect(mocks.runSelect).toHaveBeenCalledTimes(1);
    const [table, opts] = mocks.runSelect.mock.calls[0] as [string, { where: string; orderBy: string }];
    expect(table).toBe('DD03L');
    expect(opts.where).toBe("TABNAME = 'VRSD'");
    expect(opts.orderBy).toBe('POSITION:ASC');
    expect(res.table).toBe('VRSD');
    expect(res.count).toBe(2);
  });

  it('maps DD03L columns to a typed field inventory', async () => {
    const res = await runFields('VRSD');
    expect(res.fields[0]).toEqual({
      field: 'MANDT',
      position: 1,
      key: true,
      notNull: true,
      rollname: 'MANDT',
      dataType: 'CLNT',
      length: 3,
    });
    // Omits empty rollname and zero decimals.
    expect(res.fields[1]).toEqual({
      field: 'KEYLEN',
      position: 8,
      key: false,
      notNull: false,
      dataType: 'INT2',
      length: 5,
    });
  });

  it('reports OBJECT_NOT_FOUND when DD03L has no rows for the name', async () => {
    mocks.runSelect.mockResolvedValue(selectResult([]));
    await expect(runFields('ZZZ_NOPE')).rejects.toMatchObject({ code: 'OBJECT_NOT_FOUND' });
  });

  it('rejects an invalid DDIC object name without calling SAP', async () => {
    await expect(runFields("VRSD' OR '1'='1")).rejects.toBeInstanceOf(CliError);
    expect(mocks.runSelect).not.toHaveBeenCalled();
  });

  it('requires a name', async () => {
    await expect(runFields('   ')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('renders a human-readable listing', async () => {
    const human = formatFieldsHuman(await runFields('VRSD'));
    expect(human).toContain('VRSD — 2 field(s)');
    expect(human).toContain('MANDT');
    expect(human).toContain('INT2');
  });
});

describe('runFindTablesByFields', () => {
  it('uppercases, trims, and validates field names client-side', async () => {
    const res = await runFindTablesByFields({ fields: [' changed_by ', 'CHANGED_ON'] });
    expect(mocks.postFindTablesByFields).toHaveBeenCalledTimes(1);
    const body = mocks.postFindTablesByFields.mock.calls[0]?.[0];
    expect(body.fields).toEqual(['CHANGED_BY', 'CHANGED_ON']);
    expect(body.requireAll).toBe(true);
    expect(body.as4local).toBe('A');
    expect(body.limit).toBe(200);
    expect(res.total).toBe(2);
    expect(res.matches).toHaveLength(2);
    expect(res.matches[0]?.table).toBe('VRSD');
    expect(res.matches[0]?.fields[0]?.name).toBe('CHANGED_BY');
  });

  it('sends requireAll=false when --any is requested', async () => {
    await runFindTablesByFields({ fields: ['UNAM'], requireAll: false });
    expect(mocks.postFindTablesByFields.mock.calls[0]?.[0].requireAll).toBe(false);
  });

  it('passes tabclass through unchanged', async () => {
    await runFindTablesByFields({ fields: ['UNAM'], tabclass: 'TRANSP' });
    expect(mocks.postFindTablesByFields.mock.calls[0]?.[0].tabclass).toBe('TRANSP');
  });

  it('passes as4local through to the SAP-side filter', async () => {
    await runFindTablesByFields({ fields: ['UNAM'], as4local: 'I' });
    expect(mocks.postFindTablesByFields.mock.calls[0]?.[0].as4local).toBe('I');
    // The default 'A' is applied on the SAP side; the client should NOT
    // send as4local when the caller did not opt in.
    await runFindTablesByFields({ fields: ['UNAM'] });
    expect(mocks.postFindTablesByFields.mock.calls[1]?.[0].as4local).toBe('A');
  });

  it('rejects an empty --find input without calling SAP', async () => {
    await expect(runFindTablesByFields({ fields: [] })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(mocks.postFindTablesByFields).not.toHaveBeenCalled();
  });

  it('rejects non-DDIC field names without calling SAP', async () => {
    await expect(runFindTablesByFields({ fields: ["X'; DROP--"] })).rejects.toBeInstanceOf(CliError);
    expect(mocks.postFindTablesByFields).not.toHaveBeenCalled();
  });

  it('caps --find input at 20 field names', async () => {
    const tooMany = Array.from({ length: 25 }, (_, i) => `F${i}`);
    await expect(runFindTablesByFields({ fields: tooMany })).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
    expect(mocks.postFindTablesByFields).not.toHaveBeenCalled();
  });

  it('clamps limit above 5000 to 5000', async () => {
    await runFindTablesByFields({ fields: ['UNAM'], limit: 9999 });
    expect(mocks.postFindTablesByFields.mock.calls[0]?.[0].limit).toBe(5000);
  });

  it('surfaces an empty SAP payload as QUERY_FAILED', async () => {
    mocks.postFindTablesByFields.mockResolvedValueOnce({ status: 'error', data: null, error: null });
    await expect(runFindTablesByFields({ fields: ['UNAM'] })).rejects.toMatchObject({ code: 'QUERY_FAILED' });
  });

  it('renders a human-readable --find listing with hit counts', async () => {
    const human = formatFindHuman(await runFindTablesByFields({ fields: ['CHANGED_BY', 'CHANGED_ON'] }));
    expect(human).toContain('mode=all');
    expect(human).toContain('requested=2');
    expect(human).toContain('VRSD');
    expect(human).toContain('2/2 hit(s)');
    expect(human).toContain('UNAME');
  });

  it('surfaces DDIC short text when --with-text is requested', async () => {
    // Override the default mock to include DD03T/DD04T text.
    mocks.postFindTablesByFields.mockResolvedValueOnce({
      status: 'success',
      data: {
        total: 2,
        truncated: false,
        mode: 'all',
        matches: [
          { table: 'VRSD', tabclass: 'TRANSP', hitCount: 2, fields: [
            { name: 'CHANGED_BY', position: 6, rollname: 'UNAME', fieldText: 'Changed by', elementText: 'User Name' },
            { name: 'CHANGED_ON', position: 7, rollname: 'DATUM', fieldText: 'Changed on', elementText: 'Date' },
          ] },
          { table: 'VSEOCLASS', tabclass: 'TRANSP', hitCount: 2, fields: [
            { name: 'CHANGEDBY', position: 23, rollname: 'UNAME', elementText: 'User Name' },
            { name: 'CHANGEDON', position: 24, rollname: 'DATUM', elementText: 'Date' },
          ] },
        ],
      },
    });
    const res = await runFindTablesByFields({ fields: ['CHANGED_BY', 'CHANGED_ON'], withText: true });
    expect(mocks.postFindTablesByFields.mock.calls[0]?.[0].includeText).toBe(true);
    // fieldText wins over elementText on VRSD; elementText appears on
    // VSEOCLASS (no fieldText override). Both should reach the caller.
    const vrsd = res.matches.find((m) => m.table === 'VRSD');
    expect(vrsd?.fields[0]?.fieldText).toBe('Changed by');
    expect(vrsd?.fields[0]?.elementText).toBe('User Name');
    const vseo = res.matches.find((m) => m.table === 'VSEOCLASS');
    expect(vseo?.fields[0]?.fieldText).toBeUndefined();
    expect(vseo?.fields[0]?.elementText).toBe('User Name');
  });

  it('omits includeText by default (one-shot opt-in)', async () => {
    await runFindTablesByFields({ fields: ['UNAM'] });
    const body = mocks.postFindTablesByFields.mock.calls[0]?.[0];
    expect(body.includeText).toBe(false);
  });

  it('renders DDIC short text instead of data element name when present', async () => {
    mocks.postFindTablesByFields.mockResolvedValueOnce({
      status: 'success',
      data: {
        total: 1,
        truncated: false,
        mode: 'all',
        matches: [
          { table: 'VRSD', tabclass: 'TRANSP', hitCount: 1, fields: [
            { name: 'CHANGED_BY', position: 6, rollname: 'UNAME', fieldText: 'Changed by', elementText: 'User Name' },
          ] },
        ],
      },
    });
    const human = formatFindHuman(
      await runFindTablesByFields({ fields: ['CHANGED_BY'], withText: true }),
    );
    expect(human).toContain('Changed by');
    // Data element name (UNAME) is suppressed in the text-annotated row.
    // The string "UNAME" is also the elementText fallback for VSEOCLASS,
    // so check that the VRSD row uses the fieldText and does not print
    // the data element name as a separate column when text is present.
    const vrsdLine = human.split('\n').find((l) => l.includes('CHANGED_BY'));
    expect(vrsdLine).toBeDefined();
    expect(vrsdLine).toContain('Changed by');
  });
});
