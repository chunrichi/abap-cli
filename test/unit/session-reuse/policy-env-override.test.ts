/**
 * SessionPolicy resolution (SC-007 c) + cloud/BTP opt-out.
 *
 * Precedence:
 *   1. ABAP_CLI_SESSION_POLICY env var (reuse / always-logout) — wins.
 *   2. SapConfig.sessionPolicy (.abap.json or profile) — reuse | always-logout | default
 *   3. default → reuse
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectivePolicy, isCloudOrBtpProfile, isUnsupportedInContext, resolveSessionPolicy, SESSION_POLICY_ENV } from '../../../src/abap_cli/session/policy.js';
import type { ProjectConfig, SapConfig } from '../../../src/abap_cli/config/project-config.js';

function config(overrides: { sessionPolicy?: SapConfig['sessionPolicy']; systemType?: SapConfig['systemType'] } = {}): ProjectConfig {
  return {
    sap: {
      url: 'http://vhcala4hci:50000',
      client: '001',
      username: 'DEVELOPER',
      password: 'x',
      language: 'EN',
      insecure: true,
      caPath: '',
      auth: { method: 'basic' },
      sourceDir: '.',
      sessionPolicy: overrides.sessionPolicy,
      systemType: overrides.systemType,
    },
    transport: '',
    package: '',
    systemName: 'vhcala4hci',
  };
}

const ENV = SESSION_POLICY_ENV;
const originalEnv = process.env[ENV];

beforeEach(() => {
  delete process.env[ENV];
  vi.stubGlobal('process', { ...process, stderr: { write: vi.fn() } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalEnv === undefined) delete process.env[ENV];
  else process.env[ENV] = originalEnv;
});

describe('resolveSessionPolicy', () => {
  it('returns default when no env var and no profile field', () => {
    expect(resolveSessionPolicy(config())).toBe('default');
  });

  it('reads sap.sessionPolicy=always-logout from the profile', () => {
    expect(resolveSessionPolicy(config({ sessionPolicy: 'always-logout' }))).toBe('always-logout');
  });

  it('reads sap.sessionPolicy=reuse from the profile', () => {
    expect(resolveSessionPolicy(config({ sessionPolicy: 'reuse' }))).toBe('reuse');
  });

  it('env var ABAP_CLI_SESSION_POLICY=always-logout overrides profile reuse', () => {
    process.env[ENV] = 'always-logout';
    expect(resolveSessionPolicy(config({ sessionPolicy: 'reuse' }))).toBe('always-logout');
  });

  it('env var ABAP_CLI_SESSION_POLICY=reuse overrides profile always-logout', () => {
    process.env[ENV] = 'reuse';
    expect(resolveSessionPolicy(config({ sessionPolicy: 'always-logout' }))).toBe('reuse');
  });

  it('ignores an invalid env var value and falls back to profile', () => {
    process.env[ENV] = 'bogus';
    expect(resolveSessionPolicy(config({ sessionPolicy: 'always-logout' }))).toBe('always-logout');
  });

  it('ignores an invalid profile value and returns default', () => {
    const cfg = config();
    (cfg.sap as { sessionPolicy?: unknown }).sessionPolicy = 'bogus';
    expect(resolveSessionPolicy(cfg)).toBe('default');
  });
});

describe('effectivePolicy', () => {
  it("maps 'default' to reuse", () => {
    expect(effectivePolicy('default')).toBe('reuse');
  });

  it("keeps 'always-logout'", () => {
    expect(effectivePolicy('always-logout')).toBe('always-logout');
  });

  it("keeps 'reuse'", () => {
    expect(effectivePolicy('reuse')).toBe('reuse');
  });
});

describe('isCloudOrBtpProfile / isUnsupportedInContext', () => {
  it.each([
    ['on-prem', false],
    ['mock', false],
    ['cloud', true],
    ['btp', true],
  ] as const)('systemType=%s → %s', (systemType, expected) => {
    expect(isCloudOrBtpProfile(config({ systemType }).sap)).toBe(expected);
  });

  it('treats an absent systemType as supported (on-prem default)', () => {
    expect(isUnsupportedInContext(config())).toBe(false);
  });
});
