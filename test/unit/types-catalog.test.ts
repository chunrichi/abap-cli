/**
 * S-5 — `abap types` static catalog.
 *
 * The catalog is pure local data; it must not call SAP. These tests
 * pin down the gotchas the field report called out:
 *   - CLI HTTP ↔ TADIR SICF (not HTTP)
 *   - CLI STRU ↔ TADIR TABL + DD02L-TABCLASS=INTTAB
 */
import { describe, expect, it } from 'vitest';
import {
  typeCatalog,
  tadirObjectFor,
  ddicTabclassFor,
  tadirWhereFor,
} from '../../src/abap_cli/flows/setup/types-catalog.js';
import { registerTypesCommand } from '../../src/abap_cli/commands/types.js';
import { makeProgram, runCommand } from './cli-helper.js';

describe('types-catalog (S-5)', () => {
  it('contains every supported CLI type code from the registry', () => {
    const codes = typeCatalog().map((r) => r.cliType);
    // Sanity: at least one entry per main family.
    expect(codes).toContain('CLAS');
    expect(codes).toContain('PROG');
    expect(codes).toContain('TABL');
    expect(codes).toContain('STRU');
    expect(codes).toContain('HTTP');
    expect(codes).toContain('TRAN');
    expect(codes.length).toBeGreaterThanOrEqual(20);
  });

  it('maps CLI HTTP to TADIR SICF (the documented gotcha)', () => {
    expect(tadirObjectFor('HTTP')).toBe('SICF');
    // CLI STRU maps to TADIR TABL — disambiguated via DD02L tabclass.
    expect(tadirObjectFor('STRU')).toBe('TABL');
    // Sanity: TABL and TRAN are 1:1.
    expect(tadirObjectFor('TABL')).toBe('TABL');
    expect(tadirObjectFor('TRAN')).toBe('TRAN');
  });

  it('exposes the DDIC tabclass filter for STRU', () => {
    expect(ddicTabclassFor('STRU')).toBe('INTTAB');
    expect(ddicTabclassFor('TABL')).toBe('TRANSP');
    // Non-DDIC types return empty.
    expect(ddicTabclassFor('CLAS')).toBe('');
    expect(ddicTabclassFor('HTTP')).toBe('');
  });

  it('builds a TADIR where-clause with the tabclass subquery for STRU', () => {
    const where = tadirWhereFor('STRU');
    expect(where).toBe(
      "pgmid = 'R3TR' AND object = 'TABL' AND object IN (SELECT tabname FROM dd02l WHERE as4local = 'A' AND tabclass = 'INTTAB')",
    );
  });

  it('builds a TADIR where-clause without the tabclass subquery for non-DDIC types', () => {
    const where = tadirWhereFor('CLAS');
    expect(where).toBe("pgmid = 'R3TR' AND object = 'CLAS'");
    // No tabclass subquery for HTTP either (SICF is not in DD02L).
    const where2 = tadirWhereFor('HTTP');
    expect(where2).toBe("pgmid = 'R3TR' AND object = 'SICF'");
  });

  it('throws on unknown CLI type', () => {
    expect(() => tadirWhereFor('NOT_A_TYPE')).toThrow(/Unknown CLI type code/);
  });

  it('marks each row with channel + AFF schema, and no local folder (flat layout)', () => {
    const clas = typeCatalog().find((r) => r.cliType === 'CLAS');
    expect(clas?.channel).toBe('ADT');
    expect(clas?.affSchema).toBe('clas-v1.json');

    const tabl = typeCatalog().find((r) => r.cliType === 'TABL');
    expect(tabl?.channel).toBe('ICF');

    for (const row of typeCatalog()) {
      expect('folder' in row).toBe(false);
    }
  });
});

describe('abap types CLI output (flat layout)', () => {
  it('human table has no FOLDER column and no Local folder line', async () => {
    const program = makeProgram();
    registerTypesCommand(program);
    const res = await runCommand(program, ['types']);
    expect(res.exitCode).toBeUndefined();
    expect(res.stdout).not.toContain('FOLDER');
    expect(res.stdout).not.toContain('Local folder');
    expect(res.stdout).toContain('AFF SCHEMA');
  });

  it('--json rows carry channel + affSchema but no folder field', async () => {
    const program = makeProgram();
    registerTypesCommand(program);
    const res = await runCommand(program, ['types', '--json']);
    expect(res.exitCode).toBeUndefined();
    const rows = JSON.parse(res.stdout).data as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThanOrEqual(20);
    for (const row of rows) {
      expect('folder' in row).toBe(false);
      expect(typeof row.channel).toBe('string');
      expect(typeof row.affSchema).toBe('string');
    }
  });
});
