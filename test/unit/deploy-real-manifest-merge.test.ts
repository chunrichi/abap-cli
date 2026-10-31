/**
 * The REAL bundled source tree must merge cleanly into the release handler.
 *
 * `deploy-release-merge.test.ts` pins the merge algorithm with synthetic
 * fixtures; this test runs the same merge against `abap/src` + `abap/deploy.json`
 * so a new helper class that is referenced from the handler but missing from the
 * manifest (or a leftover global name in a source file) fails locally instead of
 * on a real `abap deploy`.
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { bundledSourceDir } from '../../src/abap_cli/flows/edit/deploy.js';
import {
  loadDeployManifest,
  mergeReleaseSources,
  type DevClassSource,
} from '../../src/abap_cli/flows/edit/deploy-merge.js';

const SOURCE_DIR = bundledSourceDir();

/** Build the dev-form class map the way `abap deploy` does for flat classes. */
async function loadDevClasses(): Promise<Map<string, DevClassSource>> {
  const classes = new Map<string, DevClassSource>();
  for (const entry of fs.readdirSync(SOURCE_DIR)) {
    const match = /^(.+)\.clas\.abap$/.exec(entry);
    if (!match) continue;
    const base = match[1]!;
    const main = fs.readFileSync(path.join(SOURCE_DIR, entry), 'utf8');
    const preludePath = path.join(SOURCE_DIR, `${base}.clas.definitions.abap`);
    const definitionsPrelude = fs.existsSync(preludePath)
      ? fs.readFileSync(preludePath, 'utf8')
      : undefined;
    classes.set(base.toUpperCase(), { main, definitionsPrelude });
  }
  return classes;
}

describe('release merge of the real bundled sources', () => {
  it('merges abap/src + abap/deploy.json without errors', async () => {
    const manifest = await loadDeployManifest(SOURCE_DIR);
    const classes = await loadDevClasses();
    const merged = mergeReleaseSources({ manifest, classes });

    expect(merged.handler.main).toContain('CLASS zcl_abap_vibe_icf IMPLEMENTATION.');
    // Every helper is a local class in the generated includes.
    expect(merged.orderedLocals).toEqual(expect.arrayContaining(['lcl_types', 'lcl_response', 'lcl_xslt']));
    expect(merged.handler.definitions).toContain('CLASS lcl_xslt DEFINITION');
    expect(merged.handler.implementations).toContain('CLASS lcl_xslt IMPLEMENTATION.');
    // No dev-form global reference may survive the rename.
    expect(merged.handler.main).not.toMatch(/zcl_abap_vibe_icf_/i);
    expect(merged.handler.definitions).not.toMatch(/zcl_abap_vibe_icf_/i);
    expect(merged.handler.implementations).not.toMatch(/zcl_abap_vibe_icf_/i);
  });

  it('routes /xslt/* through the merged local XSLT helper', async () => {
    const manifest = await loadDeployManifest(SOURCE_DIR);
    const classes = await loadDevClasses();
    const merged = mergeReleaseSources({ manifest, classes });
    expect(merged.handler.main).toMatch(/IF lv_path CP '\/xslt\/\*'\./);
    expect(merged.handler.main).toMatch(/lcl_xslt=>dispatch_xslt\(/);
    expect(merged.handler.definitions).toContain('CLASS lcl_xslt DEFINITION');
  });
});
