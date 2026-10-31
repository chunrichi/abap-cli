/**
 * Process-level lazy-loading contract.
 *
 * These tests spawn the built CLI binary, so they live in the integration
 * suite: `npm test` (unit) must pass on a checkout that has not been built.
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cliEntry = path.join(repoRoot, 'dist/index.js');
const run = promisify(execFile);
const hasBuiltCli = fs.existsSync(cliEntry);

// src/index.ts eagerly calls loadConfig() at module load (before commander
// parses argv), so a spawned child needs a valid .abap.json + system profile
// even for `abap --help`. Provide both under a tmpdir, run the child with
// HOME pointing there so os.homedir() resolves to our fake user-config dir,
// and clean up afterwards.
async function withFakeProject(args: string[]): Promise<{ stdout: string; stderr: string }> {
  const os = await import('node:os');
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'abap-cli-lazy-'));
  fs.mkdirSync(path.join(tmpHome, '.abap-cli'), { recursive: true });
  fs.writeFileSync(
    path.join(tmpHome, '.abap-cli', 'systems.json'),
    JSON.stringify({
      systems: {
        fake: {
          url: 'https://example.invalid',
          client: '001',
          username: 'fake',
          password: '',
          language: 'EN',
          insecure: true,
          caPath: '',
        },
      },
    }),
  );
  fs.writeFileSync(
    path.join(tmpHome, '.abap.json'),
    JSON.stringify({ system: 'fake' }, null, 2),
  );
  try {
    return await run(process.execPath, [cliEntry, ...args], {
      cwd: tmpHome,
      env: { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome, ABAP_CLI_KEYCHAIN_BACKEND: 'none' },
    });
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
}

describe('lazy loading at the process level', () => {
  it.skipIf(!hasBuiltCli)('--help lists commands without any SAP call', async () => {
    const { stdout } = await withFakeProject(['--help']);
    for (const name of ['init', 'pull', 'transport', 'profile']) {
      expect(stdout).toContain(name);
    }
  });

  it.skipIf(!hasBuiltCli)('a subcommand --help lazy-loads its module (exit 0)', async () => {
    const { stdout } = await withFakeProject(['transport', 'list', '--help']);
    expect(stdout).toContain('List transport requests for current user');
  });

  it.skipIf(!hasBuiltCli)('search --schema runs without loading SAP clients', async () => {
    const { stdout } = await withFakeProject(['search', '--schema']);
    expect(stdout).toContain('"status":"success"');
    expect(stdout).toContain('"schemaVersion"');
  });
});

// --- root --help groups local commands under a dedicated section ---
const LOCAL_NAMES = ['init', 'profile', 'doctor'];
const SAP_NAMES = ['pull', 'push', 'check', 'search', 'create', 'status', 'transport', 'deploy', 'inspect', 'diff'];

describe('lazy command scope grouping', () => {
  it.skipIf(!hasBuiltCli)('built CLI root --help groups init/profile/doctor as local', async () => {
    const { stdout } = await withFakeProject(['--help']);
    expect(stdout).toContain('Local commands (no SAP connection required):');
    // The Local section is the block between the heading and the next
    // blank line that follows the closing "These commands do not call SAP."
    // hint. Scope to that block so the unrelated Commands: list (and its
    // own duplicates) don't bleed into the assertion.
    const localSection = stdout
      .split('Local commands (no SAP connection required):')[1]
      ?.split('These commands do not call SAP.')[0] ?? '';
    for (const name of LOCAL_NAMES) {
      expect(localSection, `'${name}' is listed under the Local section`).toContain(name);
    }
    // SAP commands must not appear in the local section.
    // Use word-boundary regex (\b) so 'extension' doesn't false-match 'extensions'.
    for (const name of SAP_NAMES) {
      const re = new RegExp(`\\b${name}\\b`);
      expect(localSection, `'${name}' must NOT be in the local section`).not.toMatch(re);
    }
  });
});
