import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import * as path from 'node:path';
import { bundledSourceDir } from '../../src/abap_cli/flows/edit/deploy.js';
import {
  loadDeployManifest,
  mergeReleaseSources,
  orderDevObjects,
  type DevClassSource,
} from '../../src/abap_cli/flows/edit/deploy-merge.js';

/**
 * Smoke test against the real bundled sources: `abap/src` holds the dev form
 * (one global class per helper) and `abap/deploy.json` is the merge manifest.
 * The manifest lands with the ICF source migration; when it is absent (e.g. an
 * older checkout) the suite skips instead of failing.
 */

const sourceDir = bundledSourceDir();
const manifestPath = path.resolve(sourceDir, '..', 'deploy.json');
const hasManifest = existsSync(manifestPath);

function readBundledClasses(): Map<string, DevClassSource> {
  const classes = new Map<string, DevClassSource>();
  for (const fileName of readdirSync(sourceDir)) {
    const match = /^(.+)\.clas\.abap$/i.exec(fileName);
    if (!match) continue;
    const globalName = match[1]!.toUpperCase();
    const main = readFileSync(path.join(sourceDir, fileName), 'utf8');
    const preludePath = path.join(sourceDir, `${match[1]}.clas.definitions.abap`);
    const definitionsPrelude = existsSync(preludePath) ? readFileSync(preludePath, 'utf8') : undefined;
    classes.set(globalName, definitionsPrelude === undefined ? { main } : { main, definitionsPrelude });
  }
  return classes;
}

describe.skipIf(!hasManifest)('bundled ICF sources — release merge smoke', () => {
  it('merges the real abap/src classes into the handler per abap/deploy.json', async () => {
    const manifest = await loadDeployManifest(sourceDir);
    const classes = readBundledClasses();

    // Every class listed in the manifest must ship as a dev-form AFF main.
    expect(classes.has(manifest.handler)).toBe(true);
    for (const entry of manifest.merged) {
      expect(classes.has(entry.global), `missing dev source for ${entry.global}`).toBe(true);
    }

    const result = mergeReleaseSources({ manifest, classes });

    // One local class per merged global, no duplicates, no extras.
    expect(result.orderedLocals.length).toBe(manifest.merged.length);
    expect(new Set(result.orderedLocals)).toEqual(new Set(manifest.merged.map((entry) => entry.local)));

    // The TYPE-POOLS prelude of the MIME helper is the first section of the
    // generated definitions include (it may be preceded by its own comment
    // line); every local class definition follows it.
    expect(result.handler.definitions).toMatch(/^(?:\*[^\n]*\n)*TYPE-POOLS: skwf, wbmr\./);
    expect(result.handler.definitions.indexOf('TYPE-POOLS: skwf, wbmr.')).toBeLessThan(
      result.handler.definitions.indexOf('CLASS lcl_'),
    );
    for (const local of result.orderedLocals) {
      expect(result.handler.definitions).toContain(`CLASS ${local} DEFINITION.`);
    }
    // Local classes never keep the global class header attributes.
    expect(result.handler.definitions).not.toMatch(/CLASS\s+lcl_\w+\s+DEFINITION\s+(PUBLIC|FINAL|CREATE)/i);

    // The handler main keeps its own two class blocks and calls only locals.
    expect(result.handler.main).toContain(`CLASS ${manifest.handler.toLowerCase()} DEFINITION`);
    expect(result.handler.main).toContain(`CLASS ${manifest.handler.toLowerCase()} IMPLEMENTATION`);
    for (const entry of manifest.merged) {
      const leftover = new RegExp(`\\b${entry.global}\\b`, 'i');
      expect(result.handler.main).not.toMatch(leftover);
      expect(result.handler.definitions).not.toMatch(leftover);
      expect(result.handler.implementations).not.toMatch(leftover);
    }
    // No helper global class names survive anywhere in the generated output.
    const generated = [result.handler.main, result.handler.definitions, result.handler.implementations].join('\n');
    expect(generated).not.toMatch(/\bZCL_ABAP_VIBE_ICF_[A-Z0-9_]+\b/i);
    expect(generated).not.toMatch(/\bZCL_ABAP_VIBE_[A-Z0-9_]*_FORMAT\b/i);

    // Every generated part ends with exactly one newline.
    for (const part of [result.handler.main, result.handler.definitions, result.handler.implementations]) {
      expect(part.endsWith('\n')).toBe(true);
      expect(part.endsWith('\n\n')).toBe(false);
    }
  });

  it('is deterministic across repeated calls', async () => {
    const manifest = await loadDeployManifest(sourceDir);
    const first = mergeReleaseSources({ manifest, classes: readBundledClasses() });
    const second = mergeReleaseSources({ manifest, classes: readBundledClasses() });
    expect(second).toEqual(first);
  });

  it('lists every deployable object in dev activation order', async () => {
    const manifest = await loadDeployManifest(sourceDir);
    const order = orderDevObjects(manifest, readBundledClasses());

    // merged classes (topological) -> handler -> standalone classes
    expect(order.length).toBe(manifest.merged.length + 1 + manifest.standalone.length);
    expect(new Set(order.slice(0, manifest.merged.length))).toEqual(
      new Set(manifest.merged.map((entry) => entry.global)),
    );
    expect(order[manifest.merged.length]).toBe(manifest.handler);
    expect(order.slice(manifest.merged.length + 1)).toEqual(manifest.standalone);

    // Helpers referenced from another helper's implementation must be activated
    // first: the DDIC helper calls the ENQU / NROB format helpers.
    const ddic = order.indexOf('ZCL_ABAP_VIBE_ICF_DDIC');
    if (ddic !== -1) {
      const enqu = order.indexOf('ZCL_ABAP_VIBE_ENQU_FORMAT');
      const nrob = order.indexOf('ZCL_ABAP_VIBE_NROB_FORMAT');
      if (enqu !== -1) expect(enqu).toBeLessThan(ddic);
      if (nrob !== -1) expect(nrob).toBeLessThan(ddic);
    }

    // The shared types helper is a dependency of other helpers and must lead.
    const types = order.indexOf('ZCL_ABAP_VIBE_ICF_TYPES');
    if (types !== -1) expect(types).toBe(0);
  });
});
