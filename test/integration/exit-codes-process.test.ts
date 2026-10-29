/**
 * Process-level exit-code contract (US-3).
 *
 * These tests spawn the built CLI binary, so they live in the integration
 * suite: `npm test` (unit) must pass on a checkout that has not been built.
 */
import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cliEntry = path.join(repoRoot, 'dist/index.js');
const run = promisify(execFile);
const hasBuiltCli = fs.existsSync(cliEntry);

describe('process-level help/version (US-3)', () => {
  it.skipIf(!hasBuiltCli)('--help exits 0 with text output and no envelope JSON', async () => {
    const { stdout, stderr } = await run(process.execPath, [cliEntry, '--help']);
    expect(stdout).toContain('Usage');
    expect(stderr).toBe('');
    expect(stdout).not.toContain('"status"');
  });

  it.skipIf(!hasBuiltCli)('--version exits 0 with version text and no envelope JSON', async () => {
    const { stdout } = await run(process.execPath, [cliEntry, '--version']);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    expect(stdout).not.toContain('"status"');
  });
});
