import * as fs from 'fs/promises';
import * as path from 'path';
import { HTTP_SUPPORTED_TYPES, type HttpSupportedType } from '../../types/registry.js';
import { validateAffMetadata } from '../../aff/schema-validator.js';
import { stripCliEnvelope } from '../../aff/assert-metadata.js';

// Known HTTP Service object extension.
export const HTTP_EXTENSIONS = ['.http.json'];

/** Re-exported from `types/registry.ts` (T049, US11). */
export { HTTP_SUPPORTED_TYPES, type HttpSupportedType };

/**
 * T2.2: AFF-shaped HTTP service definition (matches `http-v1.json` schema).
 *
 * This is the canonical abap-file-format HTTP shape. The
 * `readHttpService` / `writeHttpService` / `validateHttpService` API
 * round-trips this shape and validates against the vendored SAP schema.
 *
 * The richer {@link HttpObjectLocal} (carrying SICF extension fields like
 * `serviceId` / `descriptionByLang`) is preserved as a deprecated alias
 * because the existing CLI / SICF integration layer still depends on its
 * transport envelope and name handling.
 */
export interface HttpServiceHeader {
  description: string;
  originalLanguage: string;
  abapLanguageVersion?: 'standard' | 'cloudDevelopment';
  /** SICF multi-language descriptions (not in abap-file-format schema). */
  descriptionByLang?: Array<{ language: string; description: string }>;
}

export interface HttpServiceGeneralInformation {
  handlerClass?: string;
  url?: string;
  /** SICF service path (e.g. '/sap/zfoo'); not in abap-file-format schema. */
  serviceId?: string;
}

export interface HttpServiceDefinition {
  formatVersion: '1';
  header: HttpServiceHeader;
  generalInformation: HttpServiceGeneralInformation;
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
 * @deprecated Use {@link HttpServiceDefinition} directly. Kept as a separate
 * (broader) alias because the CLI / SICF integration layer treats HTTP
 * local files as a permissive record (accepts both the AFF nested shape and
 * a flat shape where `description` / `handlerClass` live at the top level).
 * `HttpObjectLocal` keeps the legacy shape; `HttpServiceDefinition` is the
 * strict AFF-shaped core.
 */
export interface HttpObjectLocal {
  name?: string;
  description?: string;
  originalLanguage?: string;
  abapLanguageVersion?: 'standard' | 'cloudDevelopment';
  handlerClass?: string;
  url?: string;
  /** 032 US10: SICF service path (e.g. '/sap/zfoo'); not in abap-file-format schema. */
  serviceId?: string;
  /** 032 US10: multi-language descriptions (one entry per language). */
  descriptionByLang?: Array<{ language: string; description: string }>;
  formatVersion?: '1';
  header?: HttpServiceHeader;
  generalInformation?: HttpServiceGeneralInformation;
  package?: string;
  transportRequest?: string;
  [key: string]: unknown;
}

/**
 * @deprecated Wire shape is identical to the local AFF shape since T059
 * (the ICF handler deserializes the nested abap-file-format directly).
 * Kept as an alias for downstream consumers that still import the name.
 */
export type HttpWirePayload = HttpServiceDefinition;

/**
 * Read a HTTP service JSON file from disk. Returns the permissive
 * {@link HttpObjectLocal} shape so callers can accept both nested
 * (AFF) and flat (CLI) layouts without runtime checks.
 */
export async function readHttpService(filePath: string): Promise<HttpObjectLocal> {
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content) as HttpObjectLocal;
}

/**
 * Legacy alias for {@link readHttpService}.
 * @deprecated
 */
export const readHttpJson = readHttpService;

/**
 * Write a HTTP service JSON file to disk, validating against the AFF
 * `http-v1.json` schema before writing. Throws on schema violation.
 *
 * The validator is applied to the AFF-shaped core (formatVersion / header /
 * generalInformation) so CLI-only transport fields (`name`, `package`,
 * `transportRequest`) — which the SAP schema explicitly rejects via
 * `additionalProperties:false` — do not block legitimate round-trips.
 */
export async function writeHttpService(filePath: string, data: HttpObjectLocal): Promise<void> {
  const errors = validateHttpService(stripCliEnvelope(data));
  if (errors.length > 0) {
    throw new Error(`AFF HTTP fixture invalid: ${errors.join('; ')}`);
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

/**
 * Legacy alias for {@link writeHttpService}.
 * @deprecated
 */
export const writeHttpJson = writeHttpService;

/**
 * Validate an HTTP service document against the vendored AFF `http-v1.json`
 * schema. Returns an array of human-readable errors (empty when valid).
 *
 * T2.2: delegates to `validateAffMetadata('HTTP', ...)` instead of the
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
  const url = (l.url as string | undefined) ?? (generalObj?.url as string | undefined);
  // 032 US10: SICF extension fields — nested (preferred) or top-level flat (legacy fallback).
  const serviceId = (l.serviceId as string | undefined) ?? (generalObj?.serviceId as string | undefined);
  const descByLangRaw = (l.descriptionByLang as Array<{ language: string; description: string }> | undefined)
    ?? (headerObj?.descriptionByLang as Array<{ language: string; description: string }> | undefined);

  const header: Record<string, unknown> = {};
  if (description !== undefined) header.description = description;
  if (originalLanguage !== undefined) header.originalLanguage = originalLanguage;
  if (abapLanguageVersion !== undefined) header.abapLanguageVersion = abapLanguageVersion;
  if (descByLangRaw !== undefined && descByLangRaw.length > 0) header.descriptionByLang = descByLangRaw;

  const generalInformation: Record<string, unknown> = {};
  if (handlerClass !== undefined) generalInformation.handlerClass = handlerClass;
  if (url !== undefined) generalInformation.url = url;
  if (serviceId !== undefined) generalInformation.serviceId = serviceId;

  const wire: HttpWirePayload = {
    name: local.name !== undefined ? String(local.name).toUpperCase() : undefined,
    formatVersion: '1',
    header: header as unknown as HttpWirePayload['header'],
    generalInformation: generalInformation as HttpWirePayload['generalInformation'],
  };
  // Transport envelope: carried at the top level of the local file.
  if (l.package !== undefined) wire.package = l.package as string;
  if (l.transportRequest !== undefined) wire.transportRequest = l.transportRequest as string;
  return wire;
}

/**
 * Convert a wire payload (GET /http/<name> data) back to the local
 * abap-file-format shape (header / generalInformation nesting) so the file
 * written to disk matches the schema. GET data carries no `name` — callers
 * inject it from the requested object name.
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
  if (Array.isArray(headerObj?.descriptionByLang) && (headerObj?.descriptionByLang as unknown[]).length > 0) {
    header.descriptionByLang = headerObj.descriptionByLang;
  }

  const generalInformation: Record<string, unknown> = {};
  if (generalObj?.handlerClass !== undefined) generalInformation.handlerClass = generalObj.handlerClass;
  if (generalObj?.url !== undefined) generalInformation.url = generalObj.url;
  if (generalObj?.serviceId !== undefined) generalInformation.serviceId = generalObj.serviceId;

  return {
    name: w.name as string | undefined,
    formatVersion: '1',
    header: header as unknown as HttpObjectLocal['header'],
    generalInformation: generalInformation as HttpObjectLocal['generalInformation'],
  };
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

  if (!description) errors.push('HTTP service missing: description (header.description)');
  if (typeof description === 'string' && description.length > 60) {
    errors.push(`HTTP service description too long: maxLength 60 (got ${description.length})`);
  }
  if (!originalLanguage) errors.push('HTTP service missing: originalLanguage (header.originalLanguage)');

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
