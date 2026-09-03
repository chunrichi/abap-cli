import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { bundledSourceDir } from '../../src/abap_cli/flows/edit/deploy.js';

// Regression: after the flows/ split, deploy resolved its bundled source dir
// one level too shallow (dist/abap/src) and silently deployed nothing. The
// default must point at <package-root>/abap/src that actually contains the
// bundled ICF handler sources.
describe('extension deploy bundled source dir', () => {
  it('resolves to an existing directory containing the ICF handler sources', () => {
    const dir = bundledSourceDir();
    expect(fs.existsSync(dir)).toBe(true);
    expect(fs.existsSync(path.join(dir, 'clas', 'zcl_abap_vibe_icf.clas.abap'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'clas', 'zcl_abap_vibe_icf_setup.clas.abap'))).toBe(true);
  });
});
