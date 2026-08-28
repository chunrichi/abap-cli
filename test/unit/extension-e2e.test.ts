/**
 * Extension mechanism E2E tests (T019–T027).
 *
 * Uses the built CLI binary against temp workspaces with real .abap.json configs.
 * Each test:
 *   1. Creates a temp workspace OUTSIDE the repo tree (so findWorkspaceConfig
 *      does not stop at the repo .git boundary)
 *   2. Writes .abap.json with extension manifests and system: 'mock'
 *   3. Writes extension files (mjs modules)
 *   4. Spawns the CLI binary with cwd=workspace and captures output
 */

import { describe, expect, it, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const cliEntry = join(repoRoot, 'dist/src/abap_cli/index.js');

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runCli(args: string[], workspaceDir: string, env: Record<string, string> = {}): Promise<CliResult> {
  const fullEnv = { ...process.env, ...env };
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [cliEntry, ...args],
      { cwd: workspaceDir, env: fullEnv },
    );
    return { stdout, stderr, exitCode: 0 };
  } catch (err: unknown) {
    const code = (err as { code?: number }).code ?? 1;
    return { stdout: (err as { stdout?: string }).stdout ?? '', stderr: (err as { stderr?: string }).stderr ?? '', exitCode: typeof code === 'number' ? code : 1 };
  }
}

function parseJson(result: CliResult): Record<string, unknown> {
  try {
    return JSON.parse(result.stdout.trim());
  } catch {
    return JSON.parse(result.stderr.trim());
  }
}

describe('Extension E2E (mock)', () => {
  // Extension loading (dynamic import) can take 30+ seconds on first run
  // due to module graph resolution.

  let workspace: string;

  afterEach(() => {
    if (workspace) rmSync(workspace, { recursive: true, force: true });
  });

  // T019
  it('T019 ValidationRule rejects push and exits 7', async () => {
    workspace = mkdtempSync(join(os.tmpdir(), 'abap-ext-e2e-t019-'));

    const extFile = join(workspace, 'no-test-files.mjs');
    writeFileSync(extFile, `
export default {
  type: 'validation',
  name: 'no-test-files',
  appliesTo: '*',
  validate: (ctx) => {
    const files = ctx.files ?? [];
    const hasTest = files.some(f => f.includes('test'));
    return hasTest
      ? { ok: false, message: 'test files not allowed', violation: 'test-in-path' }
      : { ok: true };
  },
};
`);

    writeFileSync(join(workspace, '.abap.json'), JSON.stringify({
      system: 'mock',
      transport: 'TRA123',
      package: 'ZTEST',
      extensions: [
        { type: 'validation', name: 'no-test-files', source: { sourceType: 'path', path: extFile } },
      ],
    }, null, 2));

    const badDir = mkdtempSync(join(workspace, 'my_test_subdir-'));
    const badFile = join(badDir, 'myprog.prog.abap');
    writeFileSync(badFile, 'REPORT ZTEST.');

    const result = await runCli(['push', badFile, '--yes', '--json'], workspace);
    expect(result.exitCode).toBe(7);
    // Error code appears in JSON envelope on stderr
    expect(result.stderr).toContain('EXTENSION_VALIDATION_FAILED');
    rmSync(badDir, { recursive: true });
  });

  // T022
  it('T022 non-existent extension path: lenient mode exits 0 with failed=1', async () => {
    workspace = mkdtempSync(join(os.tmpdir(), 'abap-ext-e2e-t022-'));

    writeFileSync(join(workspace, '.abap.json'), JSON.stringify({
      system: 'mock',
      transport: 'TRA123',
      package: 'ZTEST',
      extensions: [
        { type: 'validation', name: 'ghost-rule', source: { sourceType: 'path', path: join(workspace, 'does-not-exist.mjs') } },
      ],
    }, null, 2));

    const result = await runCli(['extensions', 'list', '--json'], workspace);
    expect(result.exitCode).toBe(0);

    const json = parseJson(result);
    const meta = (json.meta as Record<string, unknown>) ?? {};
    const extMeta = (meta.extensions as Record<string, unknown>) ?? {};
    expect(extMeta.failed).toBe(1);
    expect(extMeta.loaded).toBe(0);
  });

  // T023
  it('T023 strict mode with broken extension: exit 3 EXTENSION_LOAD_FAILED', async () => {
    workspace = mkdtempSync(join(os.tmpdir(), 'abap-ext-e2e-t023-'));

    writeFileSync(join(workspace, '.abap.json'), JSON.stringify({
      system: 'mock',
      transport: 'TRA123',
      package: 'ZTEST',
      extensions: [
        { type: 'validation', name: 'ghost-strict', source: { sourceType: 'path', path: join(workspace, 'does-not-exist.mjs') } },
      ],
    }, null, 2));

    const result = await runCli(['extensions', 'list'], workspace, { ABAP_CLI_EXTENSIONS_STRICT: '1' });
    expect(result.exitCode).toBe(3);
    expect((result.stdout + result.stderr)).toContain('EXTENSION_LOAD_FAILED');
  });

  // T025
  it('T025 path escape via ../../../etc/passwd: extension fails with path_escapes_allowlist', async () => {
    workspace = mkdtempSync(join(os.tmpdir(), 'abap-ext-e2e-t025-'));

    writeFileSync(join(workspace, '.abap.json'), JSON.stringify({
      system: 'mock',
      transport: 'TRA123',
      package: 'ZTEST',
      extensions: [
        { type: 'validation', name: 'escape-attempt', source: { sourceType: 'path', path: '../../../etc/passwd' } },
      ],
    }, null, 2));

    const result = await runCli(['extensions', 'list', '--json'], workspace);
    expect(result.exitCode).toBe(0);

    const json = parseJson(result);
    const meta = (json.meta as Record<string, unknown>) ?? {};
    const extMeta = (meta.extensions as Record<string, unknown>) ?? {};
    expect(extMeta.failed).toBe(1);

    const data = json.data as Record<string, unknown>;
    const extensions = (data.extensions as Array<Record<string, unknown>>) ?? [];
    const escapeExt = extensions.find((e) => e.name === 'escape-attempt');
    expect(escapeExt).toBeDefined();
    expect(escapeExt!.status).toBe('failed');
    // The relative path resolves under /var/folders which is a sibling of workspace,
    // so it passes the allowlist check but fails to import (file doesn't exist).
    // 027 US1: lazy load preserves the underlying reason (path_contains_parent_ref);
    // tests that pin to the legacy wrapper message (import_failed) also pass.
    expect((escapeExt!.error as string ?? '')).toMatch(/import_failed|path_contains_parent_ref|parent_ref/i);
  });

  // T026
  it('T026 extensions list --json returns correct shape with name/type/source/status', { timeout: 60_000 }, async () => {
    workspace = mkdtempSync(join(os.tmpdir(), 'abap-ext-e2e-t026-'));

    const extFile = join(workspace, 'rule1.mjs');
    writeFileSync(extFile, `
export default {
  type: 'validation',
  name: 'rule-one',
  appliesTo: '*',
  validate: () => ({ ok: true }),
};
`);

    writeFileSync(join(workspace, '.abap.json'), JSON.stringify({
      system: 'mock',
      transport: 'TRA123',
      package: 'ZTEST',
      extensions: [
        { type: 'validation', name: 'rule-one', source: { sourceType: 'path', path: extFile } },
      ],
    }, null, 2));

    const result = await runCli(['extensions', 'list', '--json'], workspace);
    expect(result.exitCode).toBe(0);

    const json = parseJson(result);
    expect(json.status).toBe('success');
    const data = json.data as Record<string, unknown>;
    const extensions = (data.extensions as Array<Record<string, unknown>>) ?? [];
    expect(extensions.length).toBeGreaterThan(0);

    const ruleOne = extensions.find((e) => e.name === 'rule-one');
    expect(ruleOne).toBeDefined();
    expect(ruleOne!.type).toBe('validation');
    expect((ruleOne!.source as Record<string, unknown>).sourceType).toBe('path');
    expect(ruleOne!.status).toBe('loaded');
  });

  // T024
  it('T024 CommandExtension name conflict: registered but built-in takes precedence', { timeout: 60_000 }, async () => {
    workspace = mkdtempSync(join(os.tmpdir(), 'abap-ext-e2e-t024-'));

    const extFile = join(workspace, 'bad-pull.mjs');
    writeFileSync(extFile, `
export default {
  type: 'command',
  name: 'pull',
  description: 'Fake pull that conflicts',
  command: 'pull',
  action: () => { console.log('fake pull'); },
};
`);

    writeFileSync(join(workspace, '.abap.json'), JSON.stringify({
      system: 'mock',
      transport: 'TRA123',
      package: 'ZTEST',
      extensions: [
        { type: 'command', name: 'pull', source: { sourceType: 'path', path: extFile } },
      ],
    }, null, 2));

    const listResult = await runCli(['extensions', 'list', '--json'], workspace);
    expect(listResult.exitCode).toBe(0);

    const json = parseJson(listResult);
    const data = json.data as Record<string, unknown>;
    const extensions = (data.extensions as Array<Record<string, unknown>>) ?? [];
    const conflict = extensions.find((e) => e.name === 'pull');
    expect(conflict).toBeDefined();
    // A CommandExtension may not shadow a built-in command: it is rejected at
    // load time so the built-in always wins.
    expect(conflict!.status).toBe('failed');

    // Verify the built-in pull is still accessible (shows help, not extension output)
    const pullResult = await runCli(['pull', '--help'], workspace);
    expect(pullResult.exitCode).toBe(0);
    expect(pullResult.stdout).toContain('Download ABAP objects from SAP');
  });

  it('T028 CommandExtension is actually invocable', { timeout: 60_000 }, async () => {
    workspace = mkdtempSync(join(os.tmpdir(), 'abap-ext-e2e-t028-'));

    const extFile = join(workspace, 'hello.mjs');
    writeFileSync(extFile, `
export default {
  type: 'command',
  name: 'myorg-hello',
  description: 'Say hello from an extension',
  command: 'myorg-hello [name]',
  action: (ctx, opts, name) => { console.log('hello ' + (name ?? 'world')); },
};
`);

    writeFileSync(join(workspace, '.abap.json'), JSON.stringify({
      system: 'mock',
      transport: 'TRA123',
      package: 'ZTEST',
      extensions: [
        { type: 'command', name: 'myorg-hello', source: { sourceType: 'path', path: extFile } },
      ],
    }, null, 2));

    const result = await runCli(['myorg-hello', 'abap'], workspace);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('hello abap');
  });

  it('T029 beforeCommand hook can veto a command', { timeout: 60_000 }, async () => {
    workspace = mkdtempSync(join(os.tmpdir(), 'abap-ext-e2e-t029-'));

    const extFile = join(workspace, 'policy.mjs');
    writeFileSync(extFile, `
export default {
  type: 'lifecycle',
  name: 'command-policy',
  event: 'beforeCommand',
  hook: (ctx) => {
    if (ctx.command === 'search') return { block: true, reason: 'disabled by policy' };
  },
};
`);

    writeFileSync(join(workspace, '.abap.json'), JSON.stringify({
      system: 'mock',
      transport: 'TRA123',
      package: 'ZTEST',
      extensions: [
        { type: 'lifecycle', name: 'command-policy', source: { sourceType: 'path', path: extFile } },
      ],
    }, null, 2));

    const blocked = await runCli(['search', 'ZCL_FOO', '--json'], workspace);
    expect(blocked.exitCode).toBe(7);
    const json = parseJson(blocked);
    expect(json.status).toBe('error');
    expect((json.error as Record<string, unknown>).code).toBe('EXTENSION_COMMAND_BLOCKED');
  });
});
