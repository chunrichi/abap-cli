#!/usr/bin/env node
/**
 * Repo documentation contract checks (runs as part of `npm run docs:check`,
 * after `scripts/gen-docs.mjs --check`).
 *
 * Three independent guards:
 *   1. wiki command pages follow the okf page contract
 *      (frontmatter fields, `# abap <command>` H1, required sections)
 *   2. every relative markdown link resolves (dead-link guard)
 *   3. command metadata agrees: every `--help` option is declared in the
 *      command's `--schema --json` contract (schema drift guard)
 *
 * Usage: node scripts/check-docs.mjs [--verbose]
 * Exits 1 on errors; `--verbose` also prints section warnings.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const distEntry = path.join(repoRoot, 'dist', 'index.js');
const verbose = process.argv.includes('--verbose');

const errors = [];
const warnings = [];

// ---------------------------------------------------------------------------
// 1. wiki command pages — okf contract
// ---------------------------------------------------------------------------

/** Pages under wiki/commands/ that are not command pages. */
const NON_COMMAND_PAGES = new Set(['index.md', 'path-output.md']);

const REQUIRED_FIELDS = ['type', 'title', 'description', 'tags', 'created at', 'changed at'];
const TIMESTAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
/** Sections the okf contract asks for; missing ones are warnings (content debt), not errors. */
const OPTIONAL_SECTIONS = [
  ['Expected Output section', /^#{2,3} Expected Output/m],
  ['# More', /^# More\s*$/m],
  ['# references', /^# references\s*$/m],
];
/** Sections that must exist on every command page. */
const REQUIRED_SECTIONS = [
  ['## Usage', /^## Usage\s*$/m],
  ['Options section', /^#{2,3} Options/m],
  ['Examples section', /^#{2,3} Examples/m],
];

function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) return null;
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) fields[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return fields;
}

function checkWikiCommandPages() {
  const dir = path.join(repoRoot, 'wiki', 'commands');
  const pages = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
  for (const page of pages) {
    if (NON_COMMAND_PAGES.has(page)) continue;
    const rel = path.join('wiki', 'commands', page);
    const text = fs.readFileSync(path.join(dir, page), 'utf8');
    const pageBase = page.replace(/\.md$/, '');
    // Only validate:aff is stored with a `-` for filesystem safety.
    const command = pageBase === 'validate-aff' ? 'validate:aff' : pageBase;
    const label = `wiki/commands/${page}`;

    const fields = parseFrontmatter(text);
    if (!fields) {
      errors.push(`${label}: missing YAML frontmatter`);
      continue;
    }
    for (const field of REQUIRED_FIELDS) {
      if (!fields[field]) errors.push(`${label}: frontmatter is missing "${field}"`);
    }
    if (fields.type && fields.type !== 'command') errors.push(`${label}: frontmatter type must be "command", got "${fields.type}"`);
    if (fields['created at'] && !TIMESTAMP.test(fields['created at'])) errors.push(`${label}: "created at" must be YYYY-MM-DD HH:MM:SS`);
    if (fields['changed at'] && !TIMESTAMP.test(fields['changed at'])) errors.push(`${label}: "changed at" must be YYYY-MM-DD HH:MM:SS`);
    if (fields.tags) {
      for (const tag of ['abap-cli', 'command', command]) {
        if (!fields.tags.includes(tag)) errors.push(`${label}: tags is missing "${tag}"`);
      }
    }

    const h1 = text.match(/^# (.+)$/m)?.[1]?.trim() ?? '';
    const h1Name = h1.replace(/^`+|`+$/g, '').trim();
    if (h1Name !== `abap ${command}`) errors.push(`${label}: H1 must be "# abap ${command}", got "# ${h1}"`);

    for (const [name, re] of REQUIRED_SECTIONS) {
      if (!re.test(text)) errors.push(`${label}: missing "${name}" section`);
    }
    for (const [name, re] of OPTIONAL_SECTIONS) {
      if (!re.test(text)) warnings.push(`${label}: missing "${name}" section`);
    }
  }
}

// ---------------------------------------------------------------------------
// 2. relative markdown links resolve
// ---------------------------------------------------------------------------

function trackedMarkdownFiles() {
  const out = execFileSync('git', ['ls-files', '*.md'], { cwd: repoRoot, encoding: 'utf8' });
  return out.trim().split('\n').filter(Boolean);
}

function checkLinks() {
  for (const file of trackedMarkdownFiles()) {
    const abs = path.join(repoRoot, file);
    let text = fs.readFileSync(abs, 'utf8');
    // Ignore links inside fenced code blocks and inline code spans.
    text = text.replace(/^```[\s\S]*?^```/gm, '').replace(/`[^`\n]*`/g, '');
    const re = /\]\(([^)\s]+)\)/g;
    let match;
    while ((match = re.exec(text)) !== null) {
      const raw = match[1];
      if (/^(https?:|mailto:|#)/.test(raw)) continue;
      const target = decodeURIComponent(raw.split('#')[0]);
      if (!target) continue;
      if (!fs.existsSync(path.resolve(path.dirname(abs), target))) {
        errors.push(`${file}: dead link -> ${raw}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 3. command metadata drift (`--help` options ⊆ `--schema` contract)
// ---------------------------------------------------------------------------

/** Flags every command may expose without declaring them in `options[]`. */
const IGNORED_HELP_FLAGS = new Set(['--help', '--version', '--json', '--pretty-json', '--schema']);

function schemaFor(command) {
  const stdout = execFileSync(process.execPath, [distEntry, command, '--schema', '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const envelope = JSON.parse(stdout);
  return envelope.data ?? envelope;
}

function helpOptionsFor(command) {
  const help = execFileSync(process.execPath, [distEntry, command, '--help'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const block = help.split(/\r?\nOptions:\r?\n/)[1]?.split(/\r?\nCommands:\r?\n/)[0] ?? '';
  const flags = new Set();
  for (const line of block.split(/\r?\n/)) {
    const m = line.match(/^\s+(?:-[A-Za-z],\s+)?(--[A-Za-z][A-Za-z0-9-]*)/);
    if (m) flags.add(m[1]);
  }
  return flags;
}

async function runCommandMetadataCheck() {
  const { COMMAND_SPECS } = await import(pathToFileURL(path.join(repoRoot, 'dist', 'registry', 'commands.js')).href);
  for (const spec of COMMAND_SPECS) {
    const command = spec.name;
    const schema = schemaFor(command);
    const schemaFlags = new Set([
      ...(schema.options ?? []).map((o) => String(o.name).trim().split(/\s+/)[0]),
      ...(schema.globalOptions ?? []),
    ]);
    for (const flag of helpOptionsFor(command)) {
      if (IGNORED_HELP_FLAGS.has(flag) || schemaFlags.has(flag)) continue;
      errors.push(`command "${command}": --help exposes ${flag} but --schema does not declare it`);
    }
  }
}

// ---------------------------------------------------------------------------

checkWikiCommandPages();
checkLinks();
await runCommandMetadataCheck();

if (warnings.length > 0 && verbose) {
  console.log(`\nℹ ${warnings.length} section warning(s):`);
  for (const warning of new Set(warnings)) console.log(`  - ${warning}`);
}

if (errors.length > 0) {
  console.error(`\n✗ docs check failed with ${errors.length} error(s):`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(`✓ docs contract: ${trackedMarkdownFiles().length} markdown files, command schemas and wiki pages OK`);
