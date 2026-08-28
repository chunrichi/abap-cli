import { describe, expect, it, vi } from 'vitest';

const prompts: Array<{ kind: string; message?: string }> = [];

vi.mock('@clack/prompts', () => ({
  // Record every prompt call so the test can assert order. Default answers
  // are chosen so the flow completes without side effects.
  text: async (opts: { message: string }) => {
    prompts.push({ kind: 'text', message: opts.message });
    return '';
  },
  password: async (opts: { message: string }) => {
    prompts.push({ kind: 'password', message: opts.message });
    return '';
  },
  confirm: async (opts: { message: string }) => {
    prompts.push({ kind: 'confirm', message: opts.message });
    return false;
  },
  select: async (opts: { message: string }) => {
    prompts.push({ kind: 'select', message: opts.message });
    return '__new__';
  },
  isCancel: (v: unknown) => v === Symbol.for('clack-cancel'),
}));

// Keep keychain & profile storage inert.
vi.mock('../../src/abap_cli/config/secrets.js', () => ({
  getPassword: vi.fn().mockResolvedValue(null),
  storePassword: vi.fn().mockResolvedValue(''),
  deletePassword: vi.fn().mockResolvedValue(true),
  storeCertPassphrase: vi.fn().mockResolvedValue(''),
}));

vi.mock('../../src/abap_cli/config/user-config.js', () => ({
  getSystem: () => null,
  listSystemNames: () => [],
  upsertSystem: vi.fn(),
  deleteSystem: vi.fn(),
  loadUserConfig: () => ({ systems: {} }),
  saveUserConfig: vi.fn(),
}));

vi.mock('../../src/abap_cli/icf/service-version.js', () => ({
  checkIcfDeployment: vi.fn().mockResolvedValue({ status: 'not_deployed', expectedVersion: '0.1.0' }),
  ICF_SERVICE_VERSION: '0.1.0',
}));

// saveProfile() triggers an informational textpool capability probe — mock
// it so the wizard can complete end-to-end without HTTP.
vi.mock('../../src/abap_cli/textpool/textpool-capability.js', () => ({
  probeTextpoolCapability: vi.fn().mockResolvedValue({ adtTextpool: false }),
  recordCapability: vi.fn().mockResolvedValue(''),
}));

import { runInitWizard } from '../../src/abap_cli/flows/init-flow.js';

describe('abap init wizard — new-system prompt order', () => {
  it('asks for identity fields (URL/Client/Username/Language) before credentials (insecure/CA/password)', async () => {
    prompts.length = 0;
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    try {
      try {
        await runInitWizard({}, '');
      } catch {
        // wizard may error on validate (empty URL by mock default); we only
        // care about prompt ordering, not completion.
      }
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
    }

    const orderedMessages = prompts
      .filter((p) => p.kind === 'text' || p.kind === 'password' || p.kind === 'confirm')
      .map((p) => p.message ?? '');

    // First text prompt is system-name (selectSystem always picks '__new__' so
    // the wizard then asks for the profile name, then URL/Client/Username/Language).
    const idxUrl = orderedMessages.indexOf('SAP URL');
    const idxClient = orderedMessages.indexOf('Client');
    const idxUsername = orderedMessages.indexOf('Username');
    const idxLanguage = orderedMessages.indexOf('Language');
    const idxInsecure = orderedMessages.indexOf('Skip SSL certificate verification? (development only)');
    const idxPassword = orderedMessages.indexOf('Password (stored in OS keychain)');

    expect(idxUrl).toBeGreaterThanOrEqual(0);
    expect(idxClient).toBeGreaterThan(idxUrl);
    expect(idxUsername).toBeGreaterThan(idxClient);
    expect(idxLanguage).toBeGreaterThan(idxUsername);
    expect(idxInsecure).toBeGreaterThan(idxLanguage);
    expect(idxPassword).toBeGreaterThan(idxInsecure);
  });
});
