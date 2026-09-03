/**
 * 014 US4: textpool capability probe persistence + mixed-mode router.
 * TDD — written before textpool-capability.ts / textpool-router.ts.
 * The capability is recorded once at connect/init time (Q1: one-shot, reuse),
 * and the router reads the cached SystemProfile result with NO runtime fallback.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  probeTextpoolCapability,
  recordCapability,
  readCapability,
  type TextpoolCapability,
} from '../../src/abap_cli/clients/textpool-capability.js';
import { routeTextpool, type TextpoolRoute } from '../../src/abap_cli/clients/textpool-router.js';

// --- adt-textpool / adt-client mocks (probe uses getTextElements + setTextElements) ---
const adtGetTextElements = vi.fn();
const adtSetTextElements = vi.fn();
const getSystem = vi.fn();
const upsertSystem = vi.fn();

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: {
    create: async () => ({
      getTextElements: adtGetTextElements,
      setTextElements: adtSetTextElements,
      getConfig: () => ({ sap: { username: 'MOCKUSER', client: '001', language: 'EN' }, transport: 'TRN001', package: '$TMP' }),
    }),
  },
}));

vi.mock('../../src/abap_cli/config/user-config.js', () => ({
  getSystem: (...a: unknown[]) => getSystem(...a),
  upsertSystem: (...a: unknown[]) => upsertSystem(...a),
}));

const validCap: TextpoolCapability = { read: true, write: true, checkedAt: '2026-08-06T00:00:00Z' };

describe('014/textpool-capability (probe + persist)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('detects write support when setTextElements succeeds', async () => {
    adtGetTextElements.mockResolvedValue({ textElements: [] });
    adtSetTextElements.mockResolvedValue(undefined);
    const cap = await probeTextpoolCapability();
    expect(cap.write).toBe(true);
    expect(cap.read).toBe(true);
  });

  it('detects write unsupported (ECC) when setTextElements throws a not-supported error', async () => {
    adtGetTextElements.mockResolvedValue({ textElements: [] });
    adtSetTextElements.mockRejectedValue(new Error('Endpoint not supported'));
    const cap = await probeTextpoolCapability();
    expect(cap.write).toBe(false);
    expect(cap.read).toBe(true);
  });

  it('never throws on probe failure — records write=false, read=false with a reason', async () => {
    adtGetTextElements.mockRejectedValue(new Error('network'));
    const cap = await probeTextpoolCapability();
    expect(cap.write).toBe(false);
    expect(cap.read).toBe(false);
  });

  it('recordCapability persists to SystemProfile (systemVersion + adtTextpool)', async () => {
    getSystem.mockReturnValue({ url: 'http://localhost:8080', client: '100', username: 'u', language: 'EN' });
    await recordCapability('mock', { ...validCap, systemVersion: 'ECC 7.40' });
    expect(upsertSystem).toHaveBeenCalledWith(
      'mock',
      expect.objectContaining({
        systemVersion: 'ECC 7.40',
        adtTextpool: expect.objectContaining({ read: true, write: true }),
      }),
    );
  });

  it('readCapability returns the recorded value and undefined when absent', async () => {
    getSystem.mockReturnValue({ url: 'x', client: '100', username: 'u', language: 'EN', adtTextpool: validCap });
    expect(readCapability('mock')).toEqual(validCap);
    getSystem.mockReturnValue({ url: 'x', client: '100', username: 'u', language: 'EN' });
    expect(readCapability('mock')).toBeUndefined();
  });
});

describe('014/textpool-router (read cache, no runtime fallback)', () => {
  it('routes writes to ADT when cached write=true', () => {
    getSystem.mockReturnValue({ url: 'x', client: '100', username: 'u', language: 'EN', adtTextpool: { read: true, write: true } });
    expect(routeTextpool('mock', 'write')).toBe('adt');
  });

  it('routes writes to ICF when cached write=false (ECC)', () => {
    getSystem.mockReturnValue({ url: 'x', client: '100', username: 'u', language: 'EN', adtTextpool: { read: true, write: false } });
    expect(routeTextpool('mock', 'write')).toBe('icf');
  });

  it('routes reads to ADT when cached read=true', () => {
    getSystem.mockReturnValue({ url: 'x', client: '100', username: 'u', language: 'EN', adtTextpool: { read: true, write: false } });
    expect(routeTextpool('mock', 'read')).toBe('adt');
  });

  it('falls back to conservative defaults when capability absent (read=ADT, write=ICF), no runtime probe', () => {
    getSystem.mockReturnValue({ url: 'x', client: '100', username: 'u', language: 'EN' });
    expect(routeTextpool('mock', 'read')).toBe('adt');
    expect(routeTextpool('mock', 'write')).toBe('icf');
    expect(adtSetTextElements).not.toHaveBeenCalled();
  });
});
