/**
 * SM59 (HTTP destination) local-file ↔ ICF wire mapping.
 *
 * SM59 destinations are client-independent entries in the system table RFCDES
 * (RFCTYPE = 'G' for "HTTP connection to external server"): they have no TADIR
 * object, no package and no CTS transport path, and the definition is encoded
 * in the comma-separated `RFCOPTIONS` string. Upstream abap-file-formats has no
 * SM59 format, so the local document is a local extension validated by
 * `sm59-v1.json` and served by the bundled ICF service at `/sm59/<name>`.
 *
 * Local file: `<name>.sm59.json` (single flat document, no `name` field — the
 * file name / command argument carries the destination name, matching the AFF
 * HTTP / TRAN convention). Shape:
 *
 *   {
 *     "formatVersion": "1",
 *     "description": "Demo HTTP destination",
 *     "targetHost": "example.com",
 *     "port": 443,
 *     "protocol": "HTTPS",
 *     "pathPrefix": "/api"
 *   }
 *
 * Wire: the same document plus the read-only `name` (destination name) and
 * `type` (RFCTYPE, always 'G'); pull strips those from the local file so
 * pull → push round-trips stay stable.
 */
import { validateAff } from '../../aff/schema-validator.js';
import { defineWireArtifact } from '../artifact.js';

/** RFCDEST is CHAR 32. */
export const SM59_NAME_MAX_LENGTH = 32;

/** RFCDOC_D (destination short text = description) is CHAR 72, single line. */
export const SM59_DESCRIPTION_MAX_LENGTH = 72;

/**
 * Supported protocol values. On the SAP side `protocol` maps to the
 * destination's `SSL_ACTIVE` flag (persisted as `RFCOPTIONS s=Y` for HTTPS) —
 * the legacy `W=` option in SAP-shipped destinations is unrelated and not
 * decoded by the maintenance API.
 */
export const SM59_PROTOCOLS = ['HTTP', 'HTTPS'] as const;
export type Sm59Protocol = (typeof SM59_PROTOCOLS)[number];

/** Local `<name>.sm59.json` document. */
export interface Sm59Local {
  formatVersion: '1';
  /** Destination short text (RFCDOC); empty string when unset. */
  description?: string;
  /**
   * Target host name / IP address. SAP stores up to 1024 characters
   * (RFCHOST_EXT); the local document caps it at 255 (see sm59-v1.json).
   */
  targetHost: string;
  /** TCP port; omitted when the SAP-side default (443/80 by protocol) applies. */
  port?: number;
  protocol: Sm59Protocol;
  /** Path prefix prepended to every request URL, e.g. "/api". */
  pathPrefix?: string;
}

/**
 * Wire payload of ICF `/sm59/<name>`: the local document plus the read-only
 * identity fields the SAP side owns.
 */
export interface Sm59Wire extends Sm59Local {
  /** Destination name — from the URL on GET, echoed in the POST body. */
  name?: string;
  /** RFCTYPE — read-only, always 'G'. */
  type?: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asUpperText(value: unknown): string {
  return asText(value).toUpperCase();
}

function asPositiveInt(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return undefined;
  const i = Math.trunc(n);
  return i > 0 ? i : undefined;
}

/** Normalize a protocol value; unknown / empty values fall back to HTTPS. */
export function normalizeSm59Protocol(value: unknown): Sm59Protocol {
  const upper = asUpperText(value);
  return upper === 'HTTP' ? 'HTTP' : 'HTTPS';
}

/**
 * Convert the ICF GET payload into the local sm59-v1 document.
 *
 * `name` / `type` are deliberately dropped: they are server-owned identity
 * fields the local file does not carry (the file name is the name).
 */
export function wireToLocal(wire: unknown): Sm59Local {
  const w = asRecord(wire) ?? {};
  const local: Sm59Local = {
    formatVersion: '1',
    description: asText(w.description),
    targetHost: asText(w.targetHost),
    protocol: normalizeSm59Protocol(w.protocol),
  };
  const port = asPositiveInt(w.port);
  if (port !== undefined) local.port = port;
  const pathPrefix = asText(w.pathPrefix);
  if (pathPrefix) local.pathPrefix = pathPrefix;
  return local;
}

/**
 * Convert the local document into the body ICF `/sm59/<name>` accepts.
 * `name` is taken from the command argument / file name, `type` is the
 * read-only RFCTYPE constant.
 */
export function localToWire(local: Sm59Local, name?: string): Sm59Wire {
  const wire: Sm59Wire = {
    formatVersion: '1',
    description: asText(local.description),
    targetHost: asText(local.targetHost),
    protocol: normalizeSm59Protocol(local.protocol),
    type: 'G',
  };
  const port = asPositiveInt(local.port);
  if (port !== undefined) wire.port = port;
  const pathPrefix = asText(local.pathPrefix);
  if (pathPrefix) wire.pathPrefix = pathPrefix;
  const destination = asUpperText(name);
  if (destination) wire.name = destination;
  return wire;
}

/**
 * Semantic validation beyond JSON Schema: the rules the ICF route enforces,
 * surfaced locally with actionable messages. Name rules are separate because
 * the local document does not carry `name` (see `validateSm59Name` in
 * `flows/edit/sm59-shared.ts`).
 */
export function validateSm59Object(doc: unknown): string[] {
  const data = asRecord(doc);
  if (!data) return ['sm59 document must be a JSON object'];
  const errors: string[] = [];

  const targetHost = asText(data.targetHost);
  if (!targetHost) {
    errors.push('Missing required field: targetHost (e.g. { "targetHost": "example.com", "protocol": "HTTPS" })');
  } else if (targetHost.length > 255) {
    errors.push(`targetHost must not exceed 255 characters (got ${targetHost.length})`);
  }

  const protocol = asUpperText(data.protocol);
  if (!protocol) {
    errors.push('Missing required field: protocol ("HTTP" or "HTTPS")');
  } else if (!(SM59_PROTOCOLS as readonly string[]).includes(protocol)) {
    errors.push(`protocol must be one of ${SM59_PROTOCOLS.join(', ')} (got "${data.protocol}")`);
  }

  if (data.port !== undefined) {
    const port = asPositiveInt(data.port);
    if (port === undefined || port > 65535) {
      errors.push(`port must be an integer between 1 and 65535 (got "${String(data.port)}")`);
    }
  }

  const description = asText(data.description);
  if (description.length > SM59_DESCRIPTION_MAX_LENGTH) {
    errors.push(`description must not exceed ${SM59_DESCRIPTION_MAX_LENGTH} characters (RFCDOC_D; got ${description.length})`);
  }
  if (/[\r\n]/.test(description)) {
    errors.push('description must be a single line (no line breaks; RFCDOC_D is one CHAR 72 field)');
  }

  return errors;
}

/** Agent-facing minimal sm59-v1 example (`abap create --schema SM59`). */
export function getSm59JsonExample(): string {
  return `# src/zsm59_demo.sm59.json (single file)
{
  "formatVersion": "1",
  "description": "Demo HTTP destination",
  "targetHost": "example.com",
  "port": 443,
  "protocol": "HTTPS",
  "pathPrefix": "/api"
}
# description is the RFCDOC_D short text (max 72 characters, single line).
# protocol is HTTP or HTTPS (HTTPS enables TLS / SSL_ACTIVE); port defaults to
# 443/80 by protocol when omitted. Destinations are client-independent: no
# package and no transport request, so --package / --tr are rejected for SM59.`;
}

/** SM59 artifact: file/schema plumbing + local ↔ ICF wire mapping. */
export const sm59Artifact = defineWireArtifact<Sm59Local, Sm59Wire>({
  type: 'SM59',
  toWire: (local) => localToWire(local),
  fromWire: (wire) => wireToLocal(wire),
  validate: async (doc) => {
    const result = await validateAff('SM59', doc);
    const schemaErrors =
      result.status === 'pass' || result.status === 'warn'
        ? []
        : result.errors.map((e) => `${e.instancePath || '/'}: ${e.message}`);
    return [...schemaErrors, ...validateSm59Object(doc)];
  },
});
