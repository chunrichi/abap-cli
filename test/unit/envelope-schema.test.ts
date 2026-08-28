/**
 * P1 — unified machine-readable contract (JSON Schema + per-command audit).
 *
 * The envelope contract lives in src/abap_cli/output/cli-output.schema.json
 * (single source of truth). This test:
 *  1. Validates the schema file itself (well-formed, one success/error branch).
 *  2. Validates renderResult / renderError output against the schema.
 *  3. Validates the extension-meta variant and the reduced --schema meta.
 *  4. Runs EVERY registered command (scan of src/abap_cli/commands/*.ts):
 *       - failure path (unknown option): error envelope on stderr, stdout empty,
 *         exit 2, schema-valid — the stream-separation contract (P1.7).
 *       - success path (commands with --schema): success envelope on stdout,
 *         schema-valid with reduced meta.
 *  5. Asserts extension errors use dedicated EXTENSION_* codes and never
 *     masquerade as built-in codes.
 */

import { describe, expect, it, vi, beforeAll, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Command } from 'commander';
import {
  CliError,
  renderError,
  renderResult,
  setExtensionRegistry,
  toErrorShape,
} from '../../src/abap_cli/output/json.js';
import { buildMeta, resetWarnings } from '../../src/abap_cli/output/meta.js';
import { handleTopLevelError, type Streams } from '../../src/abap_cli/top-error.js';
import { makeProgram } from './cli-helper.js';
import { categoryOf } from '../../src/abap_cli/output/error-codes.js';
import { exitCodeFor } from '../../src/abap_cli/output/exit-codes.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const schemaPath = path.join(repoRoot, 'src/abap_cli/output/cli-output.schema.json');

// --- Minimal draft-07 subset validator (interprets the schema file itself) ---

type Schema = Record<string, unknown>;

function resolveRef(ref: string, root: Schema): Schema | undefined {
  if (!ref.startsWith('#/')) return undefined;
  let node: unknown = root;
  for (const part of ref.slice(2).split('/')) {
    if (node && typeof node === 'object' && Object.prototype.hasOwnProperty.call(node, part)) {
      node = (node as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return node as Schema;
}

function typeMatches(inst: unknown, t: string): boolean {
  switch (t) {
    case 'object': return inst !== null && typeof inst === 'object' && !Array.isArray(inst);
    case 'array': return Array.isArray(inst);
    case 'string': return typeof inst === 'string';
    case 'number': return typeof inst === 'number' && Number.isFinite(inst);
    case 'boolean': return typeof inst === 'boolean';
    default: return true;
  }
}

function validate(inst: unknown, schema: Schema, root: Schema, p: string): string[] {
  const errors: string[] = [];
  const at = (m: string): string => `${p}: ${m}`;

  if (typeof schema.$ref === 'string') {
    const target = resolveRef(schema.$ref, root);
    if (!target) return [at(`unresolved $ref ${schema.$ref}`)];
    return errors.concat(validate(inst, target, root, p));
  }

  if (Array.isArray(schema.oneOf)) {
    const matched = schema.oneOf.filter((sub) => validate(inst, sub as Schema, root, p).length === 0).length;
    if (matched !== 1) errors.push(at(`must match exactly one of ${schema.oneOf.length} subschemas (matched ${matched})`));
  }
  if (typeof schema.type === 'string' && !typeMatches(inst, schema.type)) {
    errors.push(at(`expected type ${schema.type}`));
  }
  if ('const' in schema && schema.const !== inst) {
    errors.push(at(`expected const ${JSON.stringify(schema.const)}`));
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(inst)) {
    errors.push(at(`not one of ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}`));
  }
  if (typeof schema.pattern === 'string' && typeof inst === 'string') {
    try {
      if (!new RegExp(schema.pattern).test(inst)) errors.push(at(`does not match pattern ${schema.pattern}`));
    } catch {
      // malformed pattern in the schema — ignore at runtime
    }
  }

  if (inst !== null && typeof inst === 'object') {
    if (Array.isArray(inst)) {
      if (schema.items) {
        (inst as unknown[]).forEach((item, i) => {
          errors.push(...validate(item, schema.items as Schema, root, `${p}[${i}]`));
        });
      }
    } else {
      const obj = inst as Record<string, unknown>;
      const props = (schema.properties ?? {}) as Record<string, Schema>;
      for (const [k, sub] of Object.entries(props)) {
        if (Object.prototype.hasOwnProperty.call(obj, k)) {
          errors.push(...validate(obj[k], sub, root, `${p}.${k}`));
        }
      }
      for (const k of Array.isArray(schema.required) ? (schema.required as string[]) : []) {
        if (!Object.prototype.hasOwnProperty.call(obj, k)) errors.push(at(`missing required property '${k}'`));
      }
      if (schema.additionalProperties === false) {
        const allowed = new Set(Object.keys(props));
        for (const k of Object.keys(obj)) {
          if (!allowed.has(k)) errors.push(at(`additional property '${k}' is not allowed`));
        }
      }
    }
  }
  return errors;
}

// --- Runner: parse with top-level error handler, capture both streams ---

class ExitSignal extends Error {
  constructor(public code?: number) {
    super(`exit ${code}`);
  }
}

interface CliOutcome {
  stdout: string;
  stderr: string;
  exitCode?: number;
}

async function runCli(program: Command, args: string[]): Promise<CliOutcome> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const logSpy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
    stdout.push(a.map(String).join(' '));
  });
  const errSpy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
    stderr.push(a.map(String).join(' '));
  });
  const streams: Streams = {
    stdout: { write: (s: string): boolean => { stdout.push(s); return true; } },
    stderr: { write: (s: string): boolean => { stderr.push(s); return true; } },
  };

  let exitCode: number | undefined;
  const prevArgv = process.argv;
  process.argv = ['node', 'abap', ...args];

  try {
    program.configureOutput({ writeErr: () => {} });
    try {
      await program.parseAsync(args, { from: 'user' });
    } catch (error) {
      handleTopLevelError(
        error,
        { program, argv: process.argv, version: '0.0.0-test' },
        streams,
        (code?: number): never => {
          exitCode = code;
          throw new ExitSignal(code);
        },
      );
    }
  } catch (error) {
    if (!(error instanceof ExitSignal)) throw error;
  } finally {
    process.argv = prevArgv;
    logSpy.mockRestore();
    errSpy.mockRestore();
  }
  return { stdout: stdout.join(''), stderr: stderr.join(''), exitCode };
}

/** First JSON object in a stream (error paths may append help text). */
function parseEnvelope(text: string): Record<string, unknown> {
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      // keep scanning
    }
  }
  throw new Error(`no JSON envelope found in:\n${text}`);
}

// --- Build the full command surface (scan, so new commands are auto-covered) ---

interface CommandEntry {
  name: string;
  hasSchema: boolean;
}

const commandsDir = path.join(repoRoot, 'src/abap_cli/commands');

async function buildFullProgram(): Promise<{ program: Command; entries: CommandEntry[] }> {
  // exitOverride must be set BEFORE subcommands are created: commander copies
  // the parent's _exitCallback into each subcommand at creation time (index.ts
  // does the same — exitOverride() before registerLazyCommands).
  const program = makeProgram();
  program.exitOverride();
  const files = fs.readdirSync(commandsDir).filter((f) => f.endsWith('.ts')).sort();
  for (const file of files) {
    const mod = (await import(pathToFileURL(path.join(commandsDir, file)).href)) as Record<string, unknown>;
    const registerFn = Object.entries(mod).find(
      ([key, value]) => /^register[A-Z]\w+Command$/.test(key) && typeof value === 'function',
    )?.[1];
    if (typeof registerFn !== 'function') continue;
    (registerFn as (p: Command) => void)(program);
  }
  const entries: CommandEntry[] = [];
  for (const cmd of program.commands) {
    const hasSchema = [cmd, ...cmd.commands].some((c) => c.options.some((o) => o.long === '--schema'));
    entries.push({ name: cmd.name(), hasSchema });
  }
  return { program, entries };
}

const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8')) as Schema;
const { program, entries } = await buildFullProgram();

afterEach(() => {
  resetWarnings();
});

describe('P1 envelope JSON Schema (cli-output.schema.json)', () => {
  it('schema file is well-formed with one success and one error branch', () => {
    const branches = schema.oneOf as Schema[];
    expect(branches).toHaveLength(2);
    expect(branches.map((b) => b.title)).toEqual(['success', 'error']);
    // The validator itself accepts a minimal valid success envelope.
    expect(
      validate({ status: 'success', data: {}, meta: { command: 'abap x', version: '1', durationMs: 1 } }, schema, schema),
    ).toEqual([]);
    // And rejects garbage.
    expect(validate({}, schema, schema)).not.toEqual([]);
  });

  it('renderResult success envelope is schema-valid; stderr stays empty', () => {
    const out = renderResult('json', { file: 'src/z.prog.abap', entries: [] }, '', buildMeta());
    const envelope = JSON.parse(out.stdout[0]!) as Record<string, unknown>;
    expect(validate(envelope, schema, schema)).toEqual([]);
    expect(out.stderr).toEqual([]);
  });

  it('renderError failure envelope is schema-valid; stdout stays empty', () => {
    const out = renderError('json', new CliError('PUSH_FAILED', 'boom'), buildMeta());
    const envelope = JSON.parse(out.stderr[0]!) as Record<string, unknown>;
    expect(validate(envelope, schema, schema)).toEqual([]);
    expect(out.stdout).toEqual([]);
    expect(out.exitCode).toBe(exitCodeFor(categoryOf('PUSH_FAILED')));
  });

  it('extension meta variant is schema-valid', () => {
    setExtensionRegistry({
      metaFragment: () => ({
        loaded: 1,
        byType: { validation: 1 },
        names: ['no-test-files'],
        validationRules: [{ name: 'no-test-files', appliesTo: ['push'] }],
      }),
    } as never);
    try {
      const out = renderResult('json', { ok: true }, '', buildMeta());
      const envelope = JSON.parse(out.stdout[0]!) as Record<string, unknown>;
      expect(validate(envelope, schema, schema)).toEqual([]);
      expect(((envelope.meta as Record<string, unknown>).extensions as Record<string, unknown>).loaded).toBe(1);
    } finally {
      setExtensionRegistry(undefined);
    }
  });

  it('data is always an object — a scalar data payload is rejected', () => {
    expect(
      validate({ status: 'success', data: 'nope', meta: { command: 'x', version: '1', durationMs: 1 } }, schema, schema),
    ).not.toEqual([]);
  });

  it('extension errors use dedicated EXTENSION_* codes, never built-in ones', () => {
    expect(categoryOf('EXTENSION_LOAD_FAILED')).toBe('CONFIG_ERROR');
    expect(categoryOf('EXTENSION_VALIDATION_FAILED')).toBe('VALIDATION_ERROR');
    expect(categoryOf('EXTENSION_COMMAND_BLOCKED')).toBe('VALIDATION_ERROR');
    expect(exitCodeFor(categoryOf('EXTENSION_VALIDATION_FAILED'))).toBe(7);
    // A raw extension throw renders as generic UNKNOWN, not a fabricated built-in.
    expect(toErrorShape(new Error('extension blew up')).code).toBe('UNKNOWN');
  });
});

describe('P1 per-command contract validation', () => {
  it('covers every registered command', () => {
    expect(entries.length).toBeGreaterThanOrEqual(19);
  });

  it.each(entries)('$name failure: error envelope on stderr, stdout empty, exit 2, schema-valid', async ({ name }) => {
    const res = await runCli(program, [name, '--json', '--__no_such_flag__']);
    expect(res.stdout).toBe('');
    const envelope = parseEnvelope(res.stderr);
    expect(validate(envelope, schema, schema)).toEqual([]);
    expect(envelope.status).toBe('error');
    expect((envelope.error as { code?: string }).code).toBe('USAGE');
    expect(res.exitCode).toBe(2);
  });

  it('--schema is exposed by every registered command', () => {
    const withSchema = entries.filter((e) => e.hasSchema).map((e) => e.name).sort();
    // All 19 commands must now expose `--schema` so agents can introspect
    // every command's parameter contract. Subcommands (e.g. `check syntax`,
    // `transport create`) inherit from the parent.
    const all = entries.map((e) => e.name).sort();
    expect(withSchema).toEqual(all);
  });

  it.each(entries.filter((e) => e.hasSchema))(
    '$name --schema success: envelope on stdout, schema-valid with reduced meta',
    async ({ name }) => {
      const res = await runCli(program, [name, '--schema', '--json']);
      const envelope = parseEnvelope(res.stdout);
      expect(validate(envelope, schema, schema)).toEqual([]);
      expect(envelope.status).toBe('success');
      expect(Object.keys((envelope.meta as Record<string, unknown>)).sort()).toEqual(['command', 'durationMs', 'version']);
    },
  );
});
