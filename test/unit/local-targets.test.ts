import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveLocalTargets } from '../../src/abap_cli/core/local-targets.js';
import { loadIgnorePatterns } from '../../src/abap_cli/core/ignore.js';

describe('local-targets + ignore ', () => {
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
      fs.writeFileSync(path.join(tmp, 'src', 'zreal.prog.abap'), 'REPORT zreal.');
      fs.writeFileSync(path.join(tmp, 'node_modules', 'zig.clas.abap'), 'REPORT zbad.');
      fs.writeFileSync(path.join(tmp, 'dist', 'zig2.clas.abap'), 'REPORT zbad.');
      const res = await resolveLocalTargets({ all: true }, tmp);
      const rels = res.files.map((f) => path.relative(tmp, f));
      expect(rels).toContain(path.join('src', 'zreal.prog.abap'));
      expect(rels).not.toContain(path.join('node_modules', 'zig.clas.abap'));
      expect(rels).not.toContain(path.join('dist', 'zig2.clas.abap'));
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

  it('resolveLocalTargets({ files: [...] }) keeps an unparseable explicit file (no skip for explicit paths)', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'abapignore-'));
    try {
      const stray = path.join(tmp, 'discovery.xml');
      fs.writeFileSync(stray, '<xml/>');
      const res = await resolveLocalTargets({ files: [stray] }, tmp);
      expect(res.files).toContain(stray);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('resolveLocalTargets({ all: true }) honors .abap.json::sourceDir found two levels up', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sourcedir-'));
    try {
      fs.mkdirSync(path.join(tmp, 'abap-src'), { recursive: true });
      fs.mkdirSync(path.join(tmp, 'misc'), { recursive: true });
      fs.mkdirSync(path.join(tmp, 'deep', 'nested'), { recursive: true });
      fs.writeFileSync(path.join(tmp, '.abap.json'), JSON.stringify({ sourceDir: 'abap-src' }));
      fs.writeFileSync(path.join(tmp, 'abap-src', 'zcl_real.clas.abap'), 'CLASS zcl_real DEFINITION PUBLIC.\nENDCLASS.\n');
      // Stray junk outside the configured sourceDir must not be scanned.
      fs.writeFileSync(path.join(tmp, 'misc', 'discovery.xml'), '<xml/>');
      fs.writeFileSync(path.join(tmp, 'misc', 'source.abap'), 'REPORT zjunk.');
      const nestedCwd = path.join(tmp, 'deep', 'nested');
      const res = await resolveLocalTargets({ all: true }, nestedCwd);
      const rels = res.files.map((f) => path.relative(tmp, f));
      expect(rels).toEqual([path.join('abap-src', 'zcl_real.clas.abap')]);
      expect(res.sourceDir).toBe(path.join(tmp, 'abap-src'));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('resolveLocalTargets({ all: true }) treats a missing .abap.json::sourceDir as empty', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'missingsrc-'));
    try {
      fs.writeFileSync(path.join(tmp, '.abap.json'), JSON.stringify({ sourceDir: 'not-pulled-yet' }));
      const res = await resolveLocalTargets({ all: true }, tmp);
      expect(res.files).toEqual([]);
      expect(res.sourceDir).toBe(path.join(tmp, 'not-pulled-yet'));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('resolveLocalTargets({ all: true }) skips unparseable stray files under the scan root', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'strayscan-'));
    try {
      fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'src', 'zcl_real.clas.abap'), 'CLASS zcl_real DEFINITION PUBLIC.\nENDCLASS.\n');
      // Names resolveFile rejects (no <name>.<type> layout) must be skipped, not fatal.
      fs.writeFileSync(path.join(tmp, 'discovery.xml'), '<xml/>');
      fs.writeFileSync(path.join(tmp, 'source.abap'), 'REPORT zjunk.');
      const res = await resolveLocalTargets({ all: true }, tmp);
      const rels = res.files.map((f) => path.relative(tmp, f));
      expect(rels).toContain(path.join('src', 'zcl_real.clas.abap'));
      expect(rels).not.toContain('discovery.xml');
      expect(rels).not.toContain('source.abap');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});