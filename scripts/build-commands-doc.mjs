#!/usr/bin/env node
/**
 * Wrapper for `scripts/build-commands-doc.ts`. Compiles the .ts via `tsc`
 * into `dist/scripts/`, then runs the resulting JS file.
 *
 * Run via:
 *   node scripts/build-commands-doc.mjs           # builds dist + runs
 *   npm run build-docs                             # add to package.json scripts
 *
 * The .ts source is the canonical file (linted / type-checked); this wrapper
 * just bridges between TS and plain `node` so contributors don't need tsx.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const distMarker = path.join(repoRoot, 'dist/src/abap_cli/output/cli-output.schema.json');

if (!existsSync(distMarker)) {
  console.error('dist/ not found — running `npm run build` first…');
  const build = spawnSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' });
  if (build.status !== 0) {
    console.error('build failed');
    process.exit(build.status ?? 1);
  }
}

const tsc = spawnSync(
  'npx',
  [
    'tsc',
    '--target', 'es2022',
    '--module', 'esnext',
    '--moduleResolution', 'bundler',
    '--outDir', path.join(repoRoot, 'dist/scripts'),
    '--rootDir', repoRoot,
    '--skipLibCheck',
    'scripts/build-commands-doc.ts',
  ],
  { cwd: repoRoot, stdio: 'inherit' },
);
if (tsc.status !== 0) {
  console.error('tsc compile failed');
  process.exit(tsc.status ?? 1);
}

await import(path.join(repoRoot, 'dist/scripts/scripts/build-commands-doc.js'));