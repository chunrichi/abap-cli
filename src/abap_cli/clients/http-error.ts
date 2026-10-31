import axios from 'axios';
import { CliError, type CliErrorOptions } from '../output/json.js';
import type { ErrorCode } from '../output/error-codes.js';

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

/** Fields of SAP's `<exc:exception>` error envelope (ADT / ICF error responses). */
export interface SapExceptionInfo {
  namespace?: string;
  type?: string;
  message?: string;
  localizedMessage?: string;
  properties?: Record<string, string>;
}

/** First text of `<tag>…</tag>`, preferring an English `lang` attribute. */
function elementTextByLang(xml: string, tag: string): string | undefined {
  const re = new RegExp(
    `<(?:[A-Za-z_][\\w.-]*:)?${tag}\\b([^>]*)>([\\s\\S]*?)</(?:[A-Za-z_][\\w.-]*:)?${tag}\\s*>`,
    'gi',
  );
  let fallback: string | undefined;
  for (const match of xml.matchAll(re)) {
    const text = htmlToText(match[2] ?? '');
    if (!text) continue;
    if (/lang\s*=\s*["']EN["']/i.test(match[1] ?? '')) return text;
    fallback ??= text;
  }
  return fallback;
}

/** Attribute value of the first `<tag attr="…">` occurrence. */
function attributeValue(xml: string, tag: string, attr: string): string | undefined {
  const re = new RegExp(
    `<(?:[A-Za-z_][\\w.-]*:)?${tag}\\b[^>]*\\b${attr}\\s*=\\s*(["'])(.*?)\\1`,
    'i',
  );
  return re.exec(xml)?.[2]?.trim() || undefined;
}

/** `<properties><entry key="k">v</entry></properties>` → `{ k: "v" }`. */
function exceptionProperties(xml: string): Record<string, string> | undefined {
  const block = /<(?:[A-Za-z_][\w.-]*:)?properties\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?properties\s*>/i.exec(xml)?.[1];
  if (!block) return undefined;
  const props: Record<string, string> = {};
  const re =
    /<(?:[A-Za-z_][\w.-]*:)?entry\b[^>]*?\bkey\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?entry\s*>/gi;
  for (const match of block.matchAll(re)) {
    const key = match[2]?.trim();
    if (key) props[key] = htmlToText(match[3] ?? '');
  }
  return Object.keys(props).length > 0 ? props : undefined;
}

/** True for an SAP `<exc:exception>` envelope (any namespace prefix). */
function isExceptionEnvelope(body: string): boolean {
  return /<(?:[A-Za-z_][\w.-]*:)?exception\b/i.test(body);
}

/**
 * Parse the `<exc:exception>` envelope SAP returns for ADT/ICF failures:
 *
 *   <exc:exception xmlns:exc="…">
 *     <namespace id="com.sap.adt"/>
 *     <type id="ExceptionResourceLocked"/>
 *     <message lang="EN">…</message>
 *     <localizedMessage lang="EN">…</localizedMessage>
 *     <properties><entry key="…">…</entry></properties>
 *   </exc:exception>
 *
 * Returns undefined for bodies without an exception envelope (HTML pages,
 * plain text, ICF JSON), so callers keep their existing fallback.
 */
export function parseSapException(body: string): SapExceptionInfo | undefined {
  if (!body || !isExceptionEnvelope(body)) return undefined;
  const namespace = attributeValue(body, 'namespace', 'id');
  const type = attributeValue(body, 'type', 'id');
  const message = elementTextByLang(body, 'message');
  const localizedMessage = elementTextByLang(body, 'localizedMessage');
  const properties = exceptionProperties(body);
  const info: SapExceptionInfo = {
    ...(namespace ? { namespace } : {}),
    ...(type ? { type } : {}),
    ...(message ? { message } : {}),
    ...(localizedMessage ? { localizedMessage } : {}),
    ...(properties ? { properties } : {}),
  };
  return Object.keys(info).length > 0 ? info : undefined;
}

/** Recovery hints keyed by the SAP exception type (first matching pattern wins). */
const SAP_EXCEPTION_NEXT_STEPS: ReadonlyArray<{ match: RegExp; steps: string[] }> = [
  {
    match: /locked/i,
    steps: [
      'The object is locked by another user or by one of your own sessions.',
      'Check who holds the lock: abap inspect <object> --locks',
      'Release the lock in SE03 or wait for the other session, then retry.',
    ],
  },
  {
    match: /(noaccess|noauthoriz|notauthoriz|permission)/i,
    steps: [
      'Your SAP user is not authorized for this object or package.',
      'Verify the profile user: abap profile test <profile> --json',
      'If the user is correct, ask an administrator about S_DEVELOP / S_ADT_RES authorizations.',
    ],
  },
  {
    match: /(alreadyexist|alreadyexists)/i,
    steps: [
      'The object already exists on this system.',
      'Inspect the existing object: abap inspect <object>',
      'Use a different name, or pull → edit → push (or delete) the existing object.',
    ],
  },
  {
    match: /(notfound|notexist|notexists|doesnotexist)/i,
    steps: [
      'The object or resource does not exist on this system.',
      'Verify the name and type: abap search <name>',
      'Create it first: abap create <type> <name> --file <path> --package <pkg> --tr <transport>',
    ],
  },
];

/** "What now?" guidance for a recognised SAP exception type. */
function nextStepsForSapException(info: SapExceptionInfo | undefined): string[] | undefined {
  if (!info?.type) return undefined;
  return SAP_EXCEPTION_NEXT_STEPS.find((entry) => entry.match.test(info.type!))?.steps;
}

/** Additive `details` fields for an exception envelope; `code`/`category` are untouched. */
function sapExceptionDetails(info: SapExceptionInfo | undefined): Record<string, unknown> {
  if (!info) return {};
  return {
    ...(info.type ? { sapErrorType: info.type } : {}),
    ...(info.namespace ? { sapErrorNamespace: info.namespace } : {}),
    ...(info.properties ? { sapErrorProperties: info.properties } : {}),
  };
}

/** Extract the human-readable message from a SAP error body.
 *
 *  - HTML page (ICM 503 / ABAP dump / session timeout): the `msgText` and
 *    `errorTextHeader` spans, so a 9 KB page never becomes `error.message`.
 *  - XML `<exc:exception>` envelope: `<message lang="EN">`, falling back to
 *    `<localizedMessage>` and then to any `<message>` language.
 *  - anything else: no message, so the caller keeps its legacy fallback.
 *
 *  The full (truncated) body stays available to callers via
 *  `details.sapErrorBody` — this function only decides the short message. */
function extractExcMessage(body: string, status?: number, statusText?: string): ExtractedSapMessage {
  if (isHtmlBody(body)) {
    return { kind: 'html', message: summarizeHtmlErrorPage(body, status, statusText) };
  }
  const exception = parseSapException(body);
  const message =
    exception?.message ??
    exception?.localizedMessage ??
    elementTextByLang(body, 'message') ??
    elementTextByLang(body, 'localizedMessage');
  if (message) return { kind: 'xml', message };
  // Markup that is not an HTML page is still XML (e.g. an exception envelope
  // without any message); everything else is plain text.
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
// 重构：error.references 指向新 4 领域 skill 的 errors.md
// TLS / AUTH / SAP_ERROR 由 abap-cli-setup 文档（环境就绪 + 凭证 + ICF 部署）
const TLS_REFERENCE = 'skills/abap-cli-setup/references/errors.md#tls_error';
const AUTH_REFERENCE = 'skills/abap-cli-setup/references/errors.md#auth_error';
const SAP_ERROR_REFERENCE = 'skills/abap-cli-setup/references/errors.md#sap_error';

/** "What now?" guidance for 401/403 on the only supported auth method (basic). */
const BASIC_AUTH_NEXT_STEPS = [
  "Verify credentials: 'abap profile test <name> --json'.",
  "If password expired: 'abap profile set <name> --password <new>'.",
];
const BASIC_AUTH_EXAMPLE = 'abap profile set <name> --password <new>';

/**
 * Classify any thrown value from an HTTP client into a CliError with the right
 * ErrorCode and the canonical nextSteps/example for that category.
 *
 * Detection happens on `error.code` (Node system errors propagated through
 * axios's `error.cause` chain) and `error.response.status` — never by
 * string-matching the response body.
 */
export function classifyHttpError(
  error: unknown,
  context?: { name?: string },
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
    // Pull the SAP response body out of the wrapped HttpClientException so
    // the user can see what the ABAP server actually said (mirrors the
    // AxiosError branch below; otherwise transport errors from
    // abap-adt-api lose their context entirely). abap-adt-api nests the
    // original HttpClientException under `.parent` for AdtHttpException;
    // walk that chain so we never lose the body. Extracted before the
    // auth checks so an `<exc:exception>` type is exposed on 401/403 too.
    const wrapped = httpEx as { response?: { body?: unknown }; parent?: { response?: { body?: unknown }; status?: unknown } };
    const exBody = wrapped.response?.body ?? wrapped.parent?.response?.body;
    const rawBody = typeof exBody === 'string' ? exBody : '';
    const exception = rawBody ? parseSapException(rawBody) : undefined;
    if (status === 401 || status === 403) {
      return new CliError('AUTH_ERROR', httpEx.message || 'authentication failed', {
        details: {
          httpStatus: status,
          ...(context?.name ? { system: context.name } : {}),
          ...sapExceptionDetails(exception),
        },
        nextSteps: BASIC_AUTH_NEXT_STEPS,
        example: BASIC_AUTH_EXAMPLE,
        references: AUTH_REFERENCE,
      });
    }
    // SAP returns "400 Session Timed Out" (plain text, not the usual XML
    // envelope) when a reused cookie jar has gone stale on the server.
    // Surface it as AUTH_ERROR so `_call`'s re-login fallback kicks in
    // instead of bubbling a misleading SAP_ERROR.
    if (status === 400 && /session\s+timed\s+out/i.test(rawBody)) {
      return new CliError('AUTH_ERROR', 'SAP session timed out', {
        details: { httpStatus: 400, ...(context?.name ? { system: context.name } : {}), sapErrorBody: rawBody.slice(0, 400), errorKind: 'text' },
        nextSteps: BASIC_AUTH_NEXT_STEPS,
        example: BASIC_AUTH_EXAMPLE,
        references: AUTH_REFERENCE,
      });
    }
    const wrappedStatusText = typeof httpEx.statusText === 'string' ? httpEx.statusText : undefined;
    const extracted = rawBody ? extractExcMessage(rawBody, status, wrappedStatusText) : undefined;
    const message = extracted?.message || rawBody || httpEx.message || `HTTP ${status}`;
    const opts: CliErrorOptions = {
      details: {
        httpStatus: status,
        ...(context?.name ? { system: context.name } : {}),
        ...sapExceptionDetails(exception),
      },
      references: SAP_ERROR_REFERENCE,
    };
    const exceptionSteps = nextStepsForSapException(exception);
    if (exceptionSteps) opts.nextSteps = exceptionSteps;
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
      const body = error.response?.data as { message?: string } | string | undefined;
      const exception = typeof body === 'string' ? parseSapException(body) : undefined;
      return new CliError('AUTH_ERROR', (typeof body === 'string' ? undefined : body?.message) || error.message, {
        details: {
          httpStatus: status,
          ...(context?.name ? { system: context.name } : {}),
          ...sapExceptionDetails(exception),
        },
        nextSteps: BASIC_AUTH_NEXT_STEPS,
        example: BASIC_AUTH_EXAMPLE,
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
      const exception = typeof raw === 'string' ? parseSapException(raw) : undefined;
      const message = extracted?.message || raw || error.message;
      const opts: CliErrorOptions = {
        details: {
          httpStatus: status,
          ...(context?.name ? { system: context.name } : {}),
          ...sapExceptionDetails(exception),
        },
        references: SAP_ERROR_REFERENCE,
      };
      const exceptionSteps = nextStepsForSapException(exception);
      if (exceptionSteps) opts.nextSteps = exceptionSteps;
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