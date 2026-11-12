/**
 * Process-level session lifecycle contract (issue #70):
 *
 *  1. **Cross-command reuse must actually join the SAP session.** On S/4HANA a
 *     replayed `SAP_SESSIONID_*` without its `sap-contextid` is silently routed
 *     into a new session (HTTP 200, no error) — the mock below models exactly
 *     that: it only reuses a request when both cookies match, otherwise it
 *     creates a session. A regression therefore shows up as `created > 1`.
 *  2. **No durable store ⇒ no leak.** When neither HOME nor the workspace is
 *     writable, every command must log in AND log out (one login + one logoff
 *     per command), never leave the session open.
 *  3. **Repeated rejection pauses reuse** instead of leaking: after two
 *     consecutive 401s the next commands run per-command (login + logout) until
 *     the pause expires or `session reset` clears the jar.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';

const repoRoot = path.resolve(__dirname, '../..');
const cliEntry = path.join(repoRoot, 'dist/index.js');
const hasBuiltCli = fs.existsSync(cliEntry);

interface MockSession {
  sid: string;
  context: string;
}

interface MockSap {
  url: string;
  logins: number;
  /** ADT close-session calls (`GET /sap/bc/adt/core/http/sessions`). */
  closes: number;
  /** Legacy ICF logoff calls; the close exchange must make these unnecessary. */
  logoffs: number;
  /** Sessions created by SAP (login or a context-less request). */
  created: number;
  sessions: Map<string, MockSession>;
  /** Drop every SAP-side session, so the next replay is a stale session. */
  invalidateAll(): void;
  close(): Promise<void>;
}

/** Parse a `Cookie` header into a name→value map. */
function parseCookies(header: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) out.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
  }
  return out;
}

/** Start a minimal SAP stand-in that tracks stateful HTTP sessions. */
async function startMockSap(): Promise<MockSap> {
  let counter = 0;
  const sessions = new Map<string, MockSession>();
  const state = { logins: 0, closes: 0, logoffs: 0, created: 0 };

  function issueSession(res: http.ServerResponse): void {
    counter += 1;
    const session: MockSession = { sid: `sid${counter}`, context: `ctx${counter}` };
    sessions.set(session.sid, session);
    state.created += 1;
    res.setHeader('x-csrf-token', `TOKEN-${session.sid}`);
    res.setHeader('set-cookie', [
      `SAP_SESSIONID_S4H_100=${session.sid}; Path=/; HttpOnly`,
      `sap-contextid=SID%3aANON%3ahost%3a${session.context}-ATT; Path=/sap/bc/adt`,
      'sap-usercontext=sap-client=100; Path=/',
    ]);
  }

  function sessionOf(req: http.IncomingMessage): MockSession | undefined {
    const cookies = parseCookies(req.headers.cookie);
    const sid = [...cookies.keys()].find((n) => /^SAP_SESSIONID_/i.test(n));
    const session = sid ? sessions.get(cookies.get(sid)!) : undefined;
    if (!session) return undefined;
    const expectedContext = `SID%3aANON%3ahost%3a${session.context}-ATT`;
    return cookies.get('sap-contextid') === expectedContext ? session : undefined;
  }

  const server = http.createServer((req, res) => {
    const url = req.url ?? '';
    if (url.startsWith('/sap/bc/adt/compatibility/graph')) {
      state.logins += 1;
      issueSession(res);
      res.writeHead(200, { 'content-type': 'application/xml' });
      res.end('<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core"/>');
      return;
    }
    const dropSession = (): void => {
      const cookies = parseCookies(req.headers.cookie);
      const sid = [...cookies.keys()].find((n) => /^SAP_SESSIONID_/i.test(n));
      const session = sid ? sessions.get(cookies.get(sid)!) : undefined;
      if (session) sessions.delete(session.sid);
    };
    if (url.startsWith('/sap/bc/adt/core/http/sessions')) {
      state.closes += 1;
      dropSession();
      res.writeHead(200, {
        'content-type': 'text/plain',
        'set-cookie': 'sap-contextid=0; Path=/sap/bc/adt',
      });
      res.end('');
      return;
    }
    if (url.startsWith('/sap/public/bc/icf/logoff')) {
      state.logoffs += 1;
      dropSession();
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('');
      return;
    }
    const session = sessionOf(req);
    const cookies = parseCookies(req.headers.cookie);
    const presentsSession = [...cookies.keys()].some((n) => /^SAP_SESSIONID_/i.test(n));
    if (!session && presentsSession) {
      // Stale session: SAP rejects the replay; the CLI must re-login once.
      res.writeHead(401, { 'content-type': 'text/html' });
      res.end('<html><body>Logon failed</body></html>');
      return;
    }
    if (!session) {
      // S/4HANA behaviour: a context-less fresh request opens a NEW session
      // and answers 200 — this is the silent leak the redesign removes.
      issueSession(res);
    }
    res.writeHead(200, { 'content-type': 'application/xml' });
    res.end('<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core"/>');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    get logins() {
      return state.logins;
    },
    get closes() {
      return state.closes;
    },
    get logoffs() {
      return state.logoffs;
    },
    get created() {
      return state.created;
    },
    sessions,
    invalidateAll() {
      sessions.clear();
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

interface SpawnResult {
  stdout: string;
  stderr: string;
  exit: number;
}

interface Sandbox {
  home: string;
  project: string;
  tmp: string;
  readOnly: boolean;
}

/** Create an isolated HOME + workspace bound to the mock SAP. */
function createSandbox(mock: MockSap, opts: { readOnly?: boolean } = {}): Sandbox {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'abap-session-it-'));
  const home = path.join(root, 'home');
  const project = path.join(root, 'project');
  const tmp = path.join(root, 'tmp');
  fs.mkdirSync(path.join(home, '.abap-cli'), { recursive: true });
  fs.mkdirSync(project, { recursive: true });
  fs.mkdirSync(tmp, { recursive: true });
  fs.writeFileSync(
    path.join(home, '.abap-cli', 'systems.json'),
    JSON.stringify({ systems: { fake: { url: mock.url, client: '100', username: 'dev', language: 'EN' } } }),
  );
  fs.writeFileSync(path.join(project, '.abap.json'), JSON.stringify({ system: 'fake', transport: '', package: '$TMP' }));
  if (opts.readOnly) {
    // HOME readable but not writable: forces the workspace store candidate…
    fs.chmodSync(path.join(home, '.abap-cli'), 0o555);
    // …and make the workspace read-only too, so no durable store exists.
    fs.chmodSync(project, 0o555);
  }
  return { home, project, tmp, readOnly: opts.readOnly ?? false };
}

function runCli(sandbox: Sandbox, args: string[]): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [cliEntry, ...args], {
      cwd: sandbox.project,
      env: {
        ...process.env,
        HOME: sandbox.home,
        USERPROFILE: sandbox.home,
        TMPDIR: sandbox.tmp,
        // Password comes from the fixture backend; the session key is forced to
        // the deterministic durable derived key so reuse is enabled in CI.
        ABAP_CLI_KEYCHAIN_BACKEND: 'fixture',
        ABAP_CLI_KEYCHAIN_FIXTURE_PASSWORD: 'dummy',
        ABAP_CLI_SESSION_KEY_MODE: 'derived',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (c: Buffer) => {
      stdout += c.toString();
    });
    proc.stderr.on('data', (c: Buffer) => {
      stderr += c.toString();
    });
    proc.on('close', (exit) => resolve({ stdout, stderr, exit: exit ?? -1 }));
    proc.on('error', reject);
  });
}

const SEARCH = ['search', 'ZCL_DEMO_PROBE', '--type', 'CLAS', '--exact', '--json'];

const sandboxes: Sandbox[] = [];
afterEach(() => {
  for (const sandbox of sandboxes.splice(0)) {
    for (const dir of [path.join(sandbox.home, '.abap-cli'), sandbox.home, sandbox.project]) {
      try {
        fs.chmodSync(dir, 0o755);
      } catch {
        // best effort cleanup
      }
    }
    fs.rmSync(path.dirname(sandbox.home), { recursive: true, force: true });
  }
});

describe.skipIf(!hasBuiltCli)('session reuse across CLI processes', () => {
  it('reuses one SAP session across commands (context cookie intact)', async () => {
    const mock = await startMockSap();
    const sandbox = createSandbox(mock);
    sandboxes.push(sandbox);
    try {
      for (let i = 0; i < 3; i += 1) {
        const result = await runCli(sandbox, SEARCH);
        expect(result.exit).toBe(0);
      }
      // Login once; every later command must join that session (a replayed
      // session without sap-contextid would create one session per command).
      expect(mock.logins).toBe(1);
      expect(mock.created).toBe(1);
      expect(mock.closes).toBe(0);
      expect(mock.logoffs).toBe(0);
      expect(mock.sessions.size).toBe(1);
    } finally {
      await mock.close();
    }
  });

  it('runs login + logout per command when no durable store exists', async () => {
    const mock = await startMockSap();
    const sandbox = createSandbox(mock, { readOnly: true });
    sandboxes.push(sandbox);
    try {
      for (let i = 0; i < 3; i += 1) {
        const result = await runCli(sandbox, SEARCH);
        expect(result.exit).toBe(0);
      }
      // No session may outlive its command; the ADT close exchange replaces logoff.
      expect(mock.logins).toBe(3);
      expect(mock.closes).toBe(3);
      expect(mock.logoffs).toBe(0);
      expect(mock.created).toBe(3);
      expect(mock.sessions.size).toBe(0);
    } finally {
      await mock.close();
    }
  });

  it('pauses reuse after repeated rejections instead of leaking sessions', async () => {
    const mock = await startMockSap();
    const sandbox = createSandbox(mock);
    sandboxes.push(sandbox);
    try {
      // Command 1: fresh login, session persisted.
      expect((await runCli(sandbox, SEARCH)).exit).toBe(0);
      expect(mock.logins).toBe(1);

      // Command 2: SAP dropped the session → 401 → one re-login is allowed.
      mock.invalidateAll();
      expect((await runCli(sandbox, SEARCH)).exit).toBe(0);
      expect(mock.logins).toBe(2);
      expect(mock.sessions.size).toBe(1);

      // Command 3: dropped again → failure limit crossed → release at end.
      mock.invalidateAll();
      expect((await runCli(sandbox, SEARCH)).exit).toBe(0);
      expect(mock.logins).toBe(3);
      expect(mock.closes).toBe(1);
      expect(mock.logoffs).toBe(0);
      expect(mock.sessions.size).toBe(0);

      // Command 4: paused → fresh, released session.
      mock.invalidateAll();
      expect((await runCli(sandbox, SEARCH)).exit).toBe(0);
      expect(mock.logins).toBe(4);
      expect(mock.closes).toBe(2);
      expect(mock.logoffs).toBe(0);
      expect(mock.sessions.size).toBe(0);
    } finally {
      await mock.close();
    }
  });

  it('abap session reset clears a paused jar so reuse is retried', async () => {
    const mock = await startMockSap();
    const sandbox = createSandbox(mock);
    sandboxes.push(sandbox);
    try {
      // Drive the jar into the paused state.
      for (let i = 0; i < 3; i += 1) {
        mock.invalidateAll();
        expect((await runCli(sandbox, SEARCH)).exit).toBe(0);
      }
      const before = mock.logins;
      const reset = await runCli(sandbox, ['session', 'reset', '--yes', '--json']);
      expect(reset.exit).toBe(0);
      expect(reset.stdout).toContain('"removed"');
      // After the reset the next command persists a fresh reusable session.
      const next = await runCli(sandbox, SEARCH);
      expect(next.exit).toBe(0);
      expect(mock.logins).toBe(before + 1);
      expect(mock.sessions.size).toBe(1);
    } finally {
      await mock.close();
    }
  });
});
