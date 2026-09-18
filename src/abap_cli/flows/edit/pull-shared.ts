/**
 * Shared types and helpers for the `abap pull` flow family.
 *
 * The pull flow is split across several modules by object type and selector:
 *   - pull.ts              — coordinator + route dispatch
 *   - pull-source.ts       — CLAS / INTF / PROG / FUGR (ADT REST)
 *   - pull-ddic.ts         — DOMA / DTEL / TABL / STRU (ICF)
 *   - pull-http.ts         — HTTP service (ICF)
 *   - pull-transport.ts    — TRAN / transaction code (ICF)
 *   - pull-textpool.ts     — .properties files (mixed-mode route)
 *   - pull-remote.ts       — Version Management remote source pull
 *   - pull-package.ts      — --package selector (ADT search + per-object)
 *   - pull-tr.ts           — --tr selector (transport contents)
 *
 * Keep types here so split modules share the same PullOptions / PullResult /
 * PullEntry shape without circular imports.
 */
import { normalizePullData } from '../../core/path-output.js';

export interface PullOptions {
  type?: string;
  package?: string;
  /** Pull all objects bound to a transport request (mutually exclusive with object name and --package). */
  tr?: string;
  /** PR2: filter --tr lookups by object owner (SAP `tm:owner`). Case-insensitive. Only valid with --tr. */
  user?: string;
  dir: string;
  overwrite?: boolean;
  skipExisting?: boolean;
  includeTests?: boolean;
  includeAllParts?: boolean;
  limit?: string;
  page?: string;
  /** Also pull textpool .properties files (texts/selections/headings). */
  textpool?: boolean;
  /** Pull the object's active version source from a remote system (Version Management). */
  remote?: string;
  /**
   * Which source version to fetch for ADT source objects (CLAS / INTF / PROG /
   * FUGR). Defaults to `'latest'` — ADT's working-area version, which is what
   * the user last pushed, activated or not. `'active'` fetches the version SAP
   * actually executes, matching `abap run` (feedback F-02).
   */
  versionKind?: 'latest' | 'active';
}

export interface PullEntry {
  object: string;
  type: string;
  status: 'written' | 'skipped' | 'failed';
  files?: string[];
  detail?: string;
  code?: string;
}

/** Flow outcome: JSON envelope data + human summary, printed by the command layer. */
export interface PullResult {
  data: Record<string, unknown>;
  human: string;
}

/**
 * Shape returned by per-type pull flows (TTYP, MSAG, DDLS, SRVD, BDEF, DCLS/DDLX/DDLA).
 * The coordinator (`runPull`) normalizes it into the standard PullResult envelope
 * via `wrapPullResult`.
 */
export interface TypePullResult {
  object: string;
  files: string[];
  /** Channel used for the round-trip (rendered in `human` and `data.channel`). */
  channel: 'adt' | 'icf';
  /** Optional fallback reason (TTYP/MSAG on ECC). */
  fallbackReason?: string;
}

export function parsePositiveInt(value: string | undefined, flag: string, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
    throw new Error(`${flag} must be a positive integer, got ${value}`);
  }
  return n;
}

/**
 * Wrap a `TypePullResult` into the standard `PullResult` envelope used by
 * the coordinator. Replaces the 6× repeated envelope construction that used
 * to live inline in `pull.ts`.
 *
 * Field order in the spread is significant: tests assert on property order
 * (`written` / `skipped` / `failed` before `channel`); keep it stable.
 */
export function wrapPullResult(type: string, r: TypePullResult): PullResult {
  const entry = { object: r.object, type, status: 'written' as const, files: r.files };
  const data: Record<string, unknown> = {
    object: r.object,
    type,
    entries: [entry],
    written: r.files.length,
    skipped: 0,
    failed: 0,
    channel: r.channel,
  };
  if (r.fallbackReason) data.fallbackReason = r.fallbackReason;
  return {
    data: normalizePullData(data),
    human: `Pulled ${type} ${r.object} via ${r.channel}${r.fallbackReason ? ` (${r.fallbackReason})` : ''}; wrote ${r.files.length} file(s)`,
  };
}
