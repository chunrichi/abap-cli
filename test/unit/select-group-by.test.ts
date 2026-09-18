/**
 * F-12 — `abap select --group-by <field>`.
 *
 * The feedback needed "objtype distribution over VRSD" and had to write a
 * throwaway ABAP class because `select` could not express aggregates. The
 * aggregate is served by the ICF `/data/query` endpoint when the request carries
 * `groupBy`; these tests pin the CLI-side contract (validation, wire field,
 * response mapping, dry-run) without touching SAP.
 */
import { describe, expect, it } from 'vitest';
import {
  buildDataQueryRequest,
  buildDryRun,
  buildSelectRequest,
  interpret,
  validateGroupBy,
} from '../../src/abap_cli/flows/data/select.js';

describe('validateGroupBy', () => {
  it('uppercases a valid field name', () => {
    expect(validateGroupBy('objtype')).toBe('OBJTYPE');
    expect(validateGroupBy('  objtype ')).toBe('OBJTYPE');
  });

  it('treats blank input as absent', () => {
    expect(validateGroupBy(undefined)).toBeUndefined();
    expect(validateGroupBy('   ')).toBeUndefined();
  });

  it('rejects expressions and injections', () => {
    for (const bad of ['COUNT(*)', 'A,B', "OBJTYPE' OR '1'='1", 'OBJ TYPE', '1ABC']) {
      expect(() => validateGroupBy(bad)).toThrowError(/single field name/);
    }
  });
});

describe('buildSelectRequest --group-by', () => {
  it('carries groupBy through', () => {
    const req = buildSelectRequest({ groupBy: 'objtype', limit: 10 });
    expect(req.groupBy).toBe('OBJTYPE');
  });

  it('rejects combinations that the aggregation result cannot honour', () => {
    expect(() => buildSelectRequest({ groupBy: 'OBJTYPE', fields: 'OBJNAME' })).toThrowError(
      /--fields cannot be combined with --group-by/,
    );
    expect(() => buildSelectRequest({ groupBy: 'OBJTYPE', orderBy: 'OBJNAME:ASC' })).toThrowError(
      /--order-by cannot be combined with --group-by/,
    );
    expect(() => buildSelectRequest({ groupBy: 'OBJTYPE', countOnly: true })).toThrowError(
      /--count-only cannot be combined with --group-by/,
    );
    expect(() => buildSelectRequest({ groupBy: 'OBJTYPE', offset: '20' })).toThrowError(
      /--offset cannot be combined with --group-by/,
    );
  });

  it('allows --where and --limit (top N groups)', () => {
    const req = buildSelectRequest({ groupBy: 'OBJTYPE', where: "AUTHOR = 'DEVELOPER'", limit: 5 });
    expect(req.groupBy).toBe('OBJTYPE');
    expect(req.where).toBe("AUTHOR = 'DEVELOPER'");
    expect(req.limit).toBe(5);
  });
});

describe('buildDataQueryRequest --group-by', () => {
  it('emits the camelCase groupBy field, and omits it otherwise', () => {
    const withGroup = buildDataQueryRequest(buildSelectRequest({ groupBy: 'OBJTYPE' }));
    expect(withGroup.groupBy).toBe('OBJTYPE');
    const without = buildDataQueryRequest(buildSelectRequest({}));
    expect(without.groupBy).toBeUndefined();
  });
});

describe('interpret --group-by', () => {
  const req = { ...buildSelectRequest({ groupBy: 'OBJTYPE', limit: 3 }), table: 'VRSD' };

  it('maps the aggregation payload to groups + CNT', () => {
    const result = interpret(
      'VRSD',
      req,
      {
        status: 'success',
        data: {
          table: 'VRSD',
          objectType: 'TABL',
          groupBy: 'OBJTYPE',
          groups: [
            { OBJTYPE: 'METH', CNT: 1409 },
            { OBJTYPE: 'CINC', CNT: 479 },
          ],
        },
      },
      12,
    );
    expect(result.groupBy).toBe('OBJTYPE');
    expect(result.groups).toEqual([
      { OBJTYPE: 'METH', CNT: 1409 },
      { OBJTYPE: 'CINC', CNT: 479 },
    ]);
    expect(result.fields).toEqual(['OBJTYPE', 'CNT']);
    expect(result.rowCount).toBe(2);
    expect(result.countOnly).toBe(false);
  });

  it('tolerates an empty aggregation result', () => {
    const result = interpret('VRSD', req, { status: 'success', data: { table: 'VRSD', groups: [] } }, 3);
    expect(result.groups).toEqual([]);
    expect(result.rowCount).toBe(0);
  });
});

describe('buildDryRun --group-by', () => {
  it('describes the aggregation without a SAP call', () => {
    const dry = buildDryRun('VRSD', { groupBy: 'OBJTYPE', limit: 4, dryRun: true });
    expect(dry.groupBy).toBe('OBJTYPE');
    expect(dry.fields).toEqual(['OBJTYPE', 'CNT']);
    expect(dry.groups).toEqual([]);
    expect(dry.wouldRun).toBe(true);
  });
});
