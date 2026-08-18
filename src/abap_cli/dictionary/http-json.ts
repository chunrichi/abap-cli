import * as fs from 'fs/promises';
import * as path from 'path';

// Known HTTP Service object extension.
export const HTTP_EXTENSIONS = ['.http.json'];

/** HTTP service is the single type this CLI can create/pull via the ICF route. */
export const HTTP_SUPPORTED_TYPES = ['HTTP'] as const;
export type HttpSupportedType = (typeof HTTP_SUPPORTED_TYPES)[number];

/**
 * 022: local abap-file-format HTTP representation (snake_case / nested).
 * Mirrors `zif_aff_http_v1.intf.abap`:
 *   ty_main  → { formatVersion, header, generalInformation }
 *   header   → { description, originalLanguage, abapLanguageVersion? }
 *   generalInformation → { handlerClass, url }
 */
export interface HttpObjectLocal {
  name: string;
  description?: string;
  originalLanguage?: string;
  abapLanguageVersion?: 'standard' | 'cloudDevelopment';
  handlerClass?: string;
  url?: string;
  [key: string]: unknown;
}

/**
 * 022: ICF wire representation (camelCase, transport envelope).
 * Mirrors the JSON the SAP-side handler will deserialize.
 */
export interface HttpWirePayload {
  name: string;
  description?: string;
  originalLanguage?: string;
  abapLanguageVersion?: string;
  handlerClass?: string;
  url?: string;
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

  return {
    name: String(local.name).toUpperCase(),
    description,
    originalLanguage,
    abapLanguageVersion,
    handlerClass,
    url,
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
 * Namespace rule: Z/Y/slash only (matches FR-004 and DDIC convention).
 */
export function validateHttpObject(data: HttpObjectLocal): string[] {
  const errors: string[] = [];
  if (!data.name) errors.push('Missing required field: name');

  // Namespace enforcement: Z/Y/slash (matches DDIC FR-004).
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
