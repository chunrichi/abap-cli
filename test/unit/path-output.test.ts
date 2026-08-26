import { describe, expect, it, vi, afterEach } from 'vitest';
import * as path from 'node:path';
import {
  toOutputPath,
  toRelativeOutputPath,
  normalizePullData,
  isPathLike,
} from '../../src/abap_cli/core/path-output.js';

describe('P0 — output-path normalization (Windows / cross-platform path contract)', () => {
  describe('toOutputPath', () => {
    it('passes POSIX paths through unchanged', () => {
      expect(toOutputPath('src/clas/zcl_demo/zcl_demo.clas.abap')).toBe('src/clas/zcl_demo/zcl_demo.clas.abap');
      expect(toOutputPath('./src/foo.abap')).toBe('src/foo.abap');
      expect(toOutputPath('README.md')).toBe('README.md');
    });

    it('rewrites host-native separators from path.join to POSIX', () => {
      // Simulates Windows `path.join('src', 'clas', 'zcl_demo')` returning `src\\clas\\zcl_demo`.
      expect(toOutputPath('src\\clas\\zcl_demo\\zcl_demo.clas.abap')).toBe('src/clas/zcl_demo/zcl_demo.clas.abap');
      // path.join on POSIX still works — toOutputPath is idempotent.
      expect(toOutputPath(path.join('src', 'clas', 'foo'))).toBe(path.join('src', 'clas', 'foo').replace(/\\/g, '/'));
    });

    it('handles mixed separators (defensive — file-resolver joining on POSIX paths but a downstream path module used \\)', () => {
      expect(toOutputPath('src/clas\\zcl_demo/zcl_demo.clas.abap')).toBe('src/clas/zcl_demo/zcl_demo.clas.abap');
    });

    it('strips a single leading "./"', () => {
      expect(toOutputPath('./foo')).toBe('foo');
    });

    it('preserves `..` segments', () => {
      expect(toOutputPath('../foo/bar')).toBe('../foo/bar');
      expect(toOutputPath('..\\foo\\bar')).toBe('../foo/bar');
    });

    it('returns empty string for empty/null/undefined without throwing', () => {
      expect(toOutputPath('')).toBe('');
      expect(toOutputPath(undefined)).toBe('');
      expect(toOutputPath(null)).toBe('');
    });

    it('passes through single-segment values that look like filenames (no separator to rewrite)', () => {
      expect(toOutputPath('zcl_demo.clas.abap')).toBe('zcl_demo.clas.abap');
      expect(toOutputPath('.abap.json')).toBe('.abap.json');
    });

    it('does not collapse `//`', () => {
      expect(toOutputPath('src//double')).toBe('src//double');
    });
  });

  describe('isPathLike', () => {
    it('accepts strings that are plausible file paths', () => {
      expect(isPathLike('src/foo.abap')).toBe(true);
      expect(isPathLike('zcl_demo.clas.abap')).toBe(true);
      expect(isPathLike('./rel')).toBe(true);
    });

    it('rejects empty, non-string, and string-with-newlines', () => {
      expect(isPathLike('')).toBe(false);
      expect(isPathLike(undefined)).toBe(false);
      expect(isPathLike(null)).toBe(false);
      expect(isPathLike(42)).toBe(false);
      expect(isPathLike('line1\nline2')).toBe(false);
      expect(isPathLike('line1\r\nline2')).toBe(false);
    });
  });

  describe('normalizePullData', () => {
    it('rewrites file, entries[].file, entries[].files, written, skipped, failed', () => {
      const input = {
        object: 'ZCL_DEMO',
        type: 'CLAS',
        entries: [
          { object: 'ZCL_DEMO', type: 'CLAS', status: 'written', file: 'src\\clas\\zcl_demo\\main.abap' },
          { object: 'ZCL_DEMO', type: 'CLAS', status: 'skipped', files: ['src\\clas\\zcl_demo\\meta.json', 'src\\clas\\zcl_demo\\main.abap'] },
        ],
        written: ['src\\clas\\zcl_demo\\main.abap'],
        skipped: ['src\\clas\\zcl_demo\\meta.json'],
        failed: [],
      };
      const out = normalizePullData(input) as typeof input;
      expect(out.entries[0]?.file).toBe('src/clas/zcl_demo/main.abap');
      expect((out.entries[1] as { files: string[] }).files).toEqual(['src/clas/zcl_demo/meta.json', 'src/clas/zcl_demo/main.abap']);
      expect(out.written).toEqual(['src/clas/zcl_demo/main.abap']);
      expect(out.skipped).toEqual(['src/clas/zcl_demo/meta.json']);
      expect(out.failed).toEqual([]);
      // object / type untouched
      expect(out.object).toBe('ZCL_DEMO');
      expect(out.type).toBe('CLAS');
    });

    it('leaves fields it does not recognise alone', () => {
      const input = { object: 'ZCL_X', code: 'FAILED', detail: 'boom' };
      const out = normalizePullData(input);
      expect(out.code).toBe('FAILED');         // code is uppercase identifier, not a path
      expect(out.detail).toBe('boom');         // not a path
      expect(out.object).toBe('ZCL_X');
    });

    it('does not touch unrelated path-shaped fields (only written/skipped/failed/entries are recognised)', () => {
      // The pull-data helper intentionally scopes its rewrite to fields the
      // agent parses back to disk. A `package: 'src\\foo'` must NOT be rewritten
      // because that is a SAP package name (no separators in real data, but
      // the contract is "scoped" not "rewrite everything").
      const input = { object: 'ZCL_X', package: 'src\\my-pkg' };
      const out = normalizePullData(input) as typeof input;
      expect(out.package).toBe('src\\my-pkg');
    });

    it('preserves top-level `file` field (legacy single-file shape)', () => {
      const input = { object: 'ZAFF', type: 'TABL', file: 'src\\tabl\\zaff.tabl.json' };
      const out = normalizePullData(input) as typeof input;
      expect(out.file).toBe('src/tabl/zaff.tabl.json');
    });

    it('is a no-op for empty data', () => {
      expect(normalizePullData({})).toEqual({});
    });
  });

  describe('toRelativeOutputPath', () => {
    const cwd = process.cwd();

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('turns an absolute host path under cwd into a POSIX relative path', () => {
      const abs = path.join(cwd, 'src', 'clas', 'zcl_demo', 'zcl_demo.clas.abap');
      expect(toRelativeOutputPath(abs)).toBe('src/clas/zcl_demo/zcl_demo.clas.abap');
    });

    it('uses `..` for paths outside cwd (same shape on every platform)', () => {
      const parent = path.join(cwd, '..', 'outside', 'foo.abap');
      expect(toRelativeOutputPath(parent)).toBe('../outside/foo.abap');
    });

    it('honours an explicit cwd that differs from process.cwd()', () => {
      const abs = path.join(cwd, 'proj', 'src', 'foo.abap');
      expect(toRelativeOutputPath(abs, path.join(cwd, 'proj'))).toBe('src/foo.abap');
    });

    it('rewrites Windows absolute separators to POSIX', () => {
      // Simulate a Windows absolute path that path.resolve would produce.
      const winAbs = 'C:\\Users\\dev\\proj\\src\\foo.abap';
      // relative vs the (POSIX) cwd is meaningless here; the contract is that
      // `\` never survives. We can't assert a specific relative value across
      // platforms, so just guarantee no backslash remains.
      expect(toRelativeOutputPath(winAbs)).not.toMatch(/\\/);
    });

    it('falls back to the POSIX absolute path when relative() is empty', () => {
      const abs = path.resolve(cwd);
      expect(toRelativeOutputPath(abs)).toBe(toOutputPath(abs));
    });
  });
});
