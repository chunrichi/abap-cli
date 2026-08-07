/**
 * Shared helper for parsing ADT classrun stdout (015-abap-run).
 *
 * ADT classrun returns the wrapper's `out->write(...)` output verbatim.
 * Both bundled classes (`ZCL_ABAP_VIBE_ICF_SETUP`, `ZCL_ABAP_VIBE_RUNNER`)
 * emit a JSON envelope `{ status, ... }` on success and `{ status: 'error',
 * error: { code, message } }` on failure.
 *
 * This helper centralises the parse rules:
 * - empty → `SAP_ERROR` (caller throws)
 * - JSON `{ status: 'error', error: { code, message } }` → return `{ kind: 'error', code, message }`
 * - JSON `{ status: 'ok', ... }` (or any non-error status) → return `{ kind: 'ok', parsed, exitCode }`
 * - non-JSON plain text → return `{ kind: 'ok', parsed: null, raw, exitCode: 0 }`
 *   (treated as business-success plain-text output, e.g. `WRITE 'hello'.`)
 *
 * It does NOT throw — callers (run-flow, deploy-flow) decide how to map to
 * `CliError` codes and emit error envelopes.
 */

export interface ClassrunError {
  kind: 'error';
  code?: string;
  message?: string;
  parsed?: Record<string, unknown> | null;
  raw: string;
}

export interface ClassrunOk {
  kind: 'ok';
  parsed: Record<string, unknown> | null;
  exitCode: number;
  raw: string;
}

export interface ClassrunEmpty {
  kind: 'empty';
  raw: string;
}

export type ClassrunOutput = ClassrunError | ClassrunOk | ClassrunEmpty;

/** Strip whitespace + trailing newlines that SAP sometimes adds. */
function trim(raw: string): string {
  return (raw ?? '').trim();
}

/**
 * Map a plain-text classrun output to a structured error code when it is a
 * SAP-side error message (real SAP returns plain text for several failure
 * modes instead of a JSON envelope — verified on vhcala4hci 2026-08-07).
 * Returns `undefined` when the text is not a recognisable SAP error and
 * should be treated as business success.
 */
export function detectPlainTextError(raw: string): { code: string; message: string } | undefined {
  if (!raw) return undefined;
  // Real SAP: `Object ZCL_FOO of type CLAS does not exist.`
  if (/\bdoes not exist\b/i.test(raw)) {
    return { code: 'OBJECT_NOT_FOUND', message: raw };
  }
  // Real SAP: `Error: Class does not implement if_oo_adt_classrun~main method!`
  if (/\bdoes not implement\b/i.test(raw)) {
    return { code: 'CLASS_NOT_RUNNABLE', message: raw };
  }
  // Real SAP: `Class ZCL_FOO is inactive` (ADT rejects inactive objects).
  if (/\b(?:is|are)\s+inactive\b/i.test(raw)) {
    return { code: 'OBJECT_NOT_ACTIVE', message: raw };
  }
  // Real SAP: `Class ZCL_FOO is locked by user ...` / lock errors.
  if (/\b(?:locked by|currently editing)\b/i.test(raw)) {
    return { code: 'LOCKED', message: raw };
  }
  // Unrecognised plain-text is business success (e.g. `WRITE 'hello'.` output).
  return undefined;
}

/** Parse classrun stdout into a discriminated result. Never throws. */
export function parseClassrunOutput(raw: string): ClassrunOutput {
  const trimmed = trim(raw);
  if (trimmed.length === 0) {
    return { kind: 'empty', raw };
  }
  if (!trimmed.startsWith('{')) {
    // Plain text: a recognised SAP error maps to a structured error; anything
    // else (e.g. `WRITE 'hello'.` output) is business success.
    const plainError = detectPlainTextError(trimmed);
    if (plainError) {
      return {
        kind: 'error',
        code: plainError.code,
        message: plainError.message,
        parsed: null,
        raw: trimmed,
      };
    }
    return { kind: 'ok', parsed: null, exitCode: 0, raw: trimmed };
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    // JSON-ish but malformed → return as raw success with no parse; the
    // caller may choose to surface as an error if it looks like a stack
    // trace (caller checks substring markers).
    return { kind: 'ok', parsed: null, exitCode: 0, raw: trimmed };
  }
  if (parsed && parsed.status === 'error') {
    // Two envelope shapes exist:
    //   A. wrapper (015):  { status: 'error', code, message, class?, method? }
    //   B. ICF/setup (013): { status: 'error', error: { code, message } }
    const err = (parsed.error ?? {}) as { code?: string; message?: string };
    return {
      kind: 'error',
      code: (err.code ?? parsed.code) as string | undefined,
      message: (err.message ?? parsed.message) as string | undefined,
      parsed,
      raw: trimmed,
    };
  }
  const exitCode =
    typeof parsed?.exitCode === 'number' ? (parsed.exitCode as number) : 0;
  return { kind: 'ok', parsed, exitCode, raw: trimmed };
}

/**
 * Detect whether a plain-text classrun output looks like a SAP exception
 * trace. Used by run-flow's US-4 acceptance 2 fallback (CX_ROOT / CX_SY /
 * RAISE markers).
 */
export function looksLikeException(raw: string): boolean {
  if (!raw) return false;
  // `CX_SY_ARITHMETIC_ERROR` contains an underscore after CX_SY, so the
  // trailing `\b` would not match; match the class prefix instead.
  return /\bCX_ROOT\b|\bCX_SY\b|\bRAISE\b|\bCX_/i.test(raw);
}