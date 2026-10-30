import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { bundledSourceDir } from '../../src/abap_cli/flows/edit/deploy.js';

// Regression: after the flows/ split, deploy resolved its bundled source dir
// one level too shallow (dist/abap/src) and silently deployed nothing. The
// default must point at <package-root>/abap/src that actually contains the
// bundled ICF handler sources — flat, per the abap-file-format layout.
describe('deploy bundled source dir', () => {
  it('resolves to an existing directory containing the ICF handler sources', () => {
    const dir = bundledSourceDir();
    expect(fs.existsSync(dir)).toBe(true);
    // Marker used by bundledSourceDir() itself.
    expect(fs.existsSync(path.join(dir, 'zcl_abap_vibe_icf.clas.abap'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'zcl_abap_vibe_icf_setup.clas.abap'))).toBe(true);
    // Multi-part classes keep their include files in the same flat directory.
    expect(fs.existsSync(path.join(dir, 'zcl_abap_vibe_icf.clas.definitions.abap'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'zcl_abap_vibe_icf.clas.implementations.abap'))).toBe(true);
  });

  it('lists the bundled sources flat — no per-type subdirectory remains', () => {
    const dir = bundledSourceDir();
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      expect(entry.isFile(), `unexpected subdirectory ${entry.name}`).toBe(true);
    }
    expect(fs.existsSync(path.join(dir, 'clas'))).toBe(false);

    const classSources = entries
      .filter((e) => e.isFile() && e.name.endsWith('.clas.abap'))
      .map((e) => e.name)
      .sort();
    // Every bundled handler is an AFF flat `<name>.clas.abap` artifact.
    expect(classSources.length).toBeGreaterThanOrEqual(8);
    for (const name of classSources) {
      expect(path.basename(name)).toBe(name);
    }
  });

  it('pairs each bundled class source with its AFF metadata json', () => {
    const dir = bundledSourceDir();
    for (const entry of fs.readdirSync(dir)) {
      const m = /^(.+)\.clas\.abap$/.exec(entry);
      if (!m) continue;
      expect(fs.existsSync(path.join(dir, `${m[1]}.clas.json`)), `missing ${m[1]}.clas.json`).toBe(
        true,
      );
    }
  });
});
