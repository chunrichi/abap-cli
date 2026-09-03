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

export interface PullOptions {
  type?: string;
  package?: string;
  /** Pull all objects bound to a transport request (mutually exclusive with object name and --package). */
  tr?: string;
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

export function parsePositiveInt(value: string | undefined, flag: string, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
    throw new Error(`${flag} must be a positive integer, got ${value}`);
  }
  return n;
}