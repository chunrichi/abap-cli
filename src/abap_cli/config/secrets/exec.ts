/**
 * Promise wrapper around the callback-style `child_process.execFile`.
 *
 * `execFile()` returns a `ChildProcess` handle synchronously; awaiting the
 * call therefore yields that handle, not the command output (`stdout` is a
 * stream, so stringifying it produces `"[object Object]"`). Every native
 * keychain read goes through this helper so the value arrives as text.
 */
import { execFile, type ExecFileOptions } from 'node:child_process';

/** Run a command and resolve with its captured UTF-8 stdout/stderr. */
export function execFileAsync(
  file: string,
  args: readonly string[],
  options: ExecFileOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { ...options, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}
