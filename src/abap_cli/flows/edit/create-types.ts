import type { CreatableTypeIds } from 'abap-adt-api';
import { DDIC_SUPPORTED_TYPES } from '../../formats/ddic/json.js';
import { HTTP_SUPPORTED_TYPES } from '../../formats/http/json.js';
import { TRAN_SUPPORTED_TYPES } from '../../formats/transport/json.js';

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

// DDIC types created via the self-built ICF service. TTYP is deferred (Q2).
export const DDIC_TYPES = new Set<string>(DDIC_SUPPORTED_TYPES);

// HTTP service (SICF node) created via the self-built ICF service.
export const HTTP_TYPES = new Set<string>(HTTP_SUPPORTED_TYPES);

// Transaction code (SE93) created via the self-built ICF service.
export const TRAN_TYPES = new Set<string>(TRAN_SUPPORTED_TYPES);

/** Narrow an arbitrary type string to the supported DDIC types. */
export function isDdicSupportedType(t: string): t is (typeof DDIC_SUPPORTED_TYPES)[number] {
  return (DDIC_SUPPORTED_TYPES as readonly string[]).includes(t);
}

/** 022: narrow an arbitrary type string to the supported HTTP types. */
export function isHttpSupportedType(t: string): t is (typeof HTTP_SUPPORTED_TYPES)[number] {
  return (HTTP_SUPPORTED_TYPES as readonly string[]).includes(t);
}

/** Narrow an arbitrary type string to the supported Transaction types. */
export function isTranSupportedType(t: string): t is (typeof TRAN_SUPPORTED_TYPES)[number] {
  return (TRAN_SUPPORTED_TYPES as readonly string[]).includes(t);
}
