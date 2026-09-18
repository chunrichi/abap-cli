import axios from 'axios';
import { CliError, type CliErrorOptions } from '../output/json.js';
import type { ErrorCode } from '../output/error-codes.js';
// Side-effect import: ensures all auth strategies are registered before
// `getAuthHints()` is called (each strategies/*.ts calls `registerStrategy`
// at module load). Required when http-error.ts is imported before the CLI
// commands have pulled in adapter.ts.
import '../auth/registry-bootstrap.js';
import { getAuthHints as lookupAuthHints } from '../auth/strategy.js';

/** Shape of the body SAP answered with, exposed as `details.errorKind` so an
 *  agent can branch on it without re-sniffing the (truncated) body. */
type SapBodyKind = 'html' | 'xml' | 'text';

/** Cap for HTML-derived messages. An ICM page can be ~9 KB of markup, but
 *  only its one meaningful line is useful in `error.message`. */
const HTML_MESSAGE_MAX = 300;

/** Decode the handful of entities SAP error pages actually emit. `&amp;` is
 *  decoded last so a literal `&amp;lt;` does not become `<`. */
function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&');
}

/** Strip tags and collapse whitespace: the extracted message must fit on a
 *  single line (an HTML error page is otherwise full of newlines/indent). */
function htmlToText(fragment: string): string {
  return decodeEntities(fragment.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when the body is an HTML error page (ICM 503, ABAP short dump,
 *  session-timeout page) rather than SAP's usual XML exception envelope.
 *  Only the very start is inspected so a legitimate payload that merely
 *  mentions "<html" deep inside is not misclassified. */
function isHtmlBody(body: string): boolean {
  const head = body.trimStart().slice(0, 200).toLowerCase();
  return head.startsWith('<!doctype') || head.startsWith('<html');
}

/** Inner text of the first element whose `id` is `msgText` — the fallback
 *  message slot on ICM/ABAP error pages. The `\1` backreference keeps the
 *  closing tag in sync for span/p/div variants. */
function extractMsgText(html: string): string | undefined {
  const m = html.match(/<([a-z][a-z0-9]*)\b[^>]*\bid\s*=\s*["']?msgText["']?[^>]*>([\s\S]*?)<\/\1\s*>/i);
  if (!m) return undefined;
  return htmlToText(m[2] ?? '') || undefined;
}

/** Inner text of the first element carrying the `errorTextHeader` class/id
 *  (the "503 Service Not Available" banner on an ICM page). */
function extractErrorTextHeader(html: string): string | undefined {
  const m = html.match(
    /<([a-z][a-z0-9]*)\b[^>]*(?:class|id)\s*=\s*["'][^"']*errorTextHeader[^"']*["'][^>]*>([\s\S]*?)<\/\1\s*>/i,
  );
  if (!m) return undefined;
  return htmlToText(m[2] ?? '') || undefined;
}

/** Build a short, human-meaningful message from an HTML error page. Never
 *  returns the page itself: falls back to the HTTP status line or a
 *  byte-count placeholder when no recognisable text is present.
 *  Exported for tests. */
export function summarizeHtmlErrorPage(body: string, status?: number, statusText?: string): string {
  const statusLine =
    status !== undefined ? `HTTP ${status}${statusText ? ` ${statusText}` : ''}` : undefined;
  const header = extractErrorTextHeader(body);
  const msgText = extractMsgText(body);

  const parts: string[] = [];
  // The ICM banner already carries the status ("503 Service Not Available"),
  // so only synthesise a status line when the page does not provide one.
  if (header) parts.push(header);
  else if (statusLine) parts.push(statusLine);
  if (msgText && msgText !== header) parts.push(msgText);

  if (parts.length === 0) {
    return statusLine ?? `HTML error page (${Buffer.byteLength(body, 'utf8')} bytes) from SAP`;
  }
  const message = parts.join(' — ');
  return message.length > HTML_MESSAGE_MAX ? `${message.slice(0, HTML_MESSAGE_MAX - 1)}…` : message;
}

/** Derived message + body kind for a SAP error body. */
interface ExtractedSapMessage {
  message?: string;
  kind: SapBodyKind;
}

/** Extract the human-readable message from a SAP error body.
 *
 *  - HTML page (ICM 503 / ABAP dump / session timeout): the `msgText` and
 *    `errorTextHeader` spans, so a 9 KB page never becomes `error.message`.
 *  - XML `<exc:exception>` envelope: first `<message lang="EN">` child.
 *  - anything else: no message, so the caller keeps its legacy fallback.
 *
 *  The full (truncated) body stays available to callers via
 *  `details.sapErrorBody` — this function only decides the short message. */
function extractExcMessage(body: string, status?: number, statusText?: string): ExtractedSapMessage {
  if (isHtmlBody(body)) {
    return { kind: 'html', message: summarizeHtmlErrorPage(body, status, statusText) };
  }
  const m = body.match(/<message\s+lang="EN"[^>]*>([\s\S]*?)<\/message>/i);
  if (m) {
    const message = m[1]?.replace(/<[^>]+>/g, '').trim();
    return { kind: 'xml', ...(message ? { message } : {}) };
  }
  // Markup that is not an HTML page is still XML (e.g. an exception envelope
  // without an English message); everything else is plain text.
  return { kind: /^\s*</.test(body) ? 'xml' : 'text' };
}

/** Node TLS error codes. */
const TLS_ERROR_CODES = new Set<string>([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'CERT_REVOKED',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
]);

const TLS_NEXT_STEPS = [
  "Run 'abap profile set <name> --ca <pem>' to trust a private CA.",
  "For self-signed dev systems only: 'abap profile set <name> --insecure'.",
];
const TLS_EXAMPLE = 'abap profile set <name> --ca ./sap-dev-ca.pem';
// 025 重构：error.references 指向新 4 领域 skill 的 errors.md
// TLS / AUTH / SAP_ERROR 由 abap-cli-setup 文档（环境就绪 + 凭证 + ICF 部署）
const TLS_REFERENCE = 'skills/abap-cli-setup/references/errors.md#tls_error';
const AUTH_REFERENCE = 'skills/abap-cli-setup/references/errors.md#auth_error';
const SAP_ERROR_REFERENCE = 'skills/abap-cli-setup/references/errors.md#sap_error';

/**
 * Choose the "what now?" hint for a 401/403 based on the auth method actually
 * used to log in. The hint set is owned by the registered AuthStrategy, so
 * new methods just declare their own `hints` and this file stays untouched.
 * Unknown / unset method falls back to the generic basic-auth guidance.
 */
const authHints = lookupAuthHints;

/**
 * Classify any thrown value from an HTTP client into a CliError with the right
 * ErrorCode and the canonical nextSteps/example for that category.
 *
 * Detection happens on `error.code` (Node system errors propagated through
 * axios's `error.cause` chain) and `error.response.status` — never by
 * string-matching the response body. The optional `context.authMethod` lets
 * the classifier pick cert-specific guidance on 401/403.
 */
export function classifyHttpError(
  error: unknown,
  context?: { name?: string; authMethod?: string },
): CliError {
  // abap-adt-api wraps AxiosError into HttpClientException with a `status`
  // number field, or AdtErrorException with the status on `.err`. Normalise
  // both here so TLS/auth/sap detection sees the numeric HTTP status.
  const httpEx = error as { status?: unknown; err?: unknown; message?: string; code?: string; statusText?: unknown };
  const status =
    typeof httpEx.status === 'number'
      ? httpEx.status
      : typeof httpEx.err === 'number'
        ? httpEx.err
        : undefined;

  if (
    status !== undefined &&
    !axios.isAxiosError(error)
  ) {
    // TLS handshake failures surface as AdtHttpException with status 0 and the
    // Node system error code (e.g. DEPTH_ZERO_SELF_SIGNED_CERT) on `code`.
    // Classify those before treating the numeric status as an HTTP response.
    if (httpEx.code && TLS_ERROR_CODES.has(httpEx.code)) {
      return new CliError('TLS_ERROR', httpEx.message || 'TLS handshake failed', {
        details: { cause: httpEx.code, ...(context?.name ? { system: context.name } : {}) },
        nextSteps: TLS_NEXT_STEPS,
        example: TLS_EXAMPLE,
        references: TLS_REFERENCE,
      });
    }
    if (status === 401 || status === 403) {
      const hints = authHints(context?.authMethod);
      return new CliError('AUTH_ERROR', httpEx.message || 'authentication failed', {
        details: { httpStatus: status, ...(context?.name ? { system: context.name, authMethod: context.authMethod } : { authMethod: context?.authMethod }) },
        nextSteps: hints.nextSteps,
        example: hints.example,
        references: AUTH_REFERENCE,
      });
    }
    // Pull the SAP response body out of the wrapped HttpClientException so
    // the user can see what the ABAP server actually said (mirrors the
    // AxiosError branch below; otherwise transport errors from
    // abap-adt-api lose their context entirely). abap-adt-api nests the
    // original HttpClientException under `.parent` for AdtHttpException;
    // walk that chain so we never lose the body.
    const wrapped = httpEx as { response?: { body?: unknown }; parent?: { response?: { body?: unknown }; status?: unknown } };
    const exBody = wrapped.response?.body ?? wrapped.parent?.response?.body;
    const rawBody = typeof exBody === 'string' ? exBody : '';
    // SAP returns "400 Session Timed Out" (plain text, not the usual XML
    // envelope) when a reused cookie jar has gone stale on the server.
    // Surface it as AUTH_ERROR so `_call`'s re-login fallback kicks in
    // instead of bubbling a misleading SAP_ERROR.
    if (status === 400 && /session\s+timed\s+out/i.test(rawBody)) {
      const hints = authHints(context?.authMethod);
      return new CliError('AUTH_ERROR', 'SAP session timed out', {
        details: { httpStatus: 400, ...(context?.name ? { system: context.name, authMethod: context.authMethod } : { authMethod: context?.authMethod }), sapErrorBody: rawBody.slice(0, 400), errorKind: 'text' },
        nextSteps: hints.nextSteps,
        example: hints.example,
        references: AUTH_REFERENCE,
      });
    }
    const wrappedStatusText = typeof httpEx.statusText === 'string' ? httpEx.statusText : undefined;
    const extracted = rawBody ? extractExcMessage(rawBody, status, wrappedStatusText) : undefined;
    const message = extracted?.message || rawBody || httpEx.message || `HTTP ${status}`;
    const opts: CliErrorOptions = {
      details: { httpStatus: status, ...(context?.name ? { system: context.name } : {}) },
      references: SAP_ERROR_REFERENCE,
    };
    if (rawBody && extracted) {
      opts.details = { ...opts.details, sapErrorBody: rawBody.slice(0, 400), errorKind: extracted.kind };
    }
    return new CliError('SAP_ERROR', message, opts);
  }

  // Non-Axios Node system errors (TLS, ECONNRESET, etc.) — sometimes arrive
  // directly without the AxiosError wrapper, e.g. when thrown by https.Agent.
  if (error instanceof Error && !axios.isAxiosError(error)) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code && TLS_ERROR_CODES.has(code)) {
      return new CliError('TLS_ERROR', error.message, {
        references: TLS_REFERENCE,
      });
    }
  }

  if (axios.isAxiosError(error)) {
    // Inspect error.cause (axios wraps the underlying TLS error there).
    const cause = error.cause as NodeJS.ErrnoException | undefined;
    if (cause?.code && TLS_ERROR_CODES.has(cause.code)) {
      return new CliError('TLS_ERROR', cause.message || error.message, {
        details: { cause: cause.code, ...(context?.name ? { system: context.name } : {}) },
        nextSteps: TLS_NEXT_STEPS,
        example: TLS_EXAMPLE,
        references: TLS_REFERENCE,
      });
    }
    const status = error.response?.status;
    if (status === 401 || status === 403) {
      const body = error.response?.data as { message?: string } | undefined;
      const hints = authHints(context?.authMethod);
      return new CliError('AUTH_ERROR', body?.message || error.message, {
        details: { httpStatus: status, ...(context?.name ? { system: context.name, authMethod: context.authMethod } : { authMethod: context?.authMethod }) },
        nextSteps: hints.nextSteps,
        example: hints.example,
        references: AUTH_REFERENCE,
      });
    }
    if (typeof status === 'number') {
      const body = error.response?.data as { message?: string } | string | undefined;
      // SAP error envelopes are usually <exc:exception> XML; pull the first
      // <message lang="EN">…</message> child so the user can see what the
      // ABAP server actually complained about. HTML pages (ICM 503 / ABAP
      // dump) are reduced to their msgText/errorTextHeader line instead of
      // dumping the whole page. When the body is already a plain object
      // (rare with ADT), fall back to .message.
      const raw = typeof body === 'string' ? body : body?.message;
      const extracted =
        typeof raw === 'string' ? extractExcMessage(raw, status, error.response?.statusText) : undefined;
      const message = extracted?.message || raw || error.message;
      const opts: CliErrorOptions = {
        details: { httpStatus: status, ...(context?.name ? { system: context.name } : {}) },
        references: SAP_ERROR_REFERENCE,
      };
      if (error.response?.statusText) opts.details = { ...opts.details, httpStatusText: error.response.statusText };
      if (typeof body === 'string' && body.length > 0 && extracted) {
        opts.details = { ...opts.details, sapErrorBody: body.slice(0, 400), errorKind: extracted.kind };
      }
      return new CliError('SAP_ERROR', message, opts);
    }
  }

  // Fallback — re-throw the original error as SAP_ERROR.
  const msg = error instanceof Error ? error.message : String(error);
  return new CliError('SAP_ERROR', msg, context?.name ? { details: { system: context.name }, references: SAP_ERROR_REFERENCE } : { references: SAP_ERROR_REFERENCE });
}

/** Convenience: does this error originate from a TLS handshake? */
export function isTlsErrorCode(code: string | undefined): boolean {
  return !!code && TLS_ERROR_CODES.has(code);
}

/** Exported for tests. */
export const TLS_ERROR_CODE_LIST: readonly string[] = Array.from(TLS_ERROR_CODES);

/** Re-export the type for downstream files. */
export type { ErrorCode };