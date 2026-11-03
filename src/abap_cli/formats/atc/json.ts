/**
 * ATC configuration objects — local AFF documents.
 *
 * Three upstream abap-file-formats schemas, all pure JSON (no source sidecar):
 *   CHKC — ATC check category (`<name>.chkc.json`, `chkc-v1.json`)
 *   CHKO — ATC check          (`<name>.chko.json`, `chko-v1.json`)
 *   CHKV — ATC check variant  (`<name>.chkv.json`, `chkv-v1.json`)
 *
 * The local shapes mirror the vendored schemas 1:1. The ADT wire format is a
 * versioned XML envelope (`chkcv1` / `chkov1` / `chkvv4`), so the XML ↔ local
 * projection lives in `clients/atc.ts` next to the endpoint constants.
 *
 * AFF nuance worth keeping in one place: `chko.parameters[].hidden` is the
 * inverse of the wire's `parameterModifiable` flag, and `chko.checkType` is
 * the wire's `<chko:remoteEnabled>` boolean. Both mappings are applied in
 * `clients/atc.ts`, never in the flows.
 */
import { defineJsonArtifact, type JsonArtifact } from '../artifact.js';

/** AFF object type codes for the ATC configuration family. */
export const ATC_TYPES = ['CHKC', 'CHKO', 'CHKV'] as const;
export type AtcType = (typeof ATC_TYPES)[number];

/** True for CHKC / CHKO / CHKV. */
export function isAtcType(type: string | undefined): type is AtcType {
  return type !== undefined && (ATC_TYPES as readonly string[]).includes(type.toUpperCase());
}

/** Header shared by the three ATC AFF schemas (`ty_header_60_cloud`). */
export interface AtcHeader {
  description: string;
  originalLanguage: string;
  /** Omitted for standard objects; only cloud-development objects carry it. */
  abapLanguageVersion?: 'standard' | 'cloudDevelopment';
}

/** `chkc-v1.json` — ATC check category. */
export interface ChkcLocal {
  formatVersion: '1';
  header: AtcHeader;
  /** Parent category name, omitted for a root category. */
  parentCategory?: string;
}

/** `chko-v1.json` — ATC check. */
export type ChkoCheckType = 'local' | 'remoteEnabled';

export interface ChkoParameterLocal {
  name?: string;
  description?: string;
  /** AFF `hidden` ← wire `!parameterModifiable`. */
  hidden?: boolean;
}

export interface ChkoLocal {
  formatVersion: '1';
  header: AtcHeader;
  category: string;
  implementingClass: string;
  checkType?: ChkoCheckType;
  parameters?: ChkoParameterLocal[];
}

/** `chkv-v1.json` — ATC check variant. */
export interface ChkvRangeLocal {
  sign: 'include' | 'exclude';
  option:
    | 'equals'
    | 'between'
    | 'greaterThan'
    | 'containsPattern'
    | 'notEqual'
    | 'notBetween'
    | 'notContainsPattern'
    | 'greaterEqual'
    | 'lessThan'
    | 'lessEqual';
  low?: string;
  high?: string;
}

export interface ChkvParameterLocal {
  name: string;
  value?: string;
  structuredValue?: Array<{ field: string; value: string }>;
  structuredValueList?: Array<Array<{ field: string; value: string }>>;
  valueList?: string[];
  valueRangeList?: ChkvRangeLocal[];
}

export interface ChkvCheckLocal {
  checkName: string;
  parameters?: ChkvParameterLocal[];
}

export interface ChkvLocal {
  formatVersion: '1';
  header: AtcHeader;
  remoteEnabled?: boolean;
  selectedChecks: ChkvCheckLocal[];
}

/** Local document union for callers that are type-agnostic. */
export type AtcLocal = ChkcLocal | ChkoLocal | ChkvLocal;

/** `chkc-v1.json` artifact plumbing (validate against the vendored schema). */
export const chkcArtifact = defineJsonArtifact<ChkcLocal>({ type: 'CHKC' });
/** `chko-v1.json` artifact plumbing. */
export const chkoArtifact = defineJsonArtifact<ChkoLocal>({ type: 'CHKO' });
/** `chkv-v1.json` artifact plumbing. */
export const chkvArtifact = defineJsonArtifact<ChkvLocal>({ type: 'CHKV' });

/**
 * Per-type artifact lookup used by the create / pull / push flows.
 *
 * The three artifacts are narrowed per type for callers that know their type;
 * flows that accept any ATC type see the type-erased document contract (the
 * runtime artifact still validates against the concrete AFF schema).
 */
export function atcArtifactFor(type: AtcType): JsonArtifact<AtcLocal> {
  return (type === 'CHKC' ? chkcArtifact : type === 'CHKO' ? chkoArtifact : chkvArtifact) as unknown as JsonArtifact<AtcLocal>;
}
