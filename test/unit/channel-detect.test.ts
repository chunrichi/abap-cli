/**
 * Spec 036 US1: 12-cell decision matrix + 4-shape kernelRelease parser.
 *
 * 4 profiles × 3 subjects (TTYP/MSAG/DDLS) = 12 cases. Each case asserts
 * the byte-level `{ channel, fallbackReason? }` shape so the agent / runtime
 * cannot drift silently if channel-detect becomes a multi-file module.
 *
 * Spec SC-008 requires the suite to run in < 500 ms; the cache is process-
 * local and reuses a Map between cases (clearChannelCache() flips state).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  detectChannel,
  isEccOldRelease,
  clearChannelCache,
  type SystemProfile,
} from '../../src/abap_cli/flows/edit/channel-detect.js';
import { CliError } from '../../src/abap_cli/output/json.js';

const ECC_75 = { kernelRelease: '753', sapRelease: '75', ddlsSupported: true };
const ECC_75_NOT = { kernelRelease: '753', sapRelease: '75', ddlsSupported: false };
const ECC_74 = { kernelRelease: '751', sapRelease: '74', ddlsSupported: false };
const ECC_EHP6 = { kernelRelease: '740', sapRelease: '74', ddlsSupported: false };
const S4 = { kernelRelease: 'S4', sapRelease: 'S4', ddlsSupported: true };

beforeEach(() => clearChannelCache());

describe('isEccOldRelease (4-shape kernelRelease parser)', () => {
  it('recognises the four shorthand formats and their numeric ordering', () => {
    expect(isEccOldRelease('740')).toBe(true);   // ECC EHP6
    expect(isEccOldRelease('7.40')).toBe(true);   // dotted variant
    expect(isEccOldRelease('753')).toBe(false);  // ECC EHP7 boundary
    expect(isEccOldRelease('756')).toBe(false);  // ECC EHP8
    expect(isEccOldRelease('793')).toBe(false);  // latest NW 7.x
    expect(isEccOldRelease('S4')).toBe(false);   // S/4HANA
    expect(isEccOldRelease('S/4')).toBe(false);  // slashed variant
    expect(isEccOldRelease(undefined)).toBe(true); // missing == assume old
    expect(isEccOldRelease('garbage')).toBe(true); // unparseable == assume old
  });
});

describe('detectChannel (12-cell decision matrix)', () => {
  // --- TTYP ---
  it('TTYP / ECC EHP6 → ICF + ECC_EHP6_NO_ADT_TABLETYPE', () => {
    expect(detectChannel(ECC_EHP6, 'ttyp')).toEqual({
      channel: 'icf',
      fallbackReason: 'ECC_EHP6_NO_ADT_TABLETYPE',
    });
  });

  it('TTYP / ECC EHP7 → ADT', () => {
    expect(detectChannel(ECC_75, 'ttyp')).toEqual({ channel: 'adt' });
  });

  it('TTYP / S/4HANA → ADT', () => {
    expect(detectChannel(S4, 'ttyp')).toEqual({ channel: 'adt' });
  });

  it('TTYP / NW 7.93 (modern) → ADT', () => {
    expect(detectChannel({ kernelRelease: '793' }, 'ttyp')).toEqual({ channel: 'adt' });
  });

  // --- MSAG ---
  it('MSAG / ECC EHP6 → ICF + ECC_EHP6_NO_ADT_MESSAGECLASS', () => {
    expect(detectChannel(ECC_EHP6, 'msag')).toEqual({
      channel: 'icf',
      fallbackReason: 'ECC_EHP6_NO_ADT_MESSAGECLASS',
    });
  });

  it('MSAG / ECC EHP7 → ADT', () => {
    expect(detectChannel(ECC_75, 'msag')).toEqual({ channel: 'adt' });
  });

  it('MSAG / S/4HANA → ADT', () => {
    expect(detectChannel(S4, 'msag')).toEqual({ channel: 'adt' });
  });

  it('MSAG / NW 7.93 → ADT', () => {
    expect(detectChannel({ kernelRelease: '793' }, 'msag')).toEqual({ channel: 'adt' });
  });

  // --- DDLS (no ICF fallback exists) ---
  it('DDLS / ECC EHP6 → throws DDLS_NOT_SUPPORTED_ON_ECC (exit 64)', () => {
    try {
      detectChannel(ECC_EHP6, 'ddls');
      throw new Error('expected detectChannel to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      const e = err as CliError;
      expect(e.code).toBe('DDLS_NOT_SUPPORTED_ON_ECC');
      expect(e.message).toMatch(/Upgrade to ECC EHP7\+|S\/4HANA/);
    }
  });

  it('DDLS / ECC EHP7 → ADT', () => {
    expect(detectChannel(ECC_75, 'ddls')).toEqual({ channel: 'adt' });
  });

  it('DDLS / S/4HANA → ADT', () => {
    expect(detectChannel(S4, 'ddls')).toEqual({ channel: 'adt' });
  });

  it('DDLS / NW 7.93 → ADT', () => {
    expect(detectChannel({ kernelRelease: '793' }, 'ddls')).toEqual({ channel: 'adt' });
  });
});

describe('detectChannel error envelopes (US1-AS5)', () => {
  it('throws CHANNEL_DETECTION_FAILED when the profile is completely empty', () => {
    try {
      detectChannel({}, 'ttyp');
      throw new Error('expected detectChannel to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      const e = err as CliError;
      expect(e.code).toBe('CHANNEL_DETECTION_FAILED');
      expect(e.nextSteps).toBeDefined();
    }
  });

  it('falls back to ADT for DDLS when the kernelRelease is missing but ddlsSupported is true', () => {
    expect(detectChannel({ ddlsSupported: true }, 'ddls')).toEqual({ channel: 'adt' });
  });

  it('caches decisions across identical calls', () => {
    const a = detectChannel(ECC_75, 'ttyp');
    const b = detectChannel(ECC_75, 'ttyp');
    expect(a).toBe(b); // reference equality — Map identity
  });

  it('different subject types produce distinct decisions even on the same profile', () => {
    expect(detectChannel(ECC_EHP6, 'ttyp')).not.toEqual(detectChannel(ECC_EHP6, 'msag'));
  });
});

describe('detectChannel performance (SC-008)', () => {
  it('runs the 12-cell matrix in well under 500 ms', () => {
    const start = performance.now();
    const profiles: SystemProfile[] = [ECC_75, ECC_75_NOT, ECC_74, ECC_EHP6, S4, { kernelRelease: '793' }];
    const subjects = ['ttyp', 'msag', 'ddls'] as const;
    for (let i = 0; i < 100; i++) {
      for (const p of profiles) {
        for (const s of subjects) {
          try { clearChannelCache(); detectChannel(p, s); } catch { /* DDLS+ECC throws */ }
        }
      }
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(500);
  });
});
