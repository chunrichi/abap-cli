/**
 * Static invariants for the XSLT ICF handler source.
 *
 * There is no local ABAP compiler in the CI gate, so these cheap textual checks
 * catch the mistakes that would otherwise only surface on `abap deploy`:
 * a declared-but-unimplemented (or implemented-but-undeclared) method, a stale
 * class name, and drift between the handler route and the deploy manifest.
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const XSLT_SRC = path.join(ROOT, 'abap', 'src', 'zcl_abap_vibe_icf_xslt.clas.abap');
const TYPES_SRC = path.join(ROOT, 'abap', 'src', 'zcl_abap_vibe_icf_types.clas.abap');
const HANDLER_SRC = path.join(ROOT, 'abap', 'src', 'zcl_abap_vibe_icf.clas.abap');
const MANIFEST = path.join(ROOT, 'abap', 'deploy.json');

function read(file: string): string {
  return fs.readFileSync(file, 'utf8');
}

function declaredMethods(source: string): string[] {
  const names: string[] = [];
  for (const match of source.matchAll(/^\s*CLASS-METHODS\s+([a-z0-9_]+)/gim)) {
    names.push(match[1]!.toLowerCase());
  }
  return names;
}

function implementedMethods(source: string): string[] {
  const names: string[] = [];
  for (const match of source.matchAll(/^\s*METHOD\s+([a-z0-9_]+)\.\s*$/gim)) {
    names.push(match[1]!.toLowerCase());
  }
  return names;
}

describe('XSLT ICF handler source invariants', () => {
  it('declares and implements the same class methods', () => {
    const source = read(XSLT_SRC);
    const declared = [...new Set(declaredMethods(source))].sort();
    const implemented = [...new Set(implementedMethods(source))].sort();
    expect(declared.length).toBeGreaterThan(5);
    expect(implemented).toEqual(declared);
  });

  it('keeps the class name in sync with its AFF file names', () => {
    const source = read(XSLT_SRC);
    expect(source.startsWith('CLASS zcl_abap_vibe_icf_xslt DEFINITION')).toBe(true);
    expect(source).toContain('CLASS zcl_abap_vibe_icf_xslt IMPLEMENTATION.');
    expect(fs.existsSync(XSLT_SRC.replace(/\.clas\.abap$/, '.clas.json'))).toBe(true);
  });

  it('uses the shared wire types for GET/POST/DELETE payloads', () => {
    const types = read(TYPES_SRC);
    for (const typeName of ['ty_xslt_header', 'ty_xslt_data', 'ty_xslt_get', 'ty_xslt_write_request', 'ty_xslt_write']) {
      expect(types, `missing ${typeName}`).toContain(`BEGIN OF ${typeName},`);
    }
    // GET carries the package for the CLI delete transport check.
    const dataBlock = types.slice(types.indexOf('BEGIN OF ty_xslt_data,'), types.indexOf('END OF ty_xslt_data,'));
    expect(dataBlock).toMatch(/package\s+TYPE string/);
  });

  it('is routed from the handler main and registered in the deploy manifest', () => {
    const handler = read(HANDLER_SRC);
    expect(handler).toMatch(/lv_path CP '\/xslt\/\*'/);
    expect(handler).toContain('zcl_abap_vibe_icf_xslt=>dispatch_xslt');
    const manifest = JSON.parse(read(MANIFEST)) as {
      merged: { global: string; local: string }[];
    };
    expect(manifest.merged).toContainEqual({ global: 'ZCL_ABAP_VIBE_ICF_XSLT', local: 'lcl_xslt' });
  });

  it('updates in place via set_source and creates via the line-table create_new', () => {
    const source = read(XSLT_SRC);
    // Update: load -> set_changeable -> set_source -> save -> activate.
    expect(source).toMatch(/lo_existing->set_source/);
    expect(source).toMatch(/lo_existing->set_changeable/);
    // Create: line-table create_new (create_new_from_string collapses long
    // sources into one >255-char line through derive_transformation_source).
    expect(source).toContain('cl_o2_api_xsltdesc=>create_new');
    expect(source).not.toContain('=>create_new_from_string');
    expect(source).toContain('source_to_lines');
    expect(source).toContain('O2PAGELINE');
  });

  it('has no tabs', () => {
    expect(read(XSLT_SRC).includes('\t')).toBe(false);
  });
});
