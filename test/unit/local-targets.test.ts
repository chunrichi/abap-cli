import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveLocalTargets } from '../../src/abap_cli/sync/local-targets.js';
import { loadIgnorePatterns } from '../../src/abap_cli/sync/ignore.js';

describe('local-targets + ignore (FR-017, FR-025)', () => {
  it('loadIgnorePatterns always includes the defaults', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'abapignore-'));
    try {
      const p = loadIgnorePatterns(tmp);
      expect(p).toContain('node_modules');
      expect(p).toContain('.git');
      expect(p).toContain('dist');
      expect(p).toContain('build');
      expect(p).toContain('coverage');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('loadIgnorePatterns appends lines from .abapignore (skipping comments)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'abapignore-'));
    try {
      fs.writeFileSync(path.join(tmp, '.abapignore'), '# comment\nprivate/\n!keep.abap\n');
      const p = loadIgnorePatterns(tmp);
      expect(p).toContain('private/');
      expect(p).toContain('!keep.abap');
      expect(p.some((l) => l.startsWith('#'))).toBe(false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('resolveLocalTargets({ all: true }) skips node_modules/dist but keeps src/', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'abapignore-'));
    try {
      fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
      fs.mkdirSync(path.join(tmp, 'node_modules'), { recursive: true });
      fs.mkdirSync(path.join(tmp, 'dist'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'src', 'real.abap'), 'REPORT zreal.');
      fs.writeFileSync(path.join(tmp, 'node_modules', 'ignored.abap'), 'REPORT zbad.');
      fs.writeFileSync(path.join(tmp, 'dist', 'alsoignored.abap'), 'REPORT zbad.');
      const res = await resolveLocalTargets({ all: true }, tmp);
      const rels = res.files.map((f) => path.relative(tmp, f));
      expect(rels).toContain(path.join('src', 'real.abap'));
      expect(rels).not.toContain(path.join('node_modules', 'ignored.abap'));
      expect(rels).not.toContain(path.join('dist', 'alsoignored.abap'));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('resolveLocalTargets({ files: [...] }) does NOT apply ignore (explicit files win)', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'abapignore-'));
    try {
      fs.mkdirSync(path.join(tmp, 'node_modules'), { recursive: true });
      const explicit = path.join(tmp, 'node_modules', 'kept.abap');
      fs.writeFileSync(explicit, 'REPORT zkept.');
      const res = await resolveLocalTargets({ files: [explicit] }, tmp);
      expect(res.files).toContain(explicit);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});