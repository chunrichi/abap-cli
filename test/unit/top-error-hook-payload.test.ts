import { describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { handleTopLevelError, type Streams } from '../../src/abap_cli/top-error.js';
import { CliError } from '../../src/abap_cli/output/json.js';
import type { ExtensionRegistry } from '../../src/abap_cli/extensions/registry.js';

/**
 * Regression: feedback F-01.
 *
 * `handleTopLevelError` used to feed the first stderr line straight into
 * `JSON.parse` when building the `onError` hook payload. Human-mode stderr is
 * plain text (`Error: <message>`), so every human-mode failure threw a
 * `SyntaxError` from inside the error handler — replacing the real cause with
 * an unrelated one. A missing `ajv` dependency surfaced as
 * `SyntaxError: Unexpected token 'E'`, which sent debugging in the wrong
 * direction for ~40 minutes.
 *
 * The handler must always reach its exit path, and hooks must still receive a
 * usable error shape.
 */

class FakeExit extends Error {
  constructor(public code?: number) {
    super(`exit ${code ?? 'undefined'}`);
  }
}

interface Capture {
  streams: Streams;
  out: { stdout: string[]; stderr: string[] };
}

function capture(): Capture {
  const out = { stdout: [] as string[], stderr: [] as string[] };
  return {
    out,
    streams: {
      stdout: { write: (s: string): boolean => { out.stdout.push(s); return true; } },
      stderr: { write: (s: string): boolean => { out.stderr.push(s); return true; } },
    },
  };
}

function fakeRegistry(payloads: unknown[]): ExtensionRegistry {
  return {
    dispatchAll: vi.fn(async (_event: string, ctx: unknown) => {
      payloads.push(ctx);
    }),
  } as unknown as ExtensionRegistry;
}

function run(
  error: unknown,
  argv: string[],
  registry?: ExtensionRegistry,
): { stdout: string; stderr: string; exitCode: number | undefined; threw?: unknown } {
  const { streams, out } = capture();
  const originalArgv = process.argv;
  process.argv = ['node', 'abap', ...argv];
  let exitCode: number | undefined;
  let threw: unknown;
  try {
    handleTopLevelError(
      error,
      { program: new Command().exitOverride(), argv: process.argv, version: '9.9.9' },
      streams,
      (code?: number): never => {
        exitCode = code;
        throw new FakeExit(code);
      },
      registry,
    );
  } catch (caught) {
    if (!(caught instanceof FakeExit)) threw = caught;
  } finally {
    process.argv = originalArgv;
  }
  return { stdout: out.stdout.join(''), stderr: out.stderr.join(''), exitCode, threw };
}

describe('handleTopLevelError — onError hook payload never masks the real error (F-01)', () => {
  it('human mode: does not throw and synthesizes the hook error from the plain-text line', async () => {
    const payloads: unknown[] = [];
    const registry = fakeRegistry(payloads);

    const res = run(new CliError('SAP_ERROR', "Cannot find package 'ajv'"), ['pull', 'ZCL_X'], registry);

    expect(res.threw).toBeUndefined();
    expect(res.exitCode).toBe(6);
    expect(res.stderr).toContain("Error: Cannot find package 'ajv'");

    await vi.waitFor(() => expect(payloads.length).toBe(1));
    const ctx = payloads[0] as { error: { code: string; message: string; category: string }; command: string };
    // The real cause must survive into the hook context, and never be a SyntaxError.
    expect(ctx.error.message).toBe("Cannot find package 'ajv'");
    expect(ctx.error.message).not.toContain('Error: ');
    expect(ctx.error.code).toBe('UNKNOWN');
    expect(ctx.error.category).toBe('UNKNOWN');
  });

  it('json mode: keeps the parsed envelope error (code/category preserved)', async () => {
    const payloads: unknown[] = [];
    const registry = fakeRegistry(payloads);

    const res = run(new CliError('SAP_ERROR', 'boom'), ['pull', 'ZCL_X', '--json'], registry);

    expect(res.threw).toBeUndefined();
    await vi.waitFor(() => expect(payloads.length).toBe(1));
    const ctx = payloads[0] as { error: { code: string; message: string; category: string } };
    expect(ctx.error.code).toBe('SAP_ERROR');
    expect(ctx.error.category).toBe('SAP_ERROR');
    expect(ctx.error.message).toBe('boom');
  });

  it('no registry: exits normally without touching hooks', () => {
    const res = run(new CliError('SAP_ERROR', 'boom'), ['pull', 'ZCL_X']);
    expect(res.threw).toBeUndefined();
    expect(res.exitCode).toBe(6);
  });
});
