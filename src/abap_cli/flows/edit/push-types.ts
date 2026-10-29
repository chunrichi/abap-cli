/**
 * Shared types for the `abap push` flow family.
 *
 * Split out of `push.ts` so the ICF artifact push handlers (`push-icf.ts`) and
 * the routing table (`routing.ts`) can describe their contracts without
 * importing the coordinator.
 */

/** Options for the file-level `abap push` orchestration (distinct from pushObject's PushOptions). */
export interface PushFileOptions {
  all?: boolean;
  tr?: string;
  checkOnly?: boolean;
  activate?: boolean;
  dryRun?: boolean;
  failFast?: boolean;
  atomic?: boolean;
  yes?: boolean;
}

export interface PushFileResult {
  file: string;
  status: 'activated' | 'checked-only' | 'written' | 'failed' | 'dry-run';
  transport?: string;
  code?: string;
  stage?: string;
  errors?: unknown[];
  unlock?: string;
  detail?: string;
  /** Original failure message (aggregate reuses it for single-file runs). */
  message?: string;
  /** Original failure nextSteps (aggregate reuses them for single-file runs). */
  nextSteps?: string[];
  plan?: string[];
  /**
   * Whether the source reached SAP. `true` even when activation later failed —
   * a failed activation leaves the new source stored but inactive (F-08).
   */
  written?: boolean;
  /** Whether the active version now matches what was pushed. */
  activated?: boolean;
  /**
   * Scope of the line numbers in SAP's activation messages. `'generated-include'`
   * means they do NOT address the local file (F-05).
   */
  lineScope?: string;
  /** Raw SAP activation messages (`{type,text,line?}`), when activation ran. */
  messages?: unknown[];
}

/** Outcome of pushing one file (before the coordinator decorates the result). */
export interface PushOneResult {
  /** Transport used for this file ('' when the object is transport-free). */
  transport: string;
  /** Status override for routes without the standard activate semantics (DDIC). */
  status?: PushFileResult['status'];
  /** Channel actually used, for channel-routed (`.json` AFF) pushes. */
  channel?: 'adt' | 'icf';
}

/** Minimal shape a push route needs from `resolveFile`. */
export interface JsonPushTarget {
  objectName: string;
  objectType: string;
}
