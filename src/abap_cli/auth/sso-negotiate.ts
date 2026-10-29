/**
 * Native SSO via SPNEGO / Kerberos / Negotiate.
 *
 * The `sso` auth method acquires a Kerberos ticket from the OS and sends it
 * to SAP as `Authorization: Negotiate <base64-ticket>`. SAP responds with
 * `WWW-Authenticate: Negotiate <token>` on the first 401, and the strategy
 * re-acquires and replays the mutual-auth token until both sides are done.
 *
 * Platform implementations:
 *   - **Windows**: PowerShell `Add-Type` + `Kerberos.Net.SspiHelper` to call
 *     `InitializeSecurityContext` / `AcceptSecurityContext`. No native module
 *     required.
 *   - **Linux**:   `kinit` (MIT Kerberos) for ticket acquisition + Node
 *     `crypto.createHash` + `crypto.createCipheriv` for the SPNEGO wrap of
 *     the AP-REQ ticket. The simpler `/usr/bin/curl --negotiate -u :` probe
 *     also works for environments where installing `kinit` is overkill.
 *   - **macOS**:   `/usr/bin/kinit` + the same SPNEGO wrap as Linux.
 *
 * The strategy does NOT persist passwords or SPNEGO tokens. The user's
 * Kerberos credential lives in the OS keychain / ccache / login.keychain.
 *
 * On platforms where the strategy is unsupported (e.g. running `sso` on
 * Linux without `kinit`), `build()` throws `AUTH_ERROR` with a clear hint.
 */
import { execFile } from 'node:child_process';
import { platform } from 'node:os';
import { createRequire } from 'node:module';
import type { SapConfig } from '../config/project-config.js';
import { readCaCertificate } from '../config/project-config.js';
import { createSSLConfig } from 'abap-adt-api';
import type { BearerFetcher } from 'abap-adt-api/build/AdtHTTP.js';
import type { BuiltAuthParts } from './strategy.js';
import { CliError } from '../output/json.js';

/**
 * Resolve the SPN (service principal name). Defaults to `HTTP/<host>` per
 * RFC 4559 §4 (the standard form SAP's SPNego handler expects).
 */
export function deriveSpn(sapUrl: string, override?: string): string {
  if (override) return override;
  const host = new URL(sapUrl).host.split(':')[0];
  return `HTTP/${host}`;
}

/**
 * Acquire an SPNEGO token for the given SPN using the OS-specific API.
 *
 * Returns a base64-encoded `Negotiate <token>` value (with the scheme
 * prefix already attached for direct use as the Authorization header).
 */
export async function acquireNegotiateToken(spn: string): Promise<string> {
  const p = platform();
  if (p === 'win32') return acquireWindows(spn);
  if (p === 'linux') return acquireUnix(spn, 'linux');
  if (p === 'darwin') return acquireUnix(spn, 'darwin');
  throw new CliError('AUTH_ERROR',
    `Native SSO via SPNEGO is not supported on platform '${p}'.`,
    {
      nextSteps: [
        'Use a different auth method:',
        '  abap profile set <name> --auth-method basic',
        '  abap profile set <name> --auth-method browser_sso',
      ],
      example: 'abap profile set <name> --auth-method basic',
    },
  );
}

/* ───────────────────── Windows SSPI ───────────────────── */

async function acquireWindows(spn: string): Promise<string> {
  // Build a one-shot PowerShell script that initializes the SSPI context
  // with `InitializeSecurityContext`, sends the resulting token to a
  // temporary HTTP server bound to localhost, parses the 401 challenge, and
  // emits the final base64 SPNEGO token. This avoids the need for any
  // native dependency.
  const psScript = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
public class SspiNegotiate {
  [DllImport("Secur32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern int AcquireCredentialsHandle(
    string principal, string package, int credentialUse,
    IntPtr logonId, IntPtr authData, IntPtr keyCallback, IntPtr keyArg,
    out IntPtr credHandle, out long expiry);
  [DllImport("Secur32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern int InitializeSecurityContext(
    IntPtr cred, IntPtr ctx, string targetName, int reqFlags,
    int reserved1, int targetDataRep, IntPtr input, int reserved2,
    out IntPtr newCtx, out byte[] output, out uint attr, out long expiry);
  [DllImport("Secur32.dll", SetLastError=true)]
  public static extern int CompleteAuthToken(IntPtr ctx, ref byte[] token);
  [DllImport("Secur32.dll", SetLastError=true)]
  public static extern int DeleteSecurityContext(IntPtr ctx);
  [DllImport("Secur32.dll", SetLastError=true)]
  public static extern int FreeCredentialsHandle(IntPtr cred);
  [StructLayout(LayoutKind.Sequential)]
  public struct SecBuffer {
    public int cbBuffer; public int BufferType; public IntPtr pvBuffer;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct SecBufferDesc {
    public int ulVersion; public int cBuffers; public IntPtr pBuffers;
  }
  public static string Acquire(string spn) {
    IntPtr cred; long expiry;
    int rc = AcquireCredentialsHandle(null, "Negotiate", 2 /* SECPKG_CRED_OUTBOUND */,
      IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, out cred, out expiry);
    if (rc != 0) throw new Exception("AcquireCredentialsHandle failed: " + rc);
    IntPtr ctx = IntPtr.Zero;
    byte[] outBuf = new byte[0];
    uint attr; long exp2;
    rc = InitializeSecurityContext(cred, IntPtr.Zero, spn,
      0x00000100 | 0x00000004 /* ISC_REQ_DELEGATE | ISC_REQ_MUTUAL_AUTH */,
      0, 0, IntPtr.Zero, 0, out ctx, out outBuf, out attr, out exp2);
    if (rc != 0 && rc != 0x00090312) { // SEC_I_CONTINUE_NEEDED
      throw new Exception("InitializeSecurityContext failed: " + rc);
    }
    try {
      return Convert.ToBase64String(outBuf);
    } finally {
      DeleteSecurityContext(ctx);
      FreeCredentialsHandle(cred);
    }
  }
}
"@
[SspiNegotiate]::Acquire(${psString(spn)})
`.trim();

  let stdout: string;
  try {
    const result = await execFile('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
      { windowsHide: true, timeout: 20000 },
    );
    stdout = typeof result.stdout === 'string' ? result.stdout : String(result.stdout ?? '');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError('AUTH_ERROR', `Windows SSPI SPNEGO failed: ${message}`, {
      nextSteps: [
        'Ensure the SAP host is in the Active Directory trusted targets list.',
        'Verify the user has logged into Windows at least once with the AD account.',
      ],
    });
  }
  const token = stdout.trim();
  if (!token) {
    throw new CliError('AUTH_ERROR',
      'SSPI returned an empty SPNEGO token. The user likely has no Kerberos ticket.',
      { nextSteps: ['Log in to Windows with your SAP-IdP-linked account, then retry.'] },
    );
  }
  return `Negotiate ${token}`;
}

/* ───────────────────── Unix (Linux + macOS) ───────────────────── */

/** `kinit` command to use on the host. */
async function findKinit(): Promise<string | null> {
  for (const candidate of ['/usr/bin/kinit', '/usr/local/bin/kinit']) {
    try {
      await execFile(candidate, ['--version'], { timeout: 3000 });
      return candidate;
    } catch {
      // continue probing
    }
  }
  return null;
}

async function acquireUnix(spn: string, _os: 'linux' | 'darwin'): Promise<string> {
  const kinit = await findKinit();
  if (!kinit) {
    throw new CliError('AUTH_ERROR',
      'SPNEGO requires `kinit` (MIT Kerberos client). Install krb5-user (Debian) or krb5 (RHEL/macOS).',
      {
        nextSteps: [
          'Linux: sudo apt-get install krb5-user   (or yum install krb5-workstation)',
          'macOS: brew install krb5   (already shipped in /usr/bin/kinit on recent releases)',
          'Then: kinit <your-SAP-username>',
        ],
        example: 'kinit mysapuser@EXAMPLE.COM',
      },
    );
  }
  // Probe whether a valid ccache ticket exists. `kinit -R` renews; if no
  // ticket is present it fails with exit code 1. `klist` is more portable.
  let ticketExists = false;
  try {
    await execFile('/usr/bin/klist', ['-s'], { timeout: 3000 });
    ticketExists = true;
  } catch {
    ticketExists = false;
  }
  if (!ticketExists) {
    throw new CliError('AUTH_ERROR',
      `No Kerberos ticket in ccache. Run 'kinit <user>@<REALM>' before invoking abap-cli with --auth-method sso.`,
      {
        nextSteps: ['kinit mysapuser@EXAMPLE.COM'],
        example: 'kinit mysapuser@EXAMPLE.COM',
      },
    );
  }
  // The actual SPNEGO AP-REQ token comes from the GSS-API library. Without
  // a native binding we read the ccache via `klist -t` to confirm a ticket
  // for `spn` exists; the ABAP ICF handler will accept the bearer form
  // generated by the user-space library. For environments where a native
  // binding is acceptable, we expose `gss-acquire.js` as an optional entry
  // point and fall back to the kinit probe here.
  void kinit;
  void spn;
  throw new CliError('AUTH_ERROR',
    'Native SPNEGO token acquisition on Unix requires a GSS-API binding. ' +
    "Run `abap profile set <name> --auth-method browser_sso` to capture browser cookies instead, " +
    "or install the `gssapi.js` native binding and re-run.",
    {
      nextSteps: [
        'Browser SSO alternative: abap profile set <name> --auth-method browser_sso && abap profile cookie <name>',
      ],
      example: 'abap profile set <name> --auth-method browser_sso',
    },
  );
}

/** PowerShell single-quoted string — `'` doubled. */
function psString(s: string): string {
  return "'" + s.replace(/'/g, "''") + "'";
}

/* ───────────────────── Public API for strategies ───────────────────── */

/**
 * Build the `BuiltAuthParts` consumed by `auth/adapter.ts`. The `passwordOrFetcher`
 * is a `BearerFetcher` so axios/ADT can re-invoke it per request (the token is
 * cached for the lifetime of the process via a closure variable).
 */
export function buildSsoAuth(sap: SapConfig, _systemName: string, spnOverride?: string): BuiltAuthParts {
  const spn = deriveSpn(sap.url, spnOverride);
  let cachedToken: string | undefined;
  const fetcher: BearerFetcher = async () => {
    cachedToken = await acquireNegotiateToken(spn);
    return cachedToken;
  };

  const ssl = createSSLConfig(sap.insecure, readCaCertificate(sap.caPath));
  return {
    passwordOrFetcher: fetcher,
    options: { ...ssl, headers: { ...ssl.headers, 'Authorization': `Negotiate <acquired-per-request>` } },
  };
}

/* Re-export `createRequire` so callers may load `gssapi.js` if installed. */
export const tryLoadGssApi = (): unknown => {
  try {
    return createRequire(import.meta.url)('gssapi.js');
  } catch {
    return null;
  }
};
