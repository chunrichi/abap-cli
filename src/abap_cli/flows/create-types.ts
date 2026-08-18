import type { CreatableTypeIds } from 'abap-adt-api';
import { DDIC_SUPPORTED_TYPES } from '../dictionary/ddic-json.js';
import { HTTP_SUPPORTED_TYPES } from '../dictionary/http-json.js';

export interface CreateTypeSpec {
  objtype: CreatableTypeIds;
}

// User-facing type → ADT objtype (abap-file-format compliant).
export const TYPE_MAP: Record<string, CreateTypeSpec> = {
  CLAS: { objtype: 'CLAS/OC' },
  INTF: { objtype: 'INTF/OI' },
  PROG: { objtype: 'PROG/P' },
  FUGR: { objtype: 'FUGR/F' },
};

// 014: DDIC types created via the self-built ICF service. TTYP is deferred (Q2).
export const DDIC_TYPES = new Set<string>(DDIC_SUPPORTED_TYPES);

// 022: HTTP service (SICF node) created via the self-built ICF service.
export const HTTP_TYPES = new Set<string>(HTTP_SUPPORTED_TYPES);

/** 014: narrow an arbitrary type string to the supported DDIC types. */
export function isDdicSupportedType(t: string): t is (typeof DDIC_SUPPORTED_TYPES)[number] {
  return (DDIC_SUPPORTED_TYPES as readonly string[]).includes(t);
}

/** 022: narrow an arbitrary type string to the supported HTTP types. */
export function isHttpSupportedType(t: string): t is (typeof HTTP_SUPPORTED_TYPES)[number] {
  return (HTTP_SUPPORTED_TYPES as readonly string[]).includes(t);
}
