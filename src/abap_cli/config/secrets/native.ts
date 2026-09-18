/**
 * Native OS keychain backend — no native compilation required.
 *
 * Implements `SecretsBackend` by shelling out to the platform's built-in
 * credential store:
 *
 *   - **Windows**: `cmdkey.exe` (write/delete) + PowerShell `Add-Type` calling
 *     `Advapi32.dll!CredReadW` (read). Handles both UTF-8 (legacy `keytar`)
 *     and UTF-16LE (Windows Credential Manager native) byte layouts.
 *   - **macOS**: `/usr/bin/security` CLI (`add-generic-password` /
 *     `find-generic-password` / `delete-generic-password`).
 *   - **Linux**: `secret-tool` CLI (libsecret-tools).
 *
 * The `SERVICE` / `ACCOUNT` pair is preserved across platforms so the
 * keychain entries written by the legacy `keytar` backend remain visible to
 * `find-generic-password` / `secret-tool lookup` and vice versa — migrating
 * from `keytar` to native is data-preserving.
 */
import { execFile, spawn } from 'node:child_process';
import { platform } from 'node:os';
import { CliError } from '../../output/json.js';
import type { SecretKind, SecretsBackend } from '../secrets-types.js';

/** Mirrors `SERVICE` in secrets.ts — kept in sync deliberately. */
const SERVICE = 'abap-cli';

/** Per-account credential key derivation (must match `keytar` legacy layout). */
function accountKey(account: string, kind: SecretKind): string {
  if (kind === 'cert-passphrase') return `${account}.cert-passphrase`;
  if (kind === 'session-key') return 'abap-cli/session-key';
  return account;
}

/* ───────────────────── Windows ───────────────────── */

class WindowsKeychainAdapter implements SecretsBackend {
  readonly name = 'native-windows';

  async isAvailable(): Promise<boolean> {
    try {
      await execFile('cmdkey.exe', ['/list'], { windowsHide: true, timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  async set(account: string, kind: SecretKind, value: string): Promise<void> {
    const target = `${SERVICE}/${accountKey(account, kind)}`;
    try {
      await execFile('cmdkey.exe',
        [`/generic:${target}`, `/user:${account}`, `/pass:${value}`],
        { windowsHide: true, timeout: 10000 },
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new CliError('CONFIG_ERROR', `cmdkey.exe failed: ${message}`);
    }
  }

  async get(account: string, kind: SecretKind): Promise<string | null> {
    const target = `${SERVICE}/${accountKey(account, kind)}`;
    const psScript = `
$ErrorActionPreference = 'Stop'
$target = ${psString(target)}
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WinCredRead {
  [DllImport("Advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool CredRead(string target, int type, int reservedFlag, out IntPtr credentialPtr);
  [DllImport("Advapi32.dll", EntryPoint="CredFree", SetLastError=true)]
  public static extern void CredFree(IntPtr cred);
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct CREDENTIAL {
    public int Flags; public int Type; public string TargetName; public string Comment;
    public long LastWritten; public int CredentialBlobSize; public IntPtr CredentialBlob;
    public int Persist; public int AttributeCount; public IntPtr Attributes;
    public string TargetAlias; public string UserName;
  }
  public static string Read(string target) {
    IntPtr credPtr;
    if (!CredRead(target, 1, 0, out credPtr)) return $null;
    try {
      CREDENTIAL cred = (CREDENTIAL)Marshal.PtrToStructure(credPtr, typeof(CREDENTIAL));
      if (cred.CredentialBlobSize <= 0 || cred.CredentialBlob == IntPtr.Zero) return '';
      byte[] bytes = new byte[cred.CredentialBlobSize];
      Marshal.Copy(cred.CredentialBlob, bytes, 0, cred.CredentialBlobSize);
      if (bytes.Length >= 2 && bytes.Length % 2 == 0 && bytes[1] == 0) {
        return Encoding.Unicode.GetString(bytes);
      }
      return Encoding.UTF8.GetString(bytes);
    } finally { CredFree(credPtr); }
  }
}
"@
[WinCredRead]::Read($target)
`.trim();

    let stdout: string;
    try {
      const result = await execFile('powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
        { windowsHide: true, timeout: 15000 },
      );
      stdout = typeof result.stdout === 'string' ? result.stdout : String(result.stdout ?? '');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new CliError('CONFIG_ERROR', `powershell.exe failed: ${message}`);
    }
    const trimmed = stdout.trim();
    if (trimmed === '' || trimmed === '$null') return null;
    return trimmed.split(/\r?\n/)[0] ?? null;
  }

  async delete(account: string, kind: SecretKind): Promise<boolean> {
    const target = `${SERVICE}/${accountKey(account, kind)}`;
    try {
      await execFile('cmdkey.exe', [`/delete:${target}`], { windowsHide: true, timeout: 5000 });
      return true;
    } catch (error: unknown) {
      // cmdkey /delete exits 1 when target doesn't exist; treat as success.
      const code = (error as { code?: unknown })?.code;
      if (code === 1) return false;
      const message = error instanceof Error ? error.message : String(error);
      throw new CliError('CONFIG_ERROR', `cmdkey.exe failed: ${message}`);
    }
  }
}

/** PowerShell single-quoted string literal — `'` doubled. */
function psString(s: string): string {
  return "'" + s.replace(/'/g, "''") + "'";
}

/* ───────────────────── macOS ───────────────────── */

class MacosKeychainAdapter implements SecretsBackend {
  readonly name = 'native-macos';

  async isAvailable(): Promise<boolean> {
    try {
      await execFile('/usr/bin/security', ['help'], { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  async set(account: string, kind: SecretKind, value: string): Promise<void> {
    try {
      await execFile('/usr/bin/security',
        ['add-generic-password', '-a', accountKey(account, kind), '-s', SERVICE, '-w', value],
        { timeout: 10000 },
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new CliError('CONFIG_ERROR', `security add-generic-password failed: ${message}`);
    }
  }

  async get(account: string, kind: SecretKind): Promise<string | null> {
    try {
      const result = await execFile('/usr/bin/security',
        ['find-generic-password', '-a', accountKey(account, kind), '-s', SERVICE, '-w'],
        { timeout: 10000 },
      );
      const stdout = typeof result.stdout === 'string' ? result.stdout : String(result.stdout ?? '');
      return stdout.replace(/\r?\n$/, '');
    } catch (error: unknown) {
      const code = (error as { code?: unknown })?.code;
      if (code === 44) return null; // item not found
      const message = error instanceof Error ? error.message : String(error);
      throw new CliError('CONFIG_ERROR', `security find-generic-password failed: ${message}`);
    }
  }

  async delete(account: string, kind: SecretKind): Promise<boolean> {
    try {
      await execFile('/usr/bin/security',
        ['delete-generic-password', '-a', accountKey(account, kind), '-s', SERVICE],
        { timeout: 10000 },
      );
      return true;
    } catch (error: unknown) {
      const code = (error as { code?: unknown })?.code;
      if (code === 44) return false; // item not found
      const message = error instanceof Error ? error.message : String(error);
      throw new CliError('CONFIG_ERROR', `security delete-generic-password failed: ${message}`);
    }
  }
}

/* ───────────────────── Linux ───────────────────── */

class LinuxKeychainAdapter implements SecretsBackend {
  readonly name = 'native-linux';

  async isAvailable(): Promise<boolean> {
    try {
      await execFile('secret-tool', ['--help'], { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  async set(account: string, kind: SecretKind, value: string): Promise<void> {
    await this.run(['store', '--label', `${SERVICE}/${accountKey(account, kind)}`,
      'service', SERVICE, 'account', accountKey(account, kind)], value);
  }

  async get(account: string, kind: SecretKind): Promise<string | null> {
    try {
      const { stdout } = await this.run(['lookup', 'service', SERVICE, 'account', accountKey(account, kind)]);
      return (stdout ?? '').replace(/\n$/, '');
    } catch (error: unknown) {
      const code = (error as { code?: unknown })?.code;
      if (code === 1 || code === '1') return null;
      throw error;
    }
  }

  async delete(account: string, kind: SecretKind): Promise<boolean> {
    try {
      await this.run(['clear', 'service', SERVICE, 'account', accountKey(account, kind)]);
      return true;
    } catch (error: unknown) {
      const code = (error as { code?: unknown })?.code;
      if (code === 1 || code === '1') return false;
      throw error;
    }
  }

  /** secret-tool reads the secret from stdin; use spawn to pipe value in. */
  private run(args: string[], stdin?: string): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn('secret-tool', args, { stdio: ['pipe', 'pipe', 'pipe'] });
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      child.stdout.on('data', (b: Buffer) => out.push(b));
      child.stderr.on('data', (b: Buffer) => err.push(b));
      child.on('error', (e) => reject(new CliError('CONFIG_ERROR', `secret-tool failed: ${e.message}`)));
      child.on('close', (code) => {
        if (code === 0) {
          resolve({
            stdout: Buffer.concat(out).toString('utf-8'),
            stderr: Buffer.concat(err).toString('utf-8'),
          });
        } else {
          const message = Buffer.concat(err).toString('utf-8') || `exit ${code}`;
          const e: NodeJS.ErrnoException = Object.assign(new Error(message), { code: String(code) });
          reject(e);
        }
      });
      child.stdin.end(stdin ?? '');
    });
  }
}

/* ───────────────────── Dispatch ───────────────────── */

/**
 * Resolve the native keychain backend for the current platform. Throws
 * `CONFIG_ERROR` if the platform isn't supported.
 */
export function createNativeBackend(): SecretsBackend {
  const p = platform();
  if (p === 'win32') return new WindowsKeychainAdapter();
  if (p === 'darwin') return new MacosKeychainAdapter();
  if (p === 'linux') return new LinuxKeychainAdapter();
  throw new CliError('CONFIG_ERROR',
    `Native OS keychain not supported on platform '${p}'. Use ABAP_CLI_KEYCHAIN_BACKEND=keytar to fall back.`);
}
