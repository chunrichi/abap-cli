/**
 * Unit coverage for `abap whoami`: the system-side identity projection, the
 * "old ICF service" error translation, and the command surface (JSON / human
 * output, schema without SAP, exit codes).
 *
 * The command-level tests mock `IcfClient` so no network is touched; the pure
 * projection/renderer functions are exercised directly.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { IcfResponse } from '../../src/abap_cli/clients/icf-client.js';
import type { SystemIdentity } from '../../src/abap_cli/clients/system-identity.js';
import {
  projectWhoami,
  renderWhoami,
  runWhoami,
  type WhoamiClient,
} from '../../src/abap_cli/flows/core/whoami.js';
import type { ProjectConfig } from '../../src/abap_cli/config/project-config.js';
import { CliError } from '../../src/abap_cli/output/json.js';
import { makeProgram, runCommand } from './cli-helper.js';

const getConfigFn = vi.fn();
const getSystemIdentityFn = vi.fn();

vi.mock('../../src/abap_cli/clients/icf-client.js', () => ({
  IcfClient: {
    create: async () => ({ getConfig: getConfigFn, getSystemIdentity: getSystemIdentityFn }),
  },
}));

import { registerWhoamiCommand } from '../../src/abap_cli/commands/whoami.js';

function projectConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    sap: {
      url: 'https://sap.example.com:44300',
      client: '100',
      username: 'DEVELOPER',
      password: 'secret',
      language: 'EN',
      insecure: false,
      caPath: '',
      sourceDir: '/tmp/project',
    },
    transport: 'TRN001',
    package: '$TMP',
    systemName: 'dev',
    configPath: '/tmp/project/.abap.json',
    workspaceRoot: '/tmp/project',
    ...overrides,
  };
}

/** System-side identity as the ICF service reports it. */
function systemIdentity(overrides: Partial<SystemIdentity> = {}): SystemIdentity {
  return {
    user: 'SAP103',
    systemId: 'S4H',
    client: '100',
    applicationServer: 'vhcalhdbdb',
    database: 'HDB',
    os: 'Linux',
    abapRelease: '757',
    ...overrides,
  };
}

function successEnvelope(identity: Partial<SystemIdentity> = {}): IcfResponse<SystemIdentity> {
  return { status: 'success', data: systemIdentity(identity), error: null };
}

function fakeClient(
  response: IcfResponse<SystemIdentity> | Error,
  config = projectConfig(),
): WhoamiClient {
  return {
    getConfig: () => config,
    getSystemIdentity: async () => {
      if (response instanceof Error) throw response;
      return response;
    },
  };
}

function parseEnvelope(text: string): { status: string; data: Record<string, unknown>; error?: Record<string, unknown> } {
  return JSON.parse(text) as { status: string; data: Record<string, unknown>; error?: Record<string, unknown> };
}

describe('projectWhoami / renderWhoami', () => {
  it('projects the system-reported identity plus the connection context', () => {
    const data = projectWhoami(projectConfig(), systemIdentity());
    expect(data).toEqual({
      profile: 'dev',
      url: 'https://sap.example.com:44300',
      system: 'S4H',
      client: '100',
      user: 'SAP103',
      server: {
        applicationServer: 'vhcalhdbdb',
        database: 'HDB',
        os: 'Linux',
        abapRelease: '757',
      },
    });
    expect(renderWhoami(data)).toBe(
      [
        'Connection identity:',
        '  profile:  dev',
        '  system:   S4H client 100',
        '  user:     SAP103',
        '  url:      https://sap.example.com:44300',
        '  server:   HDB · Linux · vhcalhdbdb · ABAP 757',
      ].join('\n'),
    );
  });

  it('omits server facts when the system does not report them', () => {
    const data = projectWhoami(
      projectConfig(),
      systemIdentity({ applicationServer: '', database: '', os: '', abapRelease: '' }),
    );
    expect(data).toEqual({
      profile: 'dev',
      url: 'https://sap.example.com:44300',
      system: 'S4H',
      client: '100',
      user: 'SAP103',
    });
    expect(data.server).toBeUndefined();
    expect(renderWhoami(data)).not.toContain('server:');
  });
});

describe('runWhoami', () => {
  it('returns the identity reported by the ICF service', async () => {
    const result = await runWhoami(fakeClient(successEnvelope()));
    expect(result.data.user).toBe('SAP103');
    expect(result.data.system).toBe('S4H');
    expect(result.human).toContain('Connection identity:');
  });

  it('translates an old service (JSON NOT_FOUND) into an actionable ICF_IDENTITY_UNAVAILABLE error', async () => {
    const oldService = new CliError('NOT_FOUND', 'unknown path: /sap/abap_cli/whoami');
    await expect(runWhoami(fakeClient(oldService))).rejects.toMatchObject({
      code: 'ICF_IDENTITY_UNAVAILABLE',
      nextSteps: expect.arrayContaining([expect.stringContaining('abap deploy --yes')]),
    });
  });

  it('translates a missing SICF node (plain 404 -> SAP_ERROR) into ICF_IDENTITY_UNAVAILABLE', async () => {
    const notDeployed = new CliError('SAP_ERROR', 'Not Found', { details: { httpStatus: 404 } });
    await expect(runWhoami(fakeClient(notDeployed))).rejects.toMatchObject({
      code: 'ICF_IDENTITY_UNAVAILABLE',
    });
  });

  it('propagates authentication failures unchanged', async () => {
    const authFailure = new CliError('AUTH_ERROR', '401 Unauthorized', { details: { httpStatus: 401 } });
    await expect(runWhoami(fakeClient(authFailure))).rejects.toMatchObject({ code: 'AUTH_ERROR' });
  });

  it('propagates real server failures (the route existed but the call failed)', async () => {
    const serverError = new CliError('SAP_ERROR', 'Internal Server Error', { details: { httpStatus: 500 } });
    await expect(runWhoami(fakeClient(serverError))).rejects.toMatchObject({ code: 'SAP_ERROR' });
  });

  it('rejects an error envelope returned with HTTP 200', async () => {
    const envelope: IcfResponse<SystemIdentity> = {
      status: 'error',
      data: null,
      error: { code: 'SAP_ERROR', message: 'boom' },
    };
    await expect(runWhoami(fakeClient(envelope))).rejects.toMatchObject({ code: 'SAP_ERROR' });
  });

  it('rejects an incomplete identity instead of printing half of it', async () => {
    await expect(runWhoami(fakeClient(successEnvelope({ user: '' })))).rejects.toMatchObject({
      code: 'SAP_ERROR',
    });
  });
});

describe('abap whoami command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getConfigFn.mockReset();
    getSystemIdentityFn.mockReset();
    getConfigFn.mockReturnValue(projectConfig());
    getSystemIdentityFn.mockResolvedValue(successEnvelope());
  });

  async function run(args: string[]): Promise<{ stdout: string; stderr: string; exitCode?: number }> {
    const program = makeProgram();
    registerWhoamiCommand(program);
    return runCommand(program, args);
  }

  it('prints the compact JSON identity envelope', async () => {
    const res = await run(['whoami', '--json']);
    expect(res.exitCode).toBeUndefined();
    const envelope = parseEnvelope(res.stdout);
    expect(envelope.status).toBe('success');
    expect(envelope.data).toMatchObject({
      profile: 'dev',
      url: 'https://sap.example.com:44300',
      system: 'S4H',
      client: '100',
      user: 'SAP103',
      server: { database: 'HDB', os: 'Linux', abapRelease: '757' },
    });
    expect(res.stderr).toBe('');
  });

  it('prints the human identity block by default', async () => {
    const res = await run(['whoami']);
    expect(res.exitCode).toBeUndefined();
    expect(res.stdout).toContain('Connection identity:');
    expect(res.stdout).toContain('system:   S4H client 100');
    expect(res.stdout).toContain('user:     SAP103');
    expect(res.stdout).toContain('server:   HDB · Linux · vhcalhdbdb · ABAP 757');
  });

  it('prints its schema without any SAP call', async () => {
    const res = await run(['whoami', '--schema', '--json']);
    expect(res.exitCode).toBeUndefined();
    const envelope = parseEnvelope(res.stdout);
    expect(envelope.data.command).toBe('whoami');
    expect(envelope.data.scope).toBe('sap');
    expect(getSystemIdentityFn).not.toHaveBeenCalled();
  });

  it('surfaces an outdated service as ICF_IDENTITY_UNAVAILABLE (exit 8)', async () => {
    getSystemIdentityFn.mockRejectedValue(new CliError('NOT_FOUND', 'unknown path: /sap/abap_cli/whoami'));
    const res = await run(['whoami', '--json']);
    expect(res.exitCode).toBe(8);
    const envelope = parseEnvelope(res.stderr);
    expect(envelope.status).toBe('error');
    expect(envelope.error?.code).toBe('ICF_IDENTITY_UNAVAILABLE');
  });

  it('surfaces an auth failure as AUTH_ERROR (exit 5)', async () => {
    getSystemIdentityFn.mockRejectedValue(
      new CliError('AUTH_ERROR', '401 Unauthorized', { details: { httpStatus: 401 } }),
    );
    const res = await run(['whoami', '--json']);
    expect(res.exitCode).toBe(5);
    expect(parseEnvelope(res.stderr).error?.code).toBe('AUTH_ERROR');
  });
});
