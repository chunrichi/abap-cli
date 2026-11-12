/**
 * Release portability of the JOBD ICF route.
 *
 * `abap deploy` merges every helper class into the single global handler
 * `ZCL_ABAP_VIBE_ICF`. A static reference to a job-repository DDIC object
 * (JR_*, STJR_JOBD_*) therefore makes the whole ICF service fail activation
 * on releases that never shipped STJR — even for callers that never touch
 * /jobd. The JOBD sources must reach those objects only through dynamic
 * names; the route itself is gated by jobd_available.
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

/** Drop ABAP comments and character / string-template literals. */
function abapCodeOnly(source: string): string {
  let out = '';
  let inChar = false;
  let inTemplate = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]!;
    if (inChar) {
      if (ch === "'") {
        if (source[i + 1] === "'") i += 1;
        else inChar = false;
      }
      continue;
    }
    if (inTemplate) {
      if (ch === '|') inTemplate = false;
      continue;
    }
    if (ch === "'") {
      inChar = true;
      out += ' ';
      continue;
    }
    if (ch === '|') {
      inTemplate = true;
      out += ' ';
      continue;
    }
    if (ch === '"') {
      while (i < source.length && source[i] !== '\n') i += 1;
      out += '\n';
      continue;
    }
    out += ch;
  }
  return out;
}

async function loadDevClasses(): Promise<Map<string, DevClassSource>> {
  const classes = new Map<string, DevClassSource>();
  for (const entry of fs.readdirSync(SOURCE_DIR)) {
    const match = /^(.+)\.clas\.abap$/.exec(entry);
    if (!match) continue;
    const base = match[1]!;
    const preludePath = path.join(SOURCE_DIR, `${base}.clas.definitions.abap`);
    classes.set(base.toUpperCase(), {
      main: fs.readFileSync(path.join(SOURCE_DIR, entry), 'utf8'),
      definitionsPrelude: fs.existsSync(preludePath) ? fs.readFileSync(preludePath, 'utf8') : undefined,
    });
  }
  return classes;
}

describe('JOBD release portability', () => {
  it('keeps the merged handler free of static job-repository DDIC references', async () => {
    const manifest = await loadDeployManifest(SOURCE_DIR);
    const merged = mergeReleaseSources({ manifest, classes: await loadDevClasses() });

    for (const source of [merged.handler.definitions, merged.handler.implementations]) {
      const code = abapCodeOnly(source);
      expect(code).not.toMatch(/\bjr_[a-z0-9_]+\b/i);
      expect(code).not.toMatch(/\bstjr_jobd_(?:root|trep)\b/i);
    }

    // The dynamic bridge must stay: without it the handler cannot restore the
    // real package on releases that do ship the job repository.
    expect(merged.handler.implementations).toContain("'STJR_JOBD_ROOT'");
    expect(merged.handler.implementations).toContain("'STJR_JOBD_TREP'");
  });
});
