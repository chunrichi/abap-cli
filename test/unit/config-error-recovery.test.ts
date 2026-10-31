/**
 * Structured recovery for the first-run `CONFIG_ERROR`.
 *
 * Configuration failures are the first error an agent hits in a fresh
 * workspace, so they must not be prose-only: the envelope carries
 * `details.missing`, ordered `nextSteps`, one canonical `example` and the
 * setup-skill `references`. This pins the shared config-loading layer plus the
 * `init --profile` no-password path; every SAP command funnels through
 * `loadConfig`, so the 16 command-level first errors inherit the same shape.
 *
 * The config modules are imported dynamically after `vi.resetModules()` so the
 * `os.homedir()` mock (user config path is resolved at module load) applies.
 * Assertions are structural — the re-imported modules expose a distinct
 * `CliError` class identity.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const home = vi.hoisted(() => ({ dir: '' }));

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => home.dir };
});

interface ErrorLike {
  code?: string;
  message?: string;
  details?: { missing?: string[]; profile?: string };
  nextSteps?: string[];
  example?: string;
  references?: string;
}

let root: string;
let workspace: string;

function systemsPath(): string {
  return path.join(home.dir, '.abap-cli', 'systems.json');
}

function writeSystems(systems: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(systemsPath()), { recursive: true });
  fs.writeFileSync(systemsPath(), JSON.stringify({ systems }, null, 2), 'utf-8');
}

function writeWorkspaceConfig(system: string): void {
  fs.writeFileSync(path.join(workspace, '.abap.json'), JSON.stringify({ system }, null, 2), 'utf-8');
}

async function loadProjectConfigModule() {
  vi.resetModules();
  return import('../../src/abap_cli/config/project-config.js');
}

/** Run `fn`, require it to reject, and return the thrown value as a record. */
async function captureError(fn: () => Promise<unknown>): Promise<ErrorLike> {
  try {
    await fn();
  } catch (error: unknown) {
    return error as ErrorLike;
  }
  throw new Error('expected the call to reject');
}

beforeEach(() => {
  // `.git` in the parent stops the upward `.abap.json` walk, so the test
  // workspace cannot inherit a config from the host.
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'config-recovery-'));
  fs.mkdirSync(path.join(root, '.git'));
  workspace = path.join(root, 'ws');
  fs.mkdirSync(workspace);
  home.dir = path.join(root, 'home');
  fs.mkdirSync(home.dir);
  process.env.ABAP_CLI_KEYCHAIN_BACKEND = 'fixture';
  delete process.env.ABAP_CLI_KEYCHAIN_FIXTURE_PASSWORD;
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  delete process.env.ABAP_CLI_KEYCHAIN_BACKEND;
  delete process.env.ABAP_CLI_KEYCHAIN_FIXTURE_PASSWORD;
});

const CONFIG_REFERENCE = 'skills/abap-cli-setup/references/errors.md#config_error';

describe('CONFIG_ERROR structured recovery', () => {
  it('missing workspace binding reports details.missing: ["system"]', async () => {
    const { loadConfig } = await loadProjectConfigModule();
    const error = await captureError(() => loadConfig({ cwd: workspace }));
    expect(error.code).toBe('CONFIG_ERROR');
    expect(error.details?.missing).toEqual(['system']);
    expect(error.nextSteps!.join(' ')).toContain('abap profile add');
    expect(error.nextSteps!.join(' ')).toContain('abap init --profile');
    expect(error.example).toContain('abap ');
    expect(error.references).toBe(CONFIG_REFERENCE);
  });

  it('unknown bound profile reports details.missing: ["system profile"]', async () => {
    writeWorkspaceConfig('ghost');
    writeSystems({});
    const { loadConfig } = await loadProjectConfigModule();
    const error = await captureError(() => loadConfig({ cwd: workspace }));
    expect(error.code).toBe('CONFIG_ERROR');
    expect(error.details?.missing).toEqual(['system profile']);
    expect(error.details?.profile).toBe('ghost');
    expect(error.nextSteps!.join(' ')).toContain('abap profile add ghost');
    expect(error.example).toContain('abap profile add ghost');
    expect(error.references).toBe(CONFIG_REFERENCE);
  });

  it('profile missing url reports the concrete missing field', async () => {
    writeWorkspaceConfig('dev2');
    writeSystems({ dev2: { username: 'DEV', language: 'EN' } });
    const { loadConfig } = await loadProjectConfigModule();
    const error = await captureError(() => loadConfig({ cwd: workspace }));
    expect(error.code).toBe('CONFIG_ERROR');
    expect(error.details?.missing).toEqual(['url']);
    expect(error.details?.profile).toBe('dev2');
    expect(error.nextSteps!.join(' ')).toContain('abap profile set dev2');
    expect(error.references).toBe(CONFIG_REFERENCE);
  });

  it('init --profile without a stored password reports details.missing: ["password"]', async () => {
    writeSystems({ dev2: { url: 'https://sap.example.invalid', username: 'DEV', language: 'EN' } });
    vi.resetModules();
    const { runInitFromOpts } = await import('../../src/abap_cli/flows/setup/init.js');
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(workspace);
    try {
      const error = await captureError(() => runInitFromOpts({ profile: 'dev2', yes: true }, 'json'));
      expect(error.code).toBe('CONFIG_ERROR');
      expect(error.details?.missing).toEqual(['password']);
      expect(error.details?.profile).toBe('dev2');
      expect(error.nextSteps!.join(' ')).toContain('abap profile set dev2 --password');
      expect(error.example).toContain('abap init --profile dev2');
      expect(error.references).toBe(CONFIG_REFERENCE);
    } finally {
      cwdSpy.mockRestore();
    }
  });
});
