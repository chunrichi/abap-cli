import { XMLParser } from 'fast-xml-parser';
import { CliError } from '../output/json.js';

/**
 * `/sap/bc/adt/activation` request building and response parsing.
 *
 * Why this module exists instead of `abap-adt-api`'s `activate()`:
 *
 * The library's array overload emits `adtcore:type` + `adtcore:parentUri` on
 * every `<adtcore:objectReference>`. On-prem SAP (verified against vhcala4hci)
 * answers that request with HTTP 200 and
 *
 *   <chkl:properties checkExecuted="false" activationExecuted="false"
 *                    generationExecuted="false"/>
 *
 * i.e. a silent no-op — nothing is checked, activated or generated, and no
 * message is returned. Callers then see success while the source stays
 * written-but-inactive and the previously active version keeps running.
 *
 * Sending only `adtcore:uri` + `adtcore:name` (what the library's
 * single-object overload produces) makes SAP run all three steps.
 */

export interface ActivationItem {
  uri: string;
  name: string;
}

export interface ActivationMessage {
  /** SAP message type: 'E' (error), 'A' (abort), 'X' (exit), 'W' (warning), 'I' (info). */
  type: string;
  text: string;
  /**
   * SAP's `line` attribute. For OO classes this is relative to the *generated*
   * include and does not address the local file (feedback F-05: a real line 6
   * came back as `line 1`). Prefer {@link startLine} when present.
   */
  line?: number;
  href?: string;
  /**
   * Line parsed from the message's `href` fragment (`...#start=6,2`). This is
   * the position inside the referenced source URI and is the accurate one.
   */
  startLine?: number;
  /** Column parsed from the `href` fragment, when present. */
  startColumn?: number;
  /** Source URI the message points at (href without the fragment). */
  sourceUri?: string;
}

/** Parse `#start=<line>,<col>` out of an ADT message href. */
function parseHrefPosition(href: string | undefined): {
  startLine?: number;
  startColumn?: number;
  sourceUri?: string;
} {
  if (!href) return {};
  const [sourceUri, fragment] = href.split('#');
  const m = /start=(\d+)(?:,(\d+))?/.exec(fragment ?? '');
  if (!m) return { sourceUri };
  const line = Number(m[1]);
  const column = m[2] !== undefined ? Number(m[2]) : undefined;
  return {
    ...(Number.isFinite(line) && line > 0 ? { startLine: line } : {}),
    ...(column !== undefined && Number.isFinite(column) && column > 0 ? { startColumn: column } : {}),
    ...(sourceUri ? { sourceUri } : {}),
  };
}

export interface ActivationResult {
  messages: ActivationMessage[];
  /** False when SAP reported errors or left items inactive. */
  success: boolean;
  /** URIs SAP reported as still inactive after the run. */
  inactive: string[];
  checkExecuted: boolean;
  activationExecuted: boolean;
  generationExecuted: boolean;
}

/** Message types that mean the object did not activate. */
const FAILING_TYPES = new Set(['E', 'A', 'X']);

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Build the activation request body for the given items. */
export function buildActivationRequest(items: ActivationItem[]): string {
  const refs = items
    .map((i) => `<adtcore:objectReference adtcore:uri="${escapeXmlAttribute(i.uri)}" adtcore:name="${escapeXmlAttribute(i.name)}"/>`)
    .join('\n');
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">' +
    refs +
    '</adtcore:objectReferences>'
  );
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** `<shortText><txt>a</txt><txt>b</txt></shortText>` → "a b". */
function shortTextOf(node: unknown): string {
  const shortText = (node as { shortText?: unknown } | undefined)?.shortText;
  if (shortText === undefined) return '';
  const txt = (shortText as { txt?: unknown }).txt;
  return asArray(txt as string | string[] | undefined)
    .map((t) => String(t))
    .join(' ')
    .trim();
}

function boolAttr(value: unknown): boolean {
  return String(value ?? '').toLowerCase() === 'true';
}

/** Parse an activation response body into a structured result. */
export function parseActivationResponse(body: string): ActivationResult {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  let parsed: Record<string, unknown>;
  try {
    parsed = parser.parse(body) as Record<string, unknown>;
  } catch {
    // A body we cannot parse is treated as "SAP said nothing" — callers decide.
    return {
      messages: [],
      success: true,
      inactive: [],
      checkExecuted: false,
      activationExecuted: false,
      generationExecuted: false,
    };
  }

  const root = (parsed['chkl:messages'] ?? {}) as Record<string, unknown>;
  const props = (root['chkl:properties'] ?? {}) as Record<string, unknown>;

  const messages: ActivationMessage[] = asArray(root['msg'] as unknown).map((m) => {
    const node = m as Record<string, unknown>;
    const line = node['@_line'];
    const href = node['@_href'] ? String(node['@_href']) : undefined;
    return {
      type: String(node['@_type'] ?? ''),
      text: shortTextOf(node) || 'Activation message',
      ...(line !== undefined && Number.isFinite(Number(line)) ? { line: Number(line) } : {}),
      ...(href ? { href } : {}),
      // The href fragment carries the accurate position; SAP's `line` attribute
      // is include-relative and misleading (F-05).
      ...parseHrefPosition(href),
    };
  });

  const inactiveRoot = (parsed['ioc:inactiveObjects'] ?? {}) as Record<string, unknown>;
  const inactive = asArray(inactiveRoot['ioc:entry'] as unknown)
    .map((e) => {
      const ref = ((e as Record<string, unknown>)['ioc:object'] ?? {}) as Record<string, unknown>;
      const attrs = (ref['ioc:ref'] ?? {}) as Record<string, unknown>;
      const uri = attrs['@_adtcore:uri'];
      return uri === undefined ? undefined : String(uri);
    })
    .filter((u): u is string => u !== undefined);

  const failed = messages.some((m) => FAILING_TYPES.has(m.type));
  return {
    messages,
    success: !failed && inactive.length === 0,
    inactive,
    checkExecuted: boolAttr(props['@_checkExecuted']),
    activationExecuted: boolAttr(props['@_activationExecuted']),
    generationExecuted: boolAttr(props['@_generationExecuted']),
  };
}

/**
 * Turn a failed activation result into a CliError. Returns normally when SAP
 * reported no errors, so callers can inspect warnings/execution flags.
 *
 * Position handling (feedback F-05): SAP's `line` attribute is relative to the
 * *generated* include — a failure on local line 6 came back as `line 1`. The
 * accurate position rides in the message `href` fragment (`#start=6,2`), so we
 * prefer that and record `lineScope` to say which kind of number the message
 * contains. `nextSteps` point at `abap check syntax`, which always reports
 * local-file lines.
 */
export function throwOnActivationFailure(result: ActivationResult, label: string): void {
  const errors = result.messages.filter((m) => FAILING_TYPES.has(m.type));
  if (errors.length === 0 && result.inactive.length === 0) return;
  const positionOf = (m: ActivationMessage): number | undefined => m.startLine ?? m.line;
  const detail = errors
    .map((m) => {
      const position = positionOf(m);
      return `${position !== undefined ? `line ${position}: ` : ''}${m.text}`;
    })
    .join('; ');
  const hasPrecisePosition = errors.some((m) => m.startLine !== undefined);
  throw new CliError(
    'ACTIVATION_FAILED',
    `Activation failed for ${label}: ${detail || 'object left inactive'}`,
    {
      details: {
        messages: result.messages,
        inactive: result.inactive,
        activationExecuted: result.activationExecuted,
        // 'source-uri' → the line addresses the referenced source (use it);
        // 'generated-include' → include-relative, does not address the local file.
        lineScope: hasPrecisePosition ? 'source-uri' : 'generated-include',
        // The source WAS written before activation was attempted (F-08).
        written: true,
        activated: false,
      },
      nextSteps: [
        `${label} was written to SAP but NOT activated — the active version is unchanged.`,
        `Inspect the pending state: abap inspect ${label} --activation`,
        `Get line numbers relative to your local file: abap check syntax <file>`,
      ],
    },
  );
}
