/**
 * F-25 — `abap fields <table>`: the field inventory the CLI never had.
 *
 * The flow is a thin projection over the existing `/data/query` channel
 * (DD03L), so the select flow is mocked here; the live path is covered by
 * `abap fields VRSD` against a real system.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ runSelect: vi.fn() }));

vi.mock('../../src/abap_cli/flows/data/select.js', () => ({ runSelect: mocks.runSelect }));

import { formatFieldsHuman, runFields } from '../../src/abap_cli/flows/data/fields.js';
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
