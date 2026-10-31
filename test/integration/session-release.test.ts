/**
 * Process-level session lifecycle contract.
 *
 * Every CLI invocation that talks to SAP opens a stateful SAP user session.
 * If the process ends without logging out, the session stays in SM04 and the
 * ICM session table fills up — after enough leaks SAP only hands out anonymous
 * contexts and every ADT request fails with `400 Session not found`.
 *
 * These tests spawn the built CLI against an in-process mock SAP and assert
 * the logout request actually leaves the process:
 *  - a failing command releases the session it opened (both policies);
 *  - `profile test` (raw probe clients) opens one session and releases it;
 *  - a successful probe run releases every session it opened.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';

const repoRoot = path.resolve(__dirname, '../..');
const cliEntry = path.join(repoRoot, 'dist/index.js');
const hasBuiltCli = fs.existsSync(cliEntry);

interface MockSap {
  url: string;
  requests: string[];
  close(): Promise<void>;
}

interface MockOptions {
  /** Serve the ADT discovery endpoint (marks the `adt` probe layer ok). */
  discoveryOk?: boolean;
  /** Serve the ICF root (marks the `icf` probe layer ok). */
  icfOk?: boolean;
}

/** Start a minimal SAP stand-in that records every request path. */
async function startMockSap(options: MockOptions = {}): Promise<MockSap> {
  const requests: string[] = [];
  const server = http.createServer((req, res) => {
    const url = req.url ?? '';
    requests.push(`${req.method} ${url}`);
    const xml = (body: string): void => {
      res.writeHead(200, { 'content-type': 'application/xml', 'x-csrf-token': 'TOKEN' });
      res.end(body);
    };
    if (url.startsWith('/sap/bc/adt/compatibility/graph')) {
      res.writeHead(200, {
        'content-type': 'application/xml',
        'x-csrf-token': 'TOKEN',
        'set-cookie': ['SAP_SESSIONID_S4H_100=abc; path=/'],
      });
      res.end('<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core"/>');
      return;
    }
    if (url.startsWith('/sap/public/bc/icf/logoff')) {
      res.writeHead(200, { 'set-cookie': 'SAP_SESSIONID_S4H_100=0; path=/' });
      res.end('');
      return;
    }
    if (options.discoveryOk && url.startsWith('/sap/bc/adt/repository/informationsystem')) {
      xml('<service xmlns:sap="http://www.sap.com/adt" sap-component="S4CORE"><workspace/></service>');
      return;
    }
    if (options.discoveryOk && url.startsWith('/sap/bc/adt/discovery')) {
      xml('<service xmlns:app="http://www.w3.org/2007/app"><workspace/></service>');
      return;
    }
    if (options.icfOk && url.startsWith('/sap/abap_cli/')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"service":"abap_cli","version":"1.0.0"}');
      return;
    }
    res.writeHead(404, { 'content-type': 'application/xml' });
    res.end('<exc:exception xmlns:exc="http://www.sap.com/adt/exceptions/"><exc:message lang="EN">Not found</exc:message></exc:exception>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
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

let tmpHome = '';
let tmpProject = '';

function writeWorkspace(portUrl: string): void {
  fs.writeFileSync(
    path.join(tmpHome, '.abap-cli', 'systems.json'),
    JSON.stringify({
      systems: {
        fake: { url: portUrl, client: '100', username: 'dev', language: 'EN' },
      },
    }),
  );
  fs.writeFileSync(path.join(tmpProject, '.abap.json'), JSON.stringify({ system: 'fake' }));
}

function runCli(args: string[], env: NodeJS.ProcessEnv = {}): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [cliEntry, ...args], {
      cwd: tmpProject,
      env: {
        ...process.env,
        HOME: tmpHome,
        USERPROFILE: tmpHome,
        ABAP_CLI_KEYCHAIN_BACKEND: 'fixture',
        ABAP_CLI_KEYCHAIN_FIXTURE_PASSWORD: 'dummy',
        ...env,
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

const count = (requests: string[], marker: string): number => requests.filter((r) => r.includes(marker)).length;
const logins = (requests: string[]): number => count(requests, '/sap/bc/adt/compatibility/graph');
const logoffs = (requests: string[]): number => count(requests, '/sap/public/bc/icf/logoff');

beforeAll(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'abap-session-home-'));
  tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'abap-session-proj-'));
  fs.mkdirSync(path.join(tmpHome, '.abap-cli'), { recursive: true });
});

afterAll(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
  fs.rmSync(tmpProject, { recursive: true, force: true });
});

describe.skipIf(!hasBuiltCli)('session release at process level', () => {
  it('releases the session of a failed command under always-logout', async () => {
    const mock = await startMockSap();
    try {
      writeWorkspace(mock.url);
      const result = await runCli(['inspect', 'ZZZ', '--json'], { ABAP_CLI_SESSION_POLICY: 'always-logout' });
      expect(result.exit).not.toBe(0);
      expect(logins(mock.requests)).toBe(1);
      expect(logoffs(mock.requests)).toBe(1);
    } finally {
      await mock.close();
    }
  });

  it('releases the session a failed command could not persist under reuse', async () => {
    const mock = await startMockSap();
    try {
      writeWorkspace(mock.url);
      // fixture keychain is ephemeral → reuse is disabled for this run, so the
      // fresh login cannot be handed to the next command and must be released.
      const result = await runCli(['inspect', 'ZZZ', '--json'], { ABAP_CLI_SESSION_POLICY: 'reuse' });
      expect(result.exit).not.toBe(0);
      expect(logins(mock.requests)).toBe(1);
      expect(logoffs(mock.requests)).toBe(1);
    } finally {
      await mock.close();
    }
  });

  it('profile test opens exactly one SAP session and releases it', async () => {
    const mock = await startMockSap();
    try {
      writeWorkspace(mock.url);
      const result = await runCli(['profile', 'test', 'fake', '--json']);
      // adt/icf layers report degraded — the exit code carries that, but the
      // session lifecycle must stay clean regardless.
      expect(result.exit).not.toBe(0);
      expect(logins(mock.requests)).toBe(1);
      expect(logoffs(mock.requests)).toBe(1);
    } finally {
      await mock.close();
    }
  });

  it('profile test releases every session it opens on a fully reachable system', async () => {
    const mock = await startMockSap({ discoveryOk: true, icfOk: true });
    try {
      writeWorkspace(mock.url);
      const result = await runCli(['profile', 'test', 'fake', '--json']);
      expect(result.exit).toBe(0);
      // probe session + runtime-cache probe session; both must be released.
      expect(logins(mock.requests)).toBeGreaterThanOrEqual(2);
      expect(logoffs(mock.requests)).toBe(logins(mock.requests));
    } finally {
      await mock.close();
    }
  });
});
