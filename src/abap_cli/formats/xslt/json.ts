/**
 * XSLT (transformation program) local ↔ wire mapping.
 *
 * Local layout is the abap-file-format pair:
 *   <name>.xslt.json  — AFF metadata (formatVersion + header only)
 *   <name>.xslt.xml   — the XSLT program source, 1:1
 *
 * The wire document is the self-built ICF `/xslt/<name>` payload:
 *   GET  → { status, data: { name, description, originalLanguage, source, package } }
 *   POST → { name, header: { description, originalLanguage }, source,
 *            package?, transportRequest? }
 *
 * Line endings: `CL_O2_API_XSLTDESC->get_source_string()` joins the internal
 * line table with CRLF and appends one, so SAP read-back is not byte-identical
 * to what was written. `normalizeXsltSource()` is the single normaliser used by
 * pull comparison, push/get payload building and create input, so the whole
 * feature agrees on one canonical form (LF, no trailing line break).
 */
import { defineJsonArtifact } from '../artifact.js';

export const XSLT_EXTENSIONS = ['.xslt.json', '.xslt.xml'] as const;

/** AFF `xslt-v1.json` header (the only required grouping). */
export interface XsltHeader {
  description: string;
  originalLanguage: string;
}

/**
 * Local abap-file-format document.
 *
 * `header` is the whole AFF contract for xslt-v1; `generalInformation` is
 * declared by the upstream schema but not used by abap-cli (only XSLT
 * programs are supported, simple transformations are out of scope), so it is
 * kept optional and never written.
 */
export interface XsltLocal {
  formatVersion: '1';
  header: XsltHeader;
  generalInformation?: { transformationType?: string };
}

/** ICF wire payload shared by GET data and POST body. */
export interface XsltWirePayload {
  name: string;
  header: XsltHeader;
  source: string;
  /** Transport envelope — top-level only, not part of the AFF document. */
  package?: string;
  transportRequest?: string;
}

/** Wire `data` returned by GET `/xslt/<name>`. */
export interface XsltWireData {
  name: string;
  description: string;
  originalLanguage: string;
  source: string;
  package?: string;
}

/**
 * Collapse the SAP source form to the canonical local form: LF line endings,
 * no trailing line breaks, no CR. Idempotent.
 */
export function normalizeXsltSource(source: string): string {
  return source.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n+$/, '');
}

/** Local XML file content for a canonical source (trailing newline only). */
export function xsltSourceFileContent(source: string): string {
  const normalized = normalizeXsltSource(source);
  return normalized === '' ? '' : `${normalized}\n`;
}

/** Whether two source strings are the same transformation after normalisation. */
export function sameXsltSource(a: string, b: string): boolean {
  return normalizeXsltSource(a) === normalizeXsltSource(b);
}

/** Convert the pulled wire document to the local AFF shape. */
export function wireToLocal(wire: XsltWireData): XsltLocal {
  const originalLanguage = (wire.originalLanguage ?? '').trim().toUpperCase();
  return {
    formatVersion: '1',
    header: {
      description: wire.description ?? '',
      originalLanguage: originalLanguage.length >= 2 ? originalLanguage : 'EN',
    },
  };
}

/** Build the ICF write payload from the local document + companion source. */
export function localToWire(
  local: XsltLocal,
  source: string,
  envelope: { name: string; package?: string; transportRequest?: string },
): XsltWirePayload {
  const wire: XsltWirePayload = {
    name: envelope.name.toUpperCase(),
    header: {
      description: local.header?.description ?? '',
      originalLanguage: local.header?.originalLanguage ?? 'EN',
    },
    source: normalizeXsltSource(source),
  };
  if (envelope.package) wire.package = envelope.package;
  if (envelope.transportRequest) wire.transportRequest = envelope.transportRequest;
  return wire;
}

/**
 * AFF JSON artifact plumbing (read/write/validate against `xslt-v1.json`).
 * The companion `.xslt.xml` is read/written by `companion.ts`; the artifact
 * only owns the metadata document.
 */
export const xsltArtifact = defineJsonArtifact<XsltLocal>({
  type: 'XSLT',
});
