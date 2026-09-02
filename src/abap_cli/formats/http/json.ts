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
 * ICF wire representation (camelCase, transport envelope).
 * Mirrors the JSON the SAP-side handler will deserialize.
 *
 * 032 US10: SICF extension fields (`serviceId` / `descriptionByLang`) are
 * SAP wire conventions that the CLI must round-trip even though they're
 * not in the abap-file-format http-v1.json schema. The CLI extends
 * `generalInformation` and `header` at runtime to carry them.
 */
export interface HttpWirePayload {
  name: string;
  description?: string;
  originalLanguage?: string;
  abapLanguageVersion?: string;
  handlerClass?: string;
  url?: string;
  /** 032 US10: SICF service path on the wire (server-side node path). */
  serviceId?: string;
  /** 032 US10: multi-language descriptions on the wire. */
  descriptionByLang?: Array<{ language: string; description: string }>;
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
 * Convert a local HTTP object (read from .http.json) to wire payload.
 * Accepts both the abap-file-format nested shape ({ header, generalInformation })
 * and the flat CLI shape (description at top level) for ergonomics.
 */
export function localToWire(local: HttpObjectLocal): HttpWirePayload {
  const l = local as Record<string, unknown>;
  // abap-file-format places the description under header.description; the flat CLI
  // convention puts it at the top level. Accept both so the CLI accepts either shape.
  const headerObj = (l.header && typeof l.header === 'object') ? (l.header as Record<string, unknown>) : undefined;
  const generalObj = (l.generalInformation && typeof l.generalInformation === 'object')
    ? (l.generalInformation as Record<string, unknown>)
    : undefined;

  const description = (l.description as string | undefined) ?? (headerObj?.description as string | undefined);
  const originalLanguage = (l.originalLanguage as string | undefined) ?? (headerObj?.originalLanguage as string | undefined);
  const abapLanguageVersion = (l.abapLanguageVersion as string | undefined) ?? (headerObj?.abapLanguageVersion as string | undefined);
  const handlerClass = (l.handlerClass as string | undefined) ?? (generalObj?.handlerClass as string | undefined);
  const url = (l.url as string | undefined) ?? (generalObj?.url as string | undefined);
  // 032 US10: SICF extension fields — read from nested generalInformation/header
  // (preferred, abap-file-format consistent) or top-level flat (legacy fallback).
  const serviceId = (l.serviceId as string | undefined) ?? (generalObj?.serviceId as string | undefined);
  const descByLangRaw = (l.descriptionByLang as Array<{ language: string; description: string }> | undefined)
    ?? (headerObj?.descriptionByLang as Array<{ language: string; description: string }> | undefined);

  return {
    name: String(local.name).toUpperCase(),
    description,
    originalLanguage,
    abapLanguageVersion,
    handlerClass,
    url,
    serviceId,
    descriptionByLang: descByLangRaw,
    package: l.package as string | undefined,
    transportRequest: l.transportRequest as string | undefined,
  };
}

/**
 * Convert a wire payload back to local abap-file-format shape.
 * Used to normalize the GET response so the file written to disk matches the
 * abap-file-format schema (header / generalInformation nesting).
 */
export function wireToLocal(wire: HttpWirePayload): HttpObjectLocal {
  const header: Record<string, unknown> = {};
  if (wire.description !== undefined) header.description = wire.description;
  if (wire.originalLanguage !== undefined) header.originalLanguage = wire.originalLanguage;
  if (wire.abapLanguageVersion !== undefined) header.abapLanguageVersion = wire.abapLanguageVersion;

  const generalInformation: Record<string, unknown> = {};
  if (wire.handlerClass !== undefined) generalInformation.handlerClass = wire.handlerClass;
  if (wire.url !== undefined) generalInformation.url = wire.url;
  // 032 US10: SICF serviceId → nested generalInformation.serviceId
  // (abap-file-format consistent location; not in schema but required by SAP wire).
  if (wire.serviceId !== undefined) generalInformation.serviceId = wire.serviceId;

  // 032 US10: multi-language descriptions → nested header.descriptionByLang[].
  // Each entry is `{ language, description }` — both required per SAP wire.
  if (wire.descriptionByLang !== undefined && wire.descriptionByLang.length > 0) {
    header.descriptionByLang = wire.descriptionByLang;
  }

  const local: HttpObjectLocal = {
    name: wire.name,
    formatVersion: '1',
    header,
    generalInformation,
  };
  return local;
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
