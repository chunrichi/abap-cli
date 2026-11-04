/**
 * UCON RFC service (SRFC) local-file ↔ ICF wire mapping.
 *
 * UCON RFC services are TADIR objects backed by UCONRFCSERVHEAD /
 * UCONRFCSERVTEXT and created/maintained through the public UCON RFC service
 * API (`CL_UCON_API_FACTORY`). Upstream abap-file-formats has no SRFC format,
 * so the local document is a local extension validated by `srfc-v1.json` and
 * served by the bundled ICF service at `/srfc/<name>`.
 *
 * Local file: `<name>.srfc.json` (single flat document, no `name` field — the
 * file name / command argument carries the service name, matching the AFF
 * HTTP / TRAN convention). Shape:
 *
 *   {
 *     "formatVersion": "1",
 *     "description": "Default RFC Service for Function-Module: Z_FM",
 *     "functionName": "Z_FM",
 *     "scope": "E",
 *     "defaultProfile": "MY_UCON_PROFILE"
 *   }
 *
 * Wire: the same document plus the read-only `name` (service id) and `package`
 * (TADIR package) plus the admin data; pull strips the read-only fields so
 * pull → push round-trips stay stable.
 */
import { validateAff } from '../../aff/schema-validator.js';
import { defineWireArtifact } from '../artifact.js';

/** UCONRFCSERVID is CHAR 30. */
export const SRFC_NAME_MAX_LENGTH = 30;

/** UCONRFCSERVTEXT-SHORTTEXT is CHAR 255, single line. */
export const SRFC_DESCRIPTION_MAX_LENGTH = 255;

/** RS38L_FNAM (function module name) is CHAR 30. */
export const SRFC_FUNCTION_MAX_LENGTH = 30;

/** UCONHTTPSERVID (default profile name) is CHAR 30. */
export const SRFC_PROFILE_MAX_LENGTH = 30;

/**
 * UCONRFCSCOPE domain values: E = callable from other systems, O = obsolete
 * function (should not be called), P = not callable from outside the client or
 * system, S = callable from own system only (all clients). An empty scope is
 * represented by omitting the field (most SAP-shipped services carry no scope).
 */
export const SRFC_SCOPES = ['E', 'O', 'P', 'S'] as const;
export type SrfcScope = (typeof SRFC_SCOPES)[number];

/** Local `<name>.srfc.json` document. */
export interface SrfcLocal {
  formatVersion: '1';
  /** Service short text (UCONRFCSERVTEXT); empty / omitted when unset. */
  description?: string;
  /** RFC-enabled function module backing the service. */
  functionName: string;
  /** Call scope; omitted when the SAP-side value is empty. */
  scope?: SrfcScope;
  /** UCON profile assigned as default profile; omitted when unset. */
  defaultProfile?: string;
}

/** Wire payload of ICF `/srfc/<name>`: the local document plus server-owned fields. */
export interface SrfcWire extends SrfcLocal {
  /** Service id — from the URL on GET, echoed in the POST body. */
  name?: string;
  /** Package of the TADIR entry (read-only; used by push/delete transport rules). */
  package?: string;
  createdBy?: string;
  createdOn?: string;
  createdAt?: string;
  changedBy?: string;
  changedOn?: string;
  changedAt?: string;
}

/** Body ICF `/srfc/<name>` accepts on POST (write path with package/transport). */
export interface SrfcWrite extends SrfcWire {
  transportRequest?: string;
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

/** Normalize a scope value; unknown / empty values are dropped. */
export function normalizeSrfcScope(value: unknown): SrfcScope | undefined {
  const upper = asUpperText(value);
  return (SRFC_SCOPES as readonly string[]).includes(upper) ? (upper as SrfcScope) : undefined;
}

/**
 * Convert the ICF GET payload into the local srfc-v1 document.
 *
 * `name`, `package` and the admin fields are deliberately dropped: they are
 * server-owned and the local file does not carry them (the file name is the
 * service name).
 */
export function wireToLocal(wire: unknown): SrfcLocal {
  const w = asRecord(wire) ?? {};
  const local: SrfcLocal = {
    formatVersion: '1',
    description: asText(w.description),
    functionName: asUpperText(w.functionName),
  };
  const scope = normalizeSrfcScope(w.scope);
  if (scope) local.scope = scope;
  const defaultProfile = asUpperText(w.defaultProfile);
  if (defaultProfile) local.defaultProfile = defaultProfile;
  return local;
}

/**
 * Convert the local document into the body ICF `/srfc/<name>` accepts.
 * `name` is taken from the command argument / file name; the read-only admin
 * fields are never sent.
 */
export function localToWire(local: SrfcLocal, name?: string): SrfcWire {
  const wire: SrfcWire = {
    formatVersion: '1',
    description: asText(local.description),
    functionName: asUpperText(local.functionName),
  };
  const scope = normalizeSrfcScope(local.scope);
  if (scope) wire.scope = scope;
  const defaultProfile = asUpperText(local.defaultProfile);
  if (defaultProfile) wire.defaultProfile = defaultProfile;
  const service = asUpperText(name);
  if (service) wire.name = service;
  return wire;
}

/**
 * Semantic validation beyond JSON Schema: the rules the ICF route enforces,
 * surfaced locally with actionable messages. Name rules are separate because
 * the local document does not carry `name` (see `validateUconName`).
 */
export function validateSrfcObject(doc: unknown): string[] {
  const data = asRecord(doc);
  if (!data) return ['srfc document must be a JSON object'];
  const errors: string[] = [];

  const functionName = asText(data.functionName);
  if (!functionName) {
    errors.push('Missing required field: functionName (RFC-enabled function module, e.g. "Z_MY_RFC_FM")');
  } else if (functionName.length > SRFC_FUNCTION_MAX_LENGTH) {
    errors.push(`functionName must not exceed ${SRFC_FUNCTION_MAX_LENGTH} characters (got ${functionName.length})`);
  }

  const description = asText(data.description);
  if (description.length > SRFC_DESCRIPTION_MAX_LENGTH) {
    errors.push(`description must not exceed ${SRFC_DESCRIPTION_MAX_LENGTH} characters (UCONTEXT; got ${description.length})`);
  }
  if (/[\r\n]/.test(description)) {
    errors.push('description must be a single line (no line breaks; UCONRFCSERVTEXT is one CHAR 255 field)');
  }

  if (data.scope !== undefined && data.scope !== '') {
    if (normalizeSrfcScope(data.scope) === undefined) {
      errors.push(`scope must be one of ${SRFC_SCOPES.join(', ')} (got "${String(data.scope)}")`);
    }
  }

  const defaultProfile = asText(data.defaultProfile);
  if (defaultProfile.length > SRFC_PROFILE_MAX_LENGTH) {
    errors.push(`defaultProfile must not exceed ${SRFC_PROFILE_MAX_LENGTH} characters (got ${defaultProfile.length})`);
  }

  return errors;
}

/** Agent-facing minimal srfc-v1 example (`abap create --schema SRFC`). */
export function getSrfcJsonExample(): string {
  return `# src/zsrfc_demo.srfc.json (single file)
{
  "formatVersion": "1",
  "description": "Default RFC Service for Function-Module: Z_MY_RFC_FM",
  "functionName": "Z_MY_RFC_FM",
  "scope": "E"
}
# functionName must be an existing RFC-enabled function module (FMODE R/X/K).
# scope is optional: E (callable from other systems), O (obsolete), P (not
# callable from outside the client/system), S (callable from own system only).
# defaultProfile is an optional UCON profile name; it must exist in UCONPROFHEAD.
# Create records the TADIR entry / transport request (--package / --tr);
# description is written in the session language only.`;
}

/** SRFC artifact: file/schema plumbing + local ↔ ICF wire mapping. */
export const srfcArtifact = defineWireArtifact<SrfcLocal, SrfcWire>({
  type: 'SRFC',
  toWire: (local) => localToWire(local),
  fromWire: (wire) => wireToLocal(wire),
  validate: async (doc) => {
    const result = await validateAff('SRFC', doc);
    const schemaErrors =
      result.status === 'pass' || result.status === 'warn'
        ? []
        : result.errors.map((e) => `${e.instancePath || '/'}: ${e.message}`);
    return [...schemaErrors, ...validateSrfcObject(doc)];
  },
});
