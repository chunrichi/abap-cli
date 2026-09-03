import * as fs from 'fs/promises';
import * as path from 'path';
import { HTTP_SUPPORTED_TYPES, type HttpSupportedType } from '../../types/registry.js';

// Known HTTP Service object extension.
export const HTTP_EXTENSIONS = ['.http.json'];

/** Re-exported from `types/registry.ts` (T049, US11). */
export { HTTP_SUPPORTED_TYPES, type HttpSupportedType };

/**
 * Local abap-file-format HTTP representation (snake_case / nested).
 * Mirrors `zif_aff_http_v1.intf.abap`:
 *   ty_main  → { formatVersion, header, generalInformation }
 *   header   → { description, originalLanguage, abapLanguageVersion? }
 *   generalInformation → { handlerClass, url }
 *
 * 032 US10: SICF extension fields carried by SAP wire but not in
 * abap-file-format http-v1.json schema:
 *   generalInformation.serviceId — SICF node path (e.g. '/sap/zfoo')
 *   header.descriptionByLang[]   — multi-language descriptions
 *                                  [{ language: 'EN', description: '...' }, ...]
 */
export interface HttpObjectLocal {
  name: string;
  description?: string;
  originalLanguage?: string;
  abapLanguageVersion?: 'standard' | 'cloudDevelopment';
  handlerClass?: string;
  url?: string;
  /** 032 US10: SICF service path (e.g. '/sap/zfoo'); not in abap-file-format schema. */
  serviceId?: string;
  /** 032 US10: multi-language descriptions (one entry per language). */
  descriptionByLang?: Array<{ language: string; description: string }>;
  [key: string]: unknown;
}

/**
 * ICF wire representation — the JSON body the self-built ICF handler
 * (`zcl_abap_vibe_icf` → `dispatch_http`) deserializes on POST and
 * serializes on GET.
 *
 * The wire IS the nested abap-file-format HTTP shape (camelCase), matching
 * `zif_aff_http_v1.intf.abap`:
 *   { formatVersion: '1', header: {...}, generalInformation: {...} }
 * A flat CLI envelope was the historical wire bug (T059): ABAP deserializes
 * into `ty_http_service_data`, so flat fields never mapped and create always
 * failed with `HTTP_SERVICE_INVALID`.
 *
 * GET data has no `name`/`package`/`transportRequest` (not structure
 * members); POST adds the transport envelope at top level (`package` is
 * ignored by the ABAP structure, `transportRequest` is regex-extracted by
 * dispatch_http).
 *
 * 032 US10: SICF extensions the CLI round-trips but ABAP 0.5.0 does NOT
 * persist / return (see known gaps in wiki/objects/http.md):
 *   generalInformation.serviceId — SICF node path (e.g. '/sap/zfoo')
 *   header.descriptionByLang[]   — multi-language descriptions
 *                                  [{ language: 'EN', description: '...' }, ...]
 */
export interface HttpWirePayload {
  /** SICF node name; uppercased from the local file on POST. */
  name?: string;
  formatVersion?: '1';
  header?: {
    description?: string;
    originalLanguage?: string;
    abapLanguageVersion?: 'standard' | 'cloudDevelopment';
    descriptionByLang?: Array<{ language: string; description: string }>;
  };
  generalInformation?: {
    handlerClass?: string;
    url?: string;
    serviceId?: string;
  };
  /** POST transport envelope — not part of the abap-file-format schema. */
  package?: string;
  transportRequest?: string;
}

/**
 * Read a HTTP Service JSON file from disk.
 */
export async function readHttpJson(filePath: string): Promise<HttpObjectLocal> {
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content) as HttpObjectLocal;
}

/**
 * Write a HTTP Service JSON file to disk, creating parent directories as needed.
 */
export async function writeHttpJson(filePath: string, data: HttpObjectLocal): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
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
    header: header as HttpWirePayload['header'],
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
    name: w.name as string,
    formatVersion: '1',
    header: header as HttpObjectLocal['header'],
    generalInformation: generalInformation as HttpObjectLocal['generalInformation'],
  };
}

/**
 * Validate a local HTTP object against the abap-file-format contract.
 * Returns an array of human-readable errors (empty when valid).
 * Namespace rule: Z/Y/slash only (matches DDIC convention).
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
