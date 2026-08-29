import { describe, expect, it } from 'vitest';
import { folderFor } from '../../src/abap_cli/formats/type-folder.js';

describe('folderFor (local type→subdirectory mapping, Q5=B)', () => {
  it('maps every supported type code to its abapGit-style folder', () => {
    expect(folderFor('CLAS')).toBe('clas');
    expect(folderFor('INTF')).toBe('intf');
    expect(folderFor('PROG')).toBe('prog');
    expect(folderFor('FUGR')).toBe('fugr');
    expect(folderFor('TABL')).toBe('tabl');
    expect(folderFor('DOMA')).toBe('doma');
    expect(folderFor('STRU')).toBe('stru');
    expect(folderFor('DTEL')).toBe('dtel');
    // HTTP service lives under <root>/http/.
    expect(folderFor('HTTP')).toBe('http');
  });

  it('strips ADT subtype suffixes (e.g. PROG/P, CLAS/OC) before mapping', () => {
    expect(folderFor('PROG/P')).toBe('prog');
    expect(folderFor('PROG/I')).toBe('prog');
    expect(folderFor('CLAS/OC')).toBe('clas');
  });

  it('is case-insensitive', () => {
    expect(folderFor('clas')).toBe('clas');
    expect(folderFor('ClAs')).toBe('clas');
    expect(folderFor('DOMA')).toBe('doma');
  });

  it('falls back to "unknown" for unsupported types so we never write outside the documented layout', () => {
    expect(folderFor('TTYP')).toBe('unknown');
    expect(folderFor('MSAG')).toBe('unknown');
    expect(folderFor('SCREEN')).toBe('unknown');
    expect(folderFor('')).toBe('unknown');
  });
});