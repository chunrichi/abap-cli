#!/usr/bin/env node
/**
 * Build docs/commands.md from the canonical sources:
 *  - src/abap_cli/output/cli-output.schema.json        (envelope)
 *  - src/abap_cli/output/error-codes.ts / exit-codes.ts (error table)
 *  - src/abap_cli/flows/setup/command-schemas.ts         (13 commands)
 *  - src/abap_cli/commands/{create,run,select,search,tcode,where-used}.ts
 *    (6 per-command SCHEMA constants; create's schema lives in
 *    src/abap_cli/flows/edit/create-schema.ts)
 *
 * Usage:
 *   node scripts/build-commands-doc.ts > docs/commands.md
 *   tsx scripts/build-commands-doc.ts   # via `npx tsx`
 *   pnpm build-docs                     # add to package.json scripts
 *
 * Single source of truth: every option, argument, error code, example in the
 * generated docs comes from the command's TS schema — no copy/paste.
 */

import { writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// repoRoot is the directory ABOVE scripts/ — works both when this script runs
// from src (scripts/build-commands-doc.ts) and from dist (dist/scripts/scripts/build-commands-doc.js).
const here = path.dirname(fileURLToPath(import.meta.url));
function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(dir, 'package.json'))) return dir;
    dir = path.dirname(dir);
  }
  return path.resolve(start, '..');
}
const repoRoot = findRepoRoot(here);
const pkg = require(path.join(repoRoot, 'package.json')) as { version: string };
const schemaVersion = pkg.version;

// ---------- Imports from compiled output (we go via dist; if missing, build) ---
// To avoid running `tsc` from this script, we import source .ts files using
// tsx on demand. But to keep this script runnable as plain node + node-native
// ESM, we shell out to `node --import tsx` via a tiny entry file (see
// scripts/build-commands-doc.mts which re-exports this file's run()).
//
// To stay simple, this script uses dynamic `import()` of the source modules —
// which works under tsx (`pnpm dlx tsx scripts/build-commands-doc.ts`) and
// also under node --experimental-strip-types in Node 22+.

// This script reads from dist/ (npm run build). Run via:
//   npm run build && node scripts/build-commands-doc.js
// The companion `.mjs` wrapper (committed) imports the freshly-built
// `dist/...` modules. We keep this file as `.ts` so editors type-check it
// against the source; the wrapper transforms it via `npm run build`.

const distRoot = path.join(repoRoot, 'dist/src/abap_cli');
const flows = (n: string) => path.join(distRoot, 'flows', n).replace(/\\/g, '/');
const commands = (n: string) => path.join(distRoot, 'commands', n).replace(/\\/g, '/');
const output = (n: string) => path.join(distRoot, 'output', n).replace(/\\/g, '/');

const { commandSchemas, searchCommandSchema, whereUsedCommandSchema } = await import(flows('setup/command-schemas.js'));
const { createSchema } = await import(flows('edit/create-schema.js'));
const { EXIT_CODES } = await import(output('exit-codes.js'));
const fs = await import('node:fs');

// ---------- Inline schemas (run, select, tcode) -----------------
// These commands keep their SCHEMA as a module-level const because they need
// command-specific helpers. Re-import here so the doc generator has them all
// in one place.
type AnyModule = Record<string, unknown>;
async function loadConst(modPath: string, exportName: string): Promise<unknown> {
  const mod = (await import(modPath)) as AnyModule;
  return mod[exportName];
}
const RUN_SCHEMA = await loadConst(commands('run.js'), 'SCHEMA');
const SELECT_SCHEMA = await loadConst(commands('select.js'), 'SCHEMA');
const TCODE_SCHEMA = await loadConst(commands('tcode.js'), 'SCHEMA');
const DUMPS_SCHEMA = await loadConst(commands('dumps.js'), 'DUMPS_SCHEMA');

// ---------- Type narrowers --------------------------------------
interface SchemaExample {
  description?: string;
  command: string;
}
interface SchemaOption {
  name: string;
  type: string;
  valuePlaceholder?: string;
  description: string;
  required?: boolean;
  default?: string | number | boolean;
  deprecated?: boolean;
  allowedValues?: string[];
  pattern?: string;
  minimum?: number;
  maximum?: number;
  global?: boolean;
}
interface SchemaArgument {
  name: string;
  type?: string;
  required: boolean;
  description: string;
  allowedValues?: string[];
  pattern?: string;
  maxLength?: number;
}
interface SchemaError {
  code: string;
  category: string;
  exitCode: number;
}
interface CommandSchemaDoc {
  schemaVersion: 1;
  command: string;
  description: string;
  usage?: string;
  scope?: string;
  arguments: SchemaArgument[];
  options: SchemaOption[];
  exclusiveGroups?: string[][];
  globalOptions?: string[];
  examples?: (string | SchemaExample)[];
  errors?: SchemaError[];
  notes?: string[];
}

// Collect all 21 command schemas in a stable display order. The 14 commands
// in `commandSchemas` are the centralised ones; the remaining 7 keep their
// SCHEMA const inline (create, run, select, search, tcode, where-used, dumps).
const schemas: CommandSchemaDoc[] = [
  commandSchemas['init']!,
  commandSchemas['pull']!,
  commandSchemas['push']!,
  commandSchemas['check']!,
  commandSchemas['search'] ?? searchCommandSchema,
  commandSchemas['status']!,
  commandSchemas['inspect']!,
  commandSchemas['activate']!,
  commandSchemas['diff']!,
  commandSchemas['transport']!,
  commandSchemas['deploy']!,
  commandSchemas['profile']!,
  commandSchemas['doctor']!,
  commandSchemas['run'] ?? RUN_SCHEMA,
  commandSchemas['select'] ?? SELECT_SCHEMA,
  commandSchemas['where-used'] ?? whereUsedCommandSchema,
  commandSchemas['tcode'] ?? TCODE_SCHEMA,
  commandSchemas['extensions']!,
  commandSchemas['mime']!,
  commandSchemas['dumps'] ?? DUMPS_SCHEMA,
].filter(Boolean) as CommandSchemaDoc[];

// `create --schema` is parameterised on the type arg; surface the general
// shape here (type-specific dimensions are documented in the docs prose).
const createIndex = schemas.findIndex((s) => s && s.command === 'create');
if (createIndex >= 0) {
  schemas[createIndex] = createSchema() as unknown as CommandSchemaDoc;
} else {
  schemas.push(createSchema() as unknown as CommandSchemaDoc);
}

// Sanity: print the count so the doc generator fails fast when a schema
// goes missing (the TypeError above is otherwise obscure).
console.error(`[build-commands-doc] wrote ${schemas.length} command schemas (${schemas.map((s) => s.command).join(', ')})`);

// ---------- Render helpers --------------------------------------

function formatDefault(v: string | number | boolean | undefined): string {
  if (v === undefined) return '';
  if (typeof v === 'string') return `\`"${v}"\``;
  return `\`${v}\``;
}

function renderOptions(opts: SchemaOption[]): string[] {
  const lines: string[] = [];
  for (const o of opts) {
    const badge: string[] = [];
    if (o.required) badge.push('required');
    if (o.deprecated) badge.push('**deprecated**');
    if (o.global) badge.push('global');
    if (o.allowedValues?.length) badge.push(`enum: ${o.allowedValues.map((v) => `\`${v}\``).join(', ')}`);
    if (o.pattern) badge.push(`pattern: \`${o.pattern}\``);
    if (o.minimum !== undefined) badge.push(`min: \`${o.minimum}\``);
    if (o.maximum !== undefined) badge.push(`max: \`${o.maximum}\``);
    const placeholder = o.valuePlaceholder ? `=${o.valuePlaceholder}` : '';
    const def = formatDefault(o.default);
    const defSuffix = def ? ` (default ${def})` : '';
    const badgeSuffix = badge.length ? ` — ${badge.join(' · ')}` : '';
    lines.push(`| \`${o.name}${placeholder}\` | ${o.description}${defSuffix}${badgeSuffix} |`);
  }
  return lines;
}

function renderArguments(args: SchemaArgument[]): string[] {
  const lines: string[] = [];
  for (const a of args) {
    const badge: string[] = [];
    if (!a.required) badge.push('optional');
    if (a.allowedValues?.length) badge.push(`enum: ${a.allowedValues.map((v) => `\`${v}\``).join(', ')}`);
    if (a.pattern) badge.push(`pattern: \`${a.pattern}\``);
    if (a.maxLength !== undefined) badge.push(`max length: \`${a.maxLength}\``);
    const badgeSuffix = badge.length ? ` — ${badge.join(' · ')}` : '';
    lines.push(`| \`<${a.name}>\` | ${a.description}${badgeSuffix} |`);
  }
  return lines;
}

function renderExamples(examples: (string | SchemaExample)[] | undefined): string {
  if (!examples || examples.length === 0) return '';
  const blocks: string[] = ['```bash'];
  for (const ex of examples) {
    if (typeof ex === 'string') {
      blocks.push(ex);
    } else {
      if (ex.description) blocks.push(`# ${ex.description}`);
      blocks.push(ex.command);
    }
  }
  blocks.push('```');
  return blocks.join('\n');
}

function renderSchema(schema: CommandSchemaDoc, indent = ''): string {
  const out: string[] = [];
  out.push(`## \`abap ${schema.command}\`${schema.scope ? ` _(${schema.scope})_` : ''}`);
  out.push('');
  out.push(schema.description);
  out.push('');
  if (schema.notes && schema.notes.length > 0) {
    for (const note of schema.notes) {
      out.push(note);
      out.push('');
    }
  }
  out.push('```bash');
  out.push(schema.usage ?? `abap ${schema.command}`);
  out.push('```');
  out.push('');

  if (schema.arguments.length > 0) {
    out.push('### Arguments');
    out.push('');
    out.push('| Argument | Description |');
    out.push('|----------|-------------|');
    out.push(...renderArguments(schema.arguments));
    out.push('');
  }

  if (schema.options.length > 0) {
    out.push('### Options');
    out.push('');
    out.push('| Option | Description |');
    out.push('|--------|-------------|');
    out.push(...renderOptions(schema.options));
    out.push('');
  }

  if (schema.exclusiveGroups && schema.exclusiveGroups.length > 0) {
    out.push('### Exclusive groups');
    out.push('');
    for (const group of schema.exclusiveGroups) {
      out.push(`- ${group.map((g) => `\`${g}\``).join(', ')}`);
    }
    out.push('');
  }

  if (schema.globalOptions && schema.globalOptions.length > 0) {
    out.push('### Global options');
    out.push('');
    for (const g of schema.globalOptions) out.push(`- \`${g}\``);
    out.push('');
  }

  const exBlock = renderExamples(schema.examples);
  if (exBlock) {
    out.push('### Examples');
    out.push('');
    out.push(exBlock);
    out.push('');
  }

  if (schema.errors && schema.errors.length > 0) {
    out.push('### Error codes');
    out.push('');
    out.push('| Code | Category / exit | Description |');
    out.push('|------|-----------------|-------------|');
    for (const e of schema.errors) {
      out.push(`| \`${e.code}\` | ${e.category} / ${e.exitCode} | (see docs/commands.md#error-codes) |`);
    }
    out.push('');
  }

  return out.map((l) => (indent ? indent + l : l)).join('\n');
}

// ---------- Top-level document ----------------------------------

const envelopeSchemaPath = path.join(repoRoot, 'src/abap_cli/output/cli-output.schema.json');
const envelopeSchema = JSON.parse(fs.readFileSync(envelopeSchemaPath, 'utf-8')) as Record<string, unknown>;
const envelopeDesc = typeof envelopeSchema.description === 'string' ? envelopeSchema.description : '';
const errorDefs = (envelopeSchema.definitions ?? {}) as Record<string, { description?: string }>;
const errorDefDesc = errorDefs.error?.description ?? '';

const sections: string[] = [];
sections.push(`# Commands Reference (auto-generated — v${schemaVersion})`);
sections.push('');
sections.push('> **Source of truth**: this file is generated by `scripts/build-commands-doc.ts`. Do not edit by hand — change the command schema (`src/abap_cli/commands/*.ts`, `src/abap_cli/flows/setup/command-schemas.ts`) and run the generator.');
sections.push('');
sections.push(`Every command supports the global \`--json\` option for structured output (Agent-First design). Success output is written to **stdout**, errors to **stderr**; both follow the same shape when \`--json\` is used. The unified machine-readable envelope contract lives at \`src/abap_cli/output/cli-output.schema.json\` (JSON Schema draft-07) and is enforced by \`test/unit/envelope-schema.test.ts\` for every registered command.`);
sections.push('');

sections.push('## Global Options');
sections.push('');
sections.push('```');
sections.push('-V, --version        output the version number');
sections.push('--json               Emit the unified JSON envelope (compact; default for agents)');
sections.push('--pretty-json        Emit the unified JSON envelope with 2-space indentation');
sections.push('-h, --help           display help for command');
sections.push('```');
sections.push('');

sections.push('## JSON Output Contract');
sections.push('');
sections.push(envelopeDesc);
sections.push('');
sections.push(errorDefDesc);
sections.push('');
sections.push('Every `--json` envelope carries a `meta` block (`command`, `version`, `timestamp`, `durationMs`, `warnings`). `--pretty-json` emits the same shape with 2-space indentation (human/agent readability); `--json` is compact (token-efficient). The `--schema` mode (`abap <cmd> --schema`) returns a reduced `meta` containing only `command` / `version` / `durationMs` — no `timestamp` / `warnings` — for stable agent introspection.');
sections.push('');
sections.push('```jsonc');
sections.push('// Success (stdout)');
sections.push('{ "status": "success", "meta": { "command": "abap pull", "version": "' + schemaVersion + '", "timestamp": "...", "durationMs": 42, "warnings": [] }, "data": { ... } }');
sections.push('');
sections.push('// Failure (stderr — stdout is empty)');
sections.push('{ "status": "error", "meta": { ... }, "error": { "code": "...", "category": "...", "message": "...", "nextSteps": [...], ... } }');
sections.push('```');
sections.push('');
sections.push('Warnings never enter the error envelope: non-fatal warnings (e.g. a deprecated option, or a push whose lock could not be released) appear as structured `meta.warnings` entries (or `Warning: …` stderr lines in human mode) and never change the exit code.');
sections.push('');
sections.push(`Exit codes (stable contract, only additive across versions): \`0\` success, \`1\` unknown/unmapped failure (generic fallback), \`2\` usage, \`3\` config, \`4\` TLS, \`5\` auth, \`6\` SAP error, \`7\` validation, \`8\` not-found, \`9\` locked; \`>=10\` reserved. \`error.category\` in the JSON always maps 1:1 to the exit code. See the common-errors help block on every command for the full table.`);
sections.push('');

// ---------- Per-command sections -------------------------------
sections.push('## Commands');
sections.push('');
sections.push(`This generator emits **${schemas.length}** commands in a stable display order. New commands appear automatically once a schema is registered with \`commandSchemas\` (or a per-command \`SCHEMA\` constant) — see the generator source for the canonical list.`);
sections.push('');
for (const schema of schemas) {
  if (!schema || !schema.command) {
    console.error(`[build-commands-doc] skipping malformed schema:`, JSON.stringify(schema));
    continue;
  }
  sections.push(renderSchema(schema));
  sections.push('');
}

// ---------- Global Error Codes ----------------------------------
sections.push('## Error Codes');
sections.push('');
sections.push('Every error\'s `error.category` maps 1:1 to its exit code. `UNKNOWN` is the generic fallback for unmapped exceptions (exit `1`). The full authoritative list lives in `src/abap_cli/output/error-codes.ts`; the table below is generated from `EXIT_CODES` and the `CATEGORY_OF_CODE` mapper.');
sections.push('');
sections.push('| Category | Exit | Meaning |');
sections.push('|----------|------|---------|');
const categoryMeaning: Record<string, string> = {
  UNKNOWN: 'Unmapped exception fallback (exit 1)',
  USAGE: 'Commander parse error or a USAGE error thrown by the command',
  CONFIG_ERROR: 'Configuration missing/invalid (run `abap init` / `abap profile add` / `abap profile set`)',
  TLS_ERROR: 'TLS handshake / certificate failure',
  AUTH_ERROR: '401/403 from SAP (bad credentials)',
  SAP_ERROR: 'ADT request failed (includes HTTP status)',
  VALIDATION_ERROR: 'Semantic rejection (e.g. invalid input combination)',
  NOT_FOUND: 'Object, profile, or transport not found',
  LOCKED: 'Target object is locked by another user',
};
for (const [category, code] of Object.entries(EXIT_CODES) as [string, number][]) {
  const meaning = categoryMeaning[category] ?? '—';
  sections.push(`| \`${category}\` | \`${code}\` | ${meaning} |`);
}
sections.push('');

// ---------- Cross-reference error codes from every schema ------
const codeIndex = new Map<string, { category: string; exitCode: number; commands: Set<string> }>();
for (const schema of schemas) {
  for (const e of schema.errors ?? []) {
    const existing = codeIndex.get(e.code);
    if (existing) {
      existing.commands.add(schema.command);
    } else {
      codeIndex.set(e.code, { category: e.category, exitCode: e.exitCode, commands: new Set([schema.command]) });
    }
  }
}
sections.push('### Per-command error code index');
sections.push('');
sections.push('Generated from the `errors` array of every command schema (single source of truth). Codes not listed here are reserved for future extensions.');
sections.push('');
sections.push('| Code | Category / exit | Used by |');
sections.push('|------|-----------------|---------|');
const sortedCodes = [...codeIndex.keys()].sort();
for (const code of sortedCodes) {
  const { category, exitCode, commands } = codeIndex.get(code)!;
  sections.push(`| \`${code}\` | ${category} / ${exitCode} | ${[...commands].map((c) => `\`abap ${c}\``).join(', ')} |`);
}
sections.push('');

sections.push('## See also');
sections.push('');
sections.push('- Unified envelope contract: `src/abap_cli/output/cli-output.schema.json` (envelope shape) + `src/abap_cli/output/cli-output-codes.schema.json` (exit-code and error-code maps)');
sections.push('- [`cli-output.schema.json`](../src/abap_cli/output/cli-output.schema.json) — machine-readable envelope schema (JSON Schema draft-07)');
sections.push('- [`error-codes.ts`](../src/abap_cli/output/error-codes.ts) — error-code → category → exit-code mapper');
sections.push('- [`json.ts`](../src/abap_cli/output/json.ts) — `CliError.references` field; rendered as `See: <path>` on human error output');
sections.push('');

const out = sections.join('\n');
const outPath = path.join(repoRoot, 'docs/commands.md');
writeFileSync(outPath, out, 'utf-8');
console.error(`wrote ${outPath} (${out.length} bytes)`);