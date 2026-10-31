/**
 * textpool capability probe persistence + mixed-mode router.
 * The capability is recorded once at connect/init time (Q1: one-shot, reuse),
 * and the router reads the cached SystemProfile result with NO runtime fallback.
 *
 * The probe is profile-targeted: it must never borrow the current workspace's
 * connection (that was the old bug — `profile add` probed the workspace system).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  probeTextpoolCapability,
  recordCapability,
  readCapability,
  type TextpoolCapability,
} from '../../src/abap_cli/clients/textpool-capability.js';
import { routeTextpool } from '../../src/abap_cli/clients/textpool-router.js';

// --- seams: raw session + text-element HTTP calls ---
const adtGetTextElements = vi.fn();
const adtSetTextElements = vi.fn();
const withRawAdtSession = vi.fn();
const getSystem = vi.fn();
const upsertSystem = vi.fn();

vi.mock('../../src/abap_cli/clients/raw-adt-session.js', () => ({
  withRawAdtSession: (...args: unknown[]) => withRawAdtSession(...args),
}));

vi.mock('../../src/abap_cli/clients/basic-auth.js', () => ({
  buildBasicAuth: () => ({ password: 'pw', options: {} }),
}));

vi.mock('../../src/abap_cli/config/secrets.js', () => ({
  getPassword: vi.fn(async () => 'pw'),
}));

vi.mock('abap-adt-api/build/api/textelements.js', () => ({
  getTextElements: (...args: unknown[]) => adtGetTextElements(...args),
  setTextElements: (...args: unknown[]) => adtSetTextElements(...args),
  textElementsUrl: (type: string, name: string) => `/sap/bc/adt/textelements/${type.toLowerCase()}/${name}`,
}));

vi.mock('../../src/abap_cli/config/user-config.js', () => ({
  getSystem: (...a: unknown[]) => getSystem(...a),
  upsertSystem: (...a: unknown[]) => upsertSystem(...a),
}));

const validCap: TextpoolCapability = { read: true, write: true, checkedAt: '2026-08-06T00:00:00Z' };
const profile = { url: 'https://sap.example:44300', client: '100', username: 'DEV', language: 'EN' };

/** Let withRawAdtSession run its callback against a fake client. */
function resolveSession(): void {
  withRawAdtSession.mockImplementation(async (_config: unknown, fn: (client: unknown) => Promise<unknown>) =>
    fn({ httpClient: {} }),
  );
}

describe('textpool-capability (profile-targeted probe + persist)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveSession();
    getSystem.mockReturnValue(profile);
  });

  it('detects write support when setTextElements succeeds', async () => {
    adtGetTextElements.mockResolvedValue({ textElements: [] });
    adtSetTextElements.mockResolvedValue(undefined);
    const cap = await probeTextpoolCapability('DEV');
    expect(cap.reached).toBe(true);
    expect(cap.write).toBe(true);
    expect(cap.read).toBe(true);
  });

  it('detects write unsupported (ECC) when setTextElements throws a not-supported error', async () => {
    adtGetTextElements.mockResolvedValue({ textElements: [] });
    adtSetTextElements.mockRejectedValue(new Error('Endpoint not supported'));
    const cap = await probeTextpoolCapability('DEV');
    expect(cap.reached).toBe(true);
    expect(cap.write).toBe(false);
    expect(cap.read).toBe(true);
  });

  it('never throws on probe failure — reached=false so callers do not persist a false verdict', async () => {
    withRawAdtSession.mockRejectedValue(new Error('network'));
    const cap = await probeTextpoolCapability('DEV');
    expect(cap.reached).toBe(false);
    expect(cap.write).toBe(false);
    expect(cap.read).toBe(false);
  });

  it('does not probe an unknown profile', async () => {
    getSystem.mockReturnValue(null);
    const cap = await probeTextpoolCapability('missing');
    expect(cap.reached).toBe(false);
    expect(withRawAdtSession).not.toHaveBeenCalled();
  });

  it('recordCapability persists to SystemProfile (systemVersion + adtTextpool)', async () => {
    await recordCapability('mock', { ...validCap, systemVersion: 'ECC 7.40' });
    expect(upsertSystem).toHaveBeenCalledWith(
      'mock',
      expect.objectContaining({
        systemVersion: 'ECC 7.40',
        adtTextpool: expect.objectContaining({ read: true, write: true }),
      }),
    );
  });

  it('readCapability returns the recorded value and undefined when absent', () => {
    getSystem.mockReturnValue({ ...profile, adtTextpool: validCap });
    expect(readCapability('mock')).toEqual(validCap);
    getSystem.mockReturnValue({ ...profile });
    expect(readCapability('mock')).toBeUndefined();
  });
});

describe('textpool-router (read cache, no runtime fallback)', () => {
  it('routes writes to ADT when cached write=true', () => {
    getSystem.mockReturnValue({ ...profile, adtTextpool: { read: true, write: true } });
    expect(routeTextpool('mock', 'write')).toBe('adt');
  });

  it('routes writes to ICF when cached write=false (ECC)', () => {
    getSystem.mockReturnValue({ ...profile, adtTextpool: { read: true, write: false } });
    expect(routeTextpool('mock', 'write')).toBe('icf');
  });

  it('routes reads to ADT when cached read=true', () => {
    getSystem.mockReturnValue({ ...profile, adtTextpool: { read: true, write: false } });
    expect(routeTextpool('mock', 'read')).toBe('adt');
  });

  it('falls back to conservative defaults when capability absent (read=ADT, write=ICF), no runtime probe', () => {
    getSystem.mockReturnValue({ ...profile });
    expect(routeTextpool('mock', 'read')).toBe('adt');
    expect(routeTextpool('mock', 'write')).toBe('icf');
    expect(adtSetTextElements).not.toHaveBeenCalled();
  });
});
