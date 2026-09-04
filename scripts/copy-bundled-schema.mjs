#!/usr/bin/env node
// Mirror src/abap_cli/schema/ into dist/src/abap_cli/schema/ so the
// bundled AFF schemas are available alongside the compiled JS.
// Required because `tsc` only emits .ts → .js; JSON siblings are not
// copied automatically.
//
// Idempotent: removes the existing dist schema dir before re-copying,
// so deletions in src propagate cleanly.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const src = path.join(repoRoot, 'src', 'abap_cli', 'schema');
const dst = path.join(repoRoot, 'dist', 'src', 'abap_cli', 'schema');

if (!fs.existsSync(src)) {
  console.error(`copy-bundled-schema: source not found at ${src}`);
  process.exit(1);
}

fs.rmSync(dst, { recursive: true, force: true });
fs.mkdirSync(dst, { recursive: true });

let count = 0;
for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
  const from = path.join(src, entry.name);
  const to = path.join(dst, entry.name);
  fs.cpSync(from, to, { recursive: true });
  count += 1;
}
console.log(`copy-bundled-schema: copied ${count} entries to ${dst}`);

// tsc emits index.js without the exec bit, which breaks the `abap` bin symlink.
const binEntry = path.join(repoRoot, 'dist', 'src', 'abap_cli', 'index.js');
if (fs.existsSync(binEntry)) {
  fs.chmodSync(binEntry, 0o755);
}
