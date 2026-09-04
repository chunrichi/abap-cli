/**
 * 036-ttyp-msag-ddls: dual-channel route classifier.
 *
 * Spec 036 US1: every pull/create/push for TTYP / MSAG / DDLS consults this
 * module first to pick ADT vs. ICF. The decision is pure: it inspects the
 * already-loaded `SystemProfile` (no SAP round-trip), then caches it
 * in-process for the remaining lifetime.
 *
 * Two categories of decision:
 *   - `{ channel: 'adt' }`                       — modern kernel / S/4HANA
 *   - `{ channel: 'icf', fallbackReason: ... }`  — ECC EHP5/6 for TTYP/MSAG
 *   - DDLS on ECC → throws `DDLS_NOT_SUPPORTED_ON_ECC` (no fallback exists)
 *
 * Cache key = profileHash + type; TTL = process lifetime (per spec Q3 — SAP
 * profiles don't change inside one CLI invocation, and we deliberately avoid
 * cache-busting logic so tests stay deterministic).
 */
import { createHash } from 'node:crypto';
import { CliError } from '../../output/json.js';
import type { ErrorCode } from '../../output/error-codes.js';

/** Subset of `SystemProfile` channel-detection actually reads. */
export interface SystemProfile {
  /** Standardised SAP kernel release, e.g. "753", "756", "793", "S4". */
  kernelRelease?: string;
  /** SAP GUI `sy-saprl`, complementary to kernelRelease. */
  sapRelease?: string;
  /** Whether the active system can host CDS / DDL sources. */
  ddlsSupported?: boolean;
}

/** Decision returned by `detectChannel()`. */
export type ChannelDecision =
  | { channel: 'adt' }
  | { channel: 'icf'; fallbackReason: 'ECC_EHP6_NO_ADT_TABLETYPE' | 'ECC_EHP6_NO_ADT_MESSAGECLASS' };

/** Subject types — DDLS triggers a hard exit on ECC, never falls back. */
export type ChannelSubject = 'ttyp' | 'msag' | 'ddls';

/** In-process cache. Key = hash of the relevant profile fields + subject. */
const cache = new Map<string, ChannelDecision>();

/** TTL = process lifetime. Exported so tests can flush between cases. */
export function clearChannelCache(): void {
  cache.clear();
}

/**
 * Parse kernel releases rendered in any of the four shorthand shapes observed
 * in real `SystemProfile` records and bucket them into a numeric comparator:
 *
 *   "7.53"  → 753
 *   "753"   → 753
 *   "S4"    → 9999  (S/4HANA: never "old release")
 *   "S/4"   → 9999
 *   "793"   → 793
 *   undefined → NaN
 *
 * Spec 036 US1-AS2: anything < 753 is ECC EHP6 or earlier — TTYP/MSAG ADT
 * endpoints were introduced in EHP7 / 7.40+.
 */
export function isEccOldRelease(kernelRelease: string | undefined): boolean {
  if (!kernelRelease) return true; // missing == treat as old
  const trimmed = kernelRelease.trim().toUpperCase().replace('/', '').replace('.', '');
  if (trimmed === 'S4') return false;
  const parsed = parseInt(trimmed, 10);
  if (Number.isNaN(parsed)) return true;
  return parsed < 753;
}

/**
 * Stable hash of a (profile, subject) tuple — used as the cache key. We
 * only fold the fields channel detection reads; lifecycle metadata on the
 * profile (lastRefresh, host, etc.) is irrelevant.
 */
function cacheKey(profile: SystemProfile, subject: ChannelSubject): string {
  const canonical = JSON.stringify({
    k: profile.kernelRelease ?? '',
    s: profile.sapRelease ?? '',
    d: profile.ddlsSupported === true,
    t: subject,
  });
  return createHash('sha1').update(canonical).digest('hex');
}

/**
 * Decide whether `subject` should be fetched via ADT or ICF.
 *
 * Errors map to two new (reserved-range) categories:
 *   - `DDLS_NOT_SUPPORTED_ON_ECC` (exit 64) when DDLS hits a system that
 *     cannot host DDL sources. No SAP call is attempted.
 *   - `CHANNEL_DETECTION_FAILED` (exit 65) when profile data is malformed
 *     or missing.
 */
export function detectChannel(profile: SystemProfile, subject: ChannelSubject): ChannelDecision {
  const key = cacheKey(profile, subject);
  const cached = cache.get(key);
  if (cached) return cached;

  // No usable kernelRelease AND no usable ddlsSupported flag → we genuinely
  // cannot tell what this system is. Bail before issuing any pull request.
  if (!profile.kernelRelease && profile.ddlsSupported === undefined) {
    const code: ErrorCode = 'CHANNEL_DETECTION_FAILED';
    throw new CliError(code, 'Could not determine transport channel — system profile is incomplete', {
      details: {
        kernelRelease: profile.kernelRelease ?? null,
        sapRelease: profile.sapRelease ?? null,
        ddlsSupported: profile.ddlsSupported ?? null,
        subject,
      },
      nextSteps: [
        "Re-run with credentials that grant access to the ADT endpoint: 'abap profile test'.",
        "Verify that the active profile points at the system you expect: 'abap profile show'.",
      ],
      example: 'abap profile test <name>',
    });
  }

  // DDLS path: ECC EHP6 and below simply lack DDL source support — no ICF
  // substitute exists (DDL source is SAP-internal). Spec 036 US1-AS4 +
  // US4-AS4: hard-error rather than silent fallback.
  if (subject === 'ddls') {
    if (!isEccOldRelease(profile.kernelRelease)) {
      const decision: ChannelDecision = { channel: 'adt' };
      cache.set(key, decision);
      return decision;
    }
    // Old release + ddlsSupported explicitly enabled? Honour it (rare).
    if (profile.ddlsSupported === true) {
      const decision: ChannelDecision = { channel: 'adt' };
      cache.set(key, decision);
      return decision;
    }
    const code: ErrorCode = 'DDLS_NOT_SUPPORTED_ON_ECC';
    throw new CliError(
      code,
      `CDS view source (DDLS) is not supported by this SAP release (kernel ${profile.kernelRelease ?? 'unknown'}). Upgrade to ECC EHP7+ or S/4HANA to use 'abap pull --type DDLS'.`,
      {
        details: {
          kernelRelease: profile.kernelRelease ?? null,
          sapRelease: profile.sapRelease ?? null,
          subject,
        },
        nextSteps: [
          'Run this command on ECC EHP7+, or on any S/4HANA system.',
          "If you have a typo'd --type, omit it or pass a type this profile supports.",
        ],
        example: 'abap pull ZMY_CDS_VIEW --type DDLS',
      },
    );
  }

  // TTYP / MSAG: ADT primary, ICF fallback only when ECC is too old.
  if (isEccOldRelease(profile.kernelRelease)) {
    const decision: ChannelDecision = {
      channel: 'icf',
      fallbackReason:
        subject === 'msag' ? 'ECC_EHP6_NO_ADT_MESSAGECLASS' : 'ECC_EHP6_NO_ADT_TABLETYPE',
    };
    cache.set(key, decision);
    return decision;
  }

  const decision: ChannelDecision = { channel: 'adt' };
  cache.set(key, decision);
  return decision;
}
