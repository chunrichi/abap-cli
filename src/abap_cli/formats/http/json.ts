import { HTTP_TYPES, type HttpSupportedType } from '../../types/registry.js';
import { validateAffMetadata } from '../../aff/schema-validator.js';
import { stripCliEnvelope } from '../../aff/assert-metadata.js';
import { defineWireArtifact } from '../artifact.js';

// Known HTTP Service object extension.
export const HTTP_EXTENSIONS = ['.http.json'];

/** Re-exported from `types/registry.ts`. */
export { HTTP_TYPES, type HttpSupportedType };

/** `header` of a local HTTP Service document (abap-file-format http-v1). */
export interface HttpServiceHeader {
  description: string;
  originalLanguage: string;
  abapLanguageVersion?: 'standard' | 'cloudDevelopment';
}

/**
 * `header` of the wire payload. The ICF GET path additionally reports SICF
 * multi-language descriptions, which the abap-file-format schema does not
 * model and therefore must not be written to the local `<name>.http.json`.
 */
export interface HttpWireHeader extends HttpServiceHeader {
  descriptionByLang?: Array<{ language: string; description: string }>;
}

/**
 * `generalInformation` of a local HTTP Service document, as declared by the
 * vendored abap-file-format `http-v1.json` (upstream renamed the old `url`
 * member to `servicePath`).
 */
export interface HttpServiceGeneralInformation {
  handlerClass?: string;
  /** SICF service path (e.g. '/sap/zmy_service'). */
  servicePath?: string;
  /**
   * AFF flag for CSRF token handling. Accepted by the schema but not part of
   * the ICF wire contract (the deployed handler has no counterpart), so it is
   * local-only for now.
   */
  tokenHandling?: boolean;
}

/**
 * `generalInformation` of the wire payload for the ICF `/http/<name>` route.
 *
 * The deployed ABAP handler (`zcl_abap_vibe_icf_http` → `ty_http_service_data`)
 * deserializes the abap-file-format shape but still expects the old `url`
 * member; the AFF field that carries the same value is `servicePath`, so
 * {@link localToWire} / {@link wireToLocal} translate between the two.
 */
export interface HttpWireGeneralInformation {
  handlerClass?: string;
  /** ICF wire name for the AFF `servicePath` value. */
  url?: string;
  /** SICF node path reported by the ICF GET path (wire-only, never written). */
  serviceId?: string;
}

/** Wire payload accepted by the ICF `/http/<name>` route. */
export interface HttpServiceDefinition {
  formatVersion: '1';
  header: HttpWireHeader;
  generalInformation: HttpWireGeneralInformation;
  /** Local-only: object name (used by CLI / SICF envelope, not by ABAP). */
  name?: string;
  /** Local-only: package (CLI transport envelope). */
  package?: string;
  /** Local-only: transport request (CLI transport envelope). */
  transportRequest?: string;
  /** Pass-through for unknown fields (keeps SICF extensions alive). */
  [key: string]: unknown;
}

/**
 * Local `<name>.http.json` document.
 *
 * The canonical shape is the abap-file-format nested one (`header` +
 * `generalInformation`); the flat CLI form (`description` / `handlerClass` /
 * `servicePath` at the top level) stays accepted for hand-written files.
 *
 * SICF-only metadata (`serviceId`, `header.descriptionByLang[]`) is returned by
 * the ICF GET path but is deliberately *not* part of this document: the AFF
 * schema is `additionalProperties:false`, so writing those fields made a real
 * `pull HTTP` fail its own pre-write validation.
 */
export interface HttpObjectLocal {
  name?: string;
  description?: string;
  originalLanguage?: string;
  abapLanguageVersion?: 'standard' | 'cloudDevelopment';
  handlerClass?: string;
  servicePath?: string;
  formatVersion?: '1';
  header?: HttpServiceHeader;
  generalInformation?: HttpServiceGeneralInformation;
  package?: string;
  transportRequest?: string;
  [key: string]: unknown;
}

/** Wire payload type alias kept for the existing CLI / SICF integration layer. */
export type HttpWirePayload = HttpServiceDefinition;

/**
 * AFF HTTP service artifact: file plumbing plus the local↔wire mapping.
 *
 * The pre-write hook validates the AFF-shaped core (formatVersion / header /
 * generalInformation) so CLI-only transport fields (`name`, `package`,
 * `transportRequest`) — which the SAP schema explicitly rejects via
 * `additionalProperties:false` — do not block legitimate round-trips.
 */
export const httpArtifact = defineWireArtifact<HttpObjectLocal, HttpWirePayload>({
  type: 'HTTP',
  toWire: localToWire,
  fromWire: wireToLocal,
  validate: (doc) => validateHttpService(stripCliEnvelope(doc)),
  beforeWrite: (data) => {
    const errors = validateHttpService(stripCliEnvelope(data));
    if (errors.length > 0) {
      throw new Error(`AFF HTTP fixture invalid: ${errors.join('; ')}`);
    }
  },
});

/**
 * Validate an HTTP service document against the vendored AFF `http-v1.json`
 * schema. Returns an array of human-readable errors (empty when valid).
 *
 * delegates to `validateAffMetadata('HTTP'...)` instead of the
 * hand-rolled enum / length checks (which duplicated the schema and drifted).
 */
export function validateHttpService(data: unknown): string[] {
  return validateAffMetadata('HTTP', data);
}

/**
 * Convert a local HTTP object (read from .http.json) to the nested wire
 * payload the ICF handler deserializes. Accepts both the abap-file-format
 * nested shape ({ header, generalInformation }) and the flat CLI shape
 * (description / handlerClass at top level) for ergonomics.
 *
 * AFF `servicePath` → ICF wire `url` (see {@link HttpWireGeneralInformation}).
 * `tokenHandling` is not forwarded: the deployed handler has no such member.
 */
export function localToWire(local: HttpObjectLocal): HttpWirePayload {
  const l = local as Record<string, unknown>;
  const headerObj = (l.header && typeof l.header === 'object') ? (l.header as Record<string, unknown>) : undefined;
  const generalObj = (l.generalInformation && typeof l.generalInformation === 'object')
    ? (l.generalInformation as Record<string, unknown>)
    : undefined;

  const description = (l.description as string | undefined) ?? (headerObj?.description as string | undefined);
  const originalLanguage = (l.originalLanguage as string | undefined) ?? (headerObj?.originalLanguage as string | undefined);
  const abapLanguageVersion = (l.abapLanguageVersion as string | undefined) ?? (headerObj?.abapLanguageVersion as string | undefined);
  const handlerClass = (l.handlerClass as string | undefined) ?? (generalObj?.handlerClass as string | undefined);
  const servicePath = (l.servicePath as string | undefined) ?? (generalObj?.servicePath as string | undefined);

  const header: Record<string, unknown> = {};
  if (description !== undefined) header.description = description;
  if (originalLanguage !== undefined) header.originalLanguage = originalLanguage;
  if (abapLanguageVersion !== undefined) header.abapLanguageVersion = abapLanguageVersion;

  const generalInformation: Record<string, unknown> = {};
  if (handlerClass !== undefined) generalInformation.handlerClass = handlerClass;
  // The ICF handler deserializes the AFF shape but still names this member
  // `url`; keep the wire stable until the ABAP side adopts `servicePath`.
  if (servicePath !== undefined) generalInformation.url = servicePath;

  const wire: HttpWirePayload = {
    formatVersion: '1',
    header: header as unknown as HttpWirePayload['header'],
    generalInformation: generalInformation as unknown as HttpWirePayload['generalInformation'],
  };
  // Local-only envelope fields are forwarded only when present, so the wire
  // payload never carries explicit `undefined` keys.
  if (local.name !== undefined) wire.name = String(local.name).toUpperCase();
  if (l.package !== undefined) wire.package = l.package as string;
  if (l.transportRequest !== undefined) wire.transportRequest = l.transportRequest as string;
  return wire;
}

/**
 * Convert a wire payload (GET /http/<name> data) back to the local
 * abap-file-format shape (header / generalInformation nesting) so the file
 * written to disk matches the schema. GET data carries no `name` — callers
 * inject it from the requested object name.
 *
 * ICF wire `url` → AFF `servicePath` (see {@link HttpWireGeneralInformation}).
 */
export function wireToLocal(wire: HttpWirePayload): HttpObjectLocal {
  const w = wire as Record<string, unknown>;
  const headerObj = (w.header && typeof w.header === 'object') ? (w.header as Record<string, unknown>) : undefined;
  const generalObj = (w.generalInformation && typeof w.generalInformation === 'object')
    ? (w.generalInformation as Record<string, unknown>)
    : undefined;

  const header: Record<string, unknown> = {};
  if (headerObj?.description !== undefined) header.description = headerObj.description;
  if (headerObj?.originalLanguage !== undefined) header.originalLanguage = headerObj.originalLanguage;
  if (headerObj?.abapLanguageVersion !== undefined) header.abapLanguageVersion = headerObj.abapLanguageVersion;

  const generalInformation: Record<string, unknown> = {};
  if (generalObj?.handlerClass !== undefined) generalInformation.handlerClass = generalObj.handlerClass;
  if (generalObj?.url !== undefined) generalInformation.servicePath = generalObj.url;

  const local: HttpObjectLocal = {
    formatVersion: '1',
    header: header as unknown as HttpObjectLocal['header'],
    generalInformation: generalInformation as unknown as HttpObjectLocal['generalInformation'],
  };
  // `name` is the CLI envelope (stripped before AFF validation), not part of
  // the on-disk document; omit the key entirely when the wire has no name.
  if (w.name !== undefined) local.name = w.name as string;
  return local;
}

/**
 * Validate a local HTTP object against the abap-file-format contract.
 * Returns an array of human-readable errors (empty when valid).
 * Namespace rule: Z/Y/slash only (matches DDIC convention).
 *
 * @deprecated Use {@link validateHttpService} for the AFF-schema-based path.
 * This function is preserved because the existing CLI / SICF integration
 * layer depends on its specific error message shapes (e.g. "Missing required
 * field: name", "Invalid namespace"). New code should prefer
 * {@link validateHttpService}.
 */
export function validateHttpObject(data: HttpObjectLocal): string[] {
  const errors: string[] = [];
  if (!data.name) errors.push('Missing required field: name');

  // Namespace enforcement: Z/Y/slash (DDIC convention).
  const name = data.name ?? '';
  if (name && name[0] !== 'Z' && name[0] !== 'Y' && name[0] !== '/') {
    errors.push(`Invalid namespace: name must start with Z, Y, or / (got "${name}")`);
  }

  // Accept both flat and abap-file-format nested shapes.
  const l = data as Record<string, unknown>;
  const headerObj = (l.header && typeof l.header === 'object') ? (l.header as Record<string, unknown>) : undefined;
  const generalObj = (l.generalInformation && typeof l.generalInformation === 'object')
    ? (l.generalInformation as Record<string, unknown>)
    : undefined;

  const description = (l.description as string | undefined) ?? (headerObj?.description as string | undefined);
  const originalLanguage = (l.originalLanguage as string | undefined) ?? (headerObj?.originalLanguage as string | undefined);
  const servicePath = (l.servicePath as string | undefined) ?? (generalObj?.servicePath as string | undefined);

  if (!description) errors.push('HTTP service missing: description (header.description)');
  if (typeof description === 'string' && description.length > 60) {
    errors.push(`HTTP service description too long: maxLength 60 (got ${description.length})`);
  }
  if (!originalLanguage) errors.push('HTTP service missing: originalLanguage (header.originalLanguage)');
  if (!servicePath) errors.push('HTTP service missing: servicePath (generalInformation.servicePath)');

  // abapLanguageVersion is optional but if present must be one of the enum values.
  const abapLanguageVersion = (l.abapLanguageVersion as string | undefined) ?? (headerObj?.abapLanguageVersion as string | undefined);
  if (abapLanguageVersion !== undefined && abapLanguageVersion !== 'standard' && abapLanguageVersion !== 'cloudDevelopment') {
    errors.push(`Invalid abapLanguageVersion: must be "standard" or "cloudDevelopment" (got "${abapLanguageVersion}")`);
  }

  // handlerClass, when present, must be a valid object name (max 30 chars; from zif_aff_types_v1).
  const handlerClass = (l.handlerClass as string | undefined) ?? (generalObj?.handlerClass as string | undefined);
  if (handlerClass !== undefined) {
    if (typeof handlerClass !== 'string' || handlerClass.length === 0) {
      errors.push('HTTP service handlerClass must be a non-empty string');
    } else if (handlerClass.length > 30) {
      errors.push(`HTTP service handlerClass too long: maxLength 30 (got ${handlerClass.length})`);
    }
  }

  return errors;
}
