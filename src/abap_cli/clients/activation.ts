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
  /** Source location SAP pointed at, when the message carries one. */
  line?: number;
  href?: string;
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
    return {
      type: String(node['@_type'] ?? ''),
      text: shortTextOf(node) || 'Activation message',
      ...(line !== undefined && Number.isFinite(Number(line)) ? { line: Number(line) } : {}),
      ...(node['@_href'] ? { href: String(node['@_href']) } : {}),
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
 */
export function throwOnActivationFailure(result: ActivationResult, label: string): void {
  const errors = result.messages.filter((m) => FAILING_TYPES.has(m.type));
  if (errors.length === 0 && result.inactive.length === 0) return;
  const detail = errors
    .map((m) => `${m.line !== undefined ? `line ${m.line}: ` : ''}${m.text}`)
    .join('; ');
  throw new CliError('ACTIVATION_FAILED', `Activation failed for ${label}: ${detail || 'object left inactive'}`, {
    details: {
      messages: result.messages,
      inactive: result.inactive,
      activationExecuted: result.activationExecuted,
    },
  });
}
