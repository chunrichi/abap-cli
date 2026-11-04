/**
 * OAuth 2.0 client profile (OA2P) local-file ↔ ICF wire mapping.
 *
 * OA2P profiles are TADIR objects backed by OA2C_PROFILES / OA2P_SCOPES and
 * maintained through the Workbench persistence classes (`CL_OA2P_OBJECT_PERSIST`
 * / `CL_OA2P_OBJECT_DATA`). Upstream abap-file-formats has no OA2P format, so
 * the local document is a local extension validated by `oa2p-v1.json` and
 * served by the bundled ICF service at `/oa2p/<name>`.
 *
 * Local file: `<name>.oa2p.json` (single flat document, no `name` field — the
 * file name / command argument carries the profile name). Shape:
 *
 *   {
 *     "formatVersion": "1",
 *     "type": "DEFAULT",
 *     "noAuthCheck": false,
 *     "scopes": ["scope-one", "scope-two"]
 *   }
 *
 * The OAuth 2.0 provider-specific object (`O_SPECIFICS`) is stateless — the
 * provider BADI implementation for a `type` carries no persisted data — so the
 * profile document models only the persisted header and scope rows.
 */
import { validateAff } from '../../aff/schema-validator.js';
import { defineWireArtifact } from '../artifact.js';

/** OA2C_PROFILE is CHAR 30. */
export const OA2P_NAME_MAX_LENGTH = 30;

/** OA2C_TYPE is CHAR 20 (OA2C_TYPES entries, e.g. DEFAULT, HANA_CLOUD_PLATFORM). */
export const OA2P_TYPE_MAX_LENGTH = 20;

/** OA2C_SCOPE is a STRING; the local cap keeps documents reviewable. */
export const OA2P_SCOPE_MAX_LENGTH = 1024;

/** Upper bound on scopes per profile (OA2P_SCOPES has no SAP-side limit). */
export const OA2P_MAX_SCOPES = 100;

/** Local `<name>.oa2p.json` document. */
export interface Oa2pLocal {
  formatVersion: '1';
  /** OAuth 2.0 service provider type; must exist in OA2C_TYPES. */
  type: string;
  /** Skip the S_OA2C_ADM authority check for the profile's users. */
  noAuthCheck?: boolean;
  /** Requested OAuth 2.0 scopes. */
  scopes?: string[];
}

/** Wire payload of ICF `/oa2p/<name>`: the local document plus server-owned fields. */
export interface Oa2pWire extends Oa2pLocal {
  /** Profile name — from the URL on GET, echoed in the POST body. */
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

/** Body ICF `/oa2p/<name>` accepts on POST (write path with package/transport). */
export interface Oa2pWrite extends Oa2pWire {
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

/** Normalize a scope list: drop empty / non-string entries, keep order. */
export function normalizeOa2pScopes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const scopes: string[] = [];
  for (const entry of value) {
    const scope = asText(entry);
    if (scope) scopes.push(scope);
  }
  return scopes;
}

/**
 * Convert the ICF GET payload into the local oa2p-v1 document.
 *
 * `name`, `package` and the admin fields are deliberately dropped: they are
 * server-owned and the local file does not carry them (the file name is the
 * profile name).
 */
export function wireToLocal(wire: unknown): Oa2pLocal {
  const w = asRecord(wire) ?? {};
  const local: Oa2pLocal = {
    formatVersion: '1',
    type: asUpperText(w.type),
    noAuthCheck: w.noAuthCheck === true,
  };
  const scopes = normalizeOa2pScopes(w.scopes);
  if (scopes.length > 0) local.scopes = scopes;
  return local;
}

/**
 * Convert the local document into the body ICF `/oa2p/<name>` accepts.
 * `name` is taken from the command argument / file name; the read-only admin
 * fields are never sent.
 */
export function localToWire(local: Oa2pLocal, name?: string): Oa2pWire {
  const wire: Oa2pWire = {
    formatVersion: '1',
    type: asUpperText(local.type),
    noAuthCheck: local.noAuthCheck === true,
  };
  const scopes = normalizeOa2pScopes(local.scopes);
  if (scopes.length > 0) wire.scopes = scopes;
  const profile = asUpperText(name);
  if (profile) wire.name = profile;
  return wire;
}

/**
 * Semantic validation beyond JSON Schema: the rules the ICF route enforces,
 * surfaced locally with actionable messages. Name rules are separate because
 * the local document does not carry `name` (see `validateUconName`).
 */
export function validateOa2pObject(doc: unknown): string[] {
  const data = asRecord(doc);
  if (!data) return ['oa2p document must be a JSON object'];
  const errors: string[] = [];

  const type = asText(data.type);
  if (!type) {
    errors.push('Missing required field: type (OAuth 2.0 service provider type from OA2C_TYPES, e.g. "DEFAULT")');
  } else if (type.length > OA2P_TYPE_MAX_LENGTH) {
    errors.push(`type must not exceed ${OA2P_TYPE_MAX_LENGTH} characters (OA2C_TYPE; got ${type.length})`);
  }

  if (data.noAuthCheck !== undefined && typeof data.noAuthCheck !== 'boolean') {
    errors.push('noAuthCheck must be a boolean');
  }

  if (data.scopes !== undefined) {
    if (!Array.isArray(data.scopes)) {
      errors.push('scopes must be an array of scope strings');
    } else {
      if (data.scopes.length > OA2P_MAX_SCOPES) {
        errors.push(`scopes must contain at most ${OA2P_MAX_SCOPES} entries (got ${data.scopes.length})`);
      }
      data.scopes.forEach((scope, index) => {
        const text = asText(scope);
        if (!text) {
          errors.push(`scopes[${index}] must be a non-empty string`);
        } else if (text.length > OA2P_SCOPE_MAX_LENGTH) {
          errors.push(`scopes[${index}] must not exceed ${OA2P_SCOPE_MAX_LENGTH} characters (got ${text.length})`);
        }
      });
    }
  }

  return errors;
}

/** Agent-facing minimal oa2p-v1 example (`abap create --schema OA2P`). */
export function getOa2pJsonExample(): string {
  return `# src/zoa2p_demo.oa2p.json (single file)
{
  "formatVersion": "1",
  "type": "DEFAULT",
  "noAuthCheck": false,
  "scopes": ["scope-one", "scope-two"]
}
# type must be an OAuth 2.0 service provider type configured in OA2C_TYPES
# (transaction OA2C_CONFIG); DEFAULT is the generic provider type.
# noAuthCheck skips the S_OA2C_ADM authority check for the profile's users.
# Create records the TADIR entry / transport request (--package / --tr).`;
}

/** OA2P artifact: file/schema plumbing + local ↔ ICF wire mapping. */
export const oa2pArtifact = defineWireArtifact<Oa2pLocal, Oa2pWire>({
  type: 'OA2P',
  toWire: (local) => localToWire(local),
  fromWire: (wire) => wireToLocal(wire),
  validate: async (doc) => {
    const result = await validateAff('OA2P', doc);
    const schemaErrors =
      result.status === 'pass' || result.status === 'warn'
        ? []
        : result.errors.map((e) => `${e.instancePath || '/'}: ${e.message}`);
    return [...schemaErrors, ...validateOa2pObject(doc)];
  },
});
