import type { CreatableTypeIds } from 'abap-adt-api';
import { DDIC_SUPPORTED_TYPES } from '../dictionary/ddic-json.js';

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

/** 014: narrow an arbitrary type string to the supported DDIC types. */
export function isDdicSupportedType(t: string): t is (typeof DDIC_SUPPORTED_TYPES)[number] {
  return (DDIC_SUPPORTED_TYPES as readonly string[]).includes(t);
}
