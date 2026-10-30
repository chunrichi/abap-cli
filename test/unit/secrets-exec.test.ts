/**
 * The native keychain backends read their secret through `execFileAsync`.
 *
 * These cases spawn a real child process: the failure mode they guard
 * against — awaiting the callback-style `execFile()`, which resolves to the
 * `ChildProcess` handle instead of the output — cannot be reproduced with a
 * mock that already returns a promise.
 */
import { describe, expect, it } from 'vitest';
import { execFileAsync } from '../../src/abap_cli/config/secrets/exec.js';

describe('execFileAsync', () => {
  it('resolves the captured stdout/stderr as text', async () => {
    const result = await execFileAsync(process.execPath, [
      '-e',
      'process.stdout.write("secret"); process.stderr.write("diag")',
    ]);
    expect(result.stdout).toBe('secret');
    expect(result.stderr).toBe('diag');
  });

  it('rejects with the child exit code so callers can map "item not found"', async () => {
    await expect(
      execFileAsync(process.execPath, ['-e', 'process.exit(44)']),
    ).rejects.toMatchObject({ code: 44 });
  });
});
