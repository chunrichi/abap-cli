/**
 * Application job AFF documents — SAJC (catalog entry) and SAJT (template).
 *
 * The local files are the upstream abap-file-formats v1 documents:
 *   SAJC  `<name>.sajc.json` — Application Job Catalog Entry
 *   SAJT  `<name>.sajt.json` — Application Job Template
 *
 * Both are single JSON documents carried over the ADT blueSource resources
 * (`/sap/bc/adt/applicationjob/{catalogs,templates}`): `source/main` *is* the
 * JSON object, not a `.acds`/`.abap` source sidecar. The wire representation of
 * a given SAP release may differ from the AFF document (older releases serve
 * flat className/reportName documents); that translation lives in
 * `wire.ts` so the local files always stay AFF-conformant.
 */
import { defineJsonArtifact, type JsonArtifact } from '../artifact.js';

/** AFF object type codes for the application-job group. */
export const APPJOB_TYPES = ['SAJC', 'SAJT'] as const;
export type AppJobType = (typeof APPJOB_TYPES)[number];

/** True for SAJC / SAJT. */
export function isAppJobType(type: string | undefined): type is AppJobType {
  return type !== undefined && (APPJOB_TYPES as readonly string[]).includes(type.toUpperCase());
}

/** Header shared by both AFF application-job schemas. */
export interface AppJobHeader {
  description: string;
  originalLanguage: string;
  /** `standard` is the schema default and is normally omitted on the wire. */
  abapLanguageVersion?: 'standard' | 'cloudDevelopment';
}

/** Selection-screen section of a catalog entry. */
export interface SajcSection {
  name: string;
  title: string;
}

/** Selection-screen group of a catalog entry. */
export interface SajcGroup {
  name: string;
  title: string;
  section?: string;
}

/** Parameter of the executed class, honest subset of `sajc-v1.json`. */
export interface SajcParameter {
  name: string;
  title?: string;
  group?: string;
  indented?: boolean;
  mandatory?: boolean;
  hidden?: boolean;
  readOnly?: boolean;
  enabledByParameter?: string;
  screenElement?: 'none' | 'checkbox' | 'radioButton' | 'listBox';
  radioButtonGroup?: string;
  valueHelp?: string;
  valueHelpType?: 'none' | 'cdsView' | 'domain';
  backendCall?: boolean;
  singleValues?: boolean;
  textEditorLines?: number;
}

/** `sajc-v1.json` — application job catalog entry. */
export interface SajcLocal {
  formatVersion: '1';
  header: AppJobHeader;
  generalInformation: {
    /** Class containing the execute method; may be empty for report-based entries. */
    className: string;
    programName?: string;
  };
  exitClasses?: {
    check?: string;
    valueHelp?: string;
    notification?: string;
  };
  sections?: SajcSection[];
  groups?: SajcGroup[];
  parameters?: SajcParameter[];
}

/** One row of a parameter ranges table. */
export interface SajtValueRange {
  sign: 'include' | 'exclude';
  option?:
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

/** Parameter with one or more value ranges. */
export interface SajtValueRangesParameter {
  name: string;
  valueRanges: SajtValueRange[];
}

/** Parameter with a single value. */
export interface SajtSingleValueParameter {
  name: string;
  value: string;
}

/** `sajt-v1.json` — application job template. */
export interface SajtLocal {
  formatVersion: '1';
  header: AppJobHeader;
  generalInformation: {
    catalogName: string;
  };
  parameters?: {
    singleValueParameters?: SajtSingleValueParameter[];
    valueRangesParameters?: SajtValueRangesParameter[];
  };
}

/** Local document union for callers that are type-agnostic. */
export type AppJobLocal = SajcLocal | SajtLocal;

/** `sajc-v1.json` artifact plumbing. */
export const sajcArtifact = defineJsonArtifact<SajcLocal>({ type: 'SAJC' });
/** `sajt-v1.json` artifact plumbing. */
export const sajtArtifact = defineJsonArtifact<SajtLocal>({ type: 'SAJT' });

/** Per-type artifact lookup used by the create / pull / push flows. */
export function appjobArtifactFor(type: AppJobType): JsonArtifact<AppJobLocal> {
  return (type === 'SAJC' ? sajcArtifact : sajtArtifact) as unknown as JsonArtifact<AppJobLocal>;
}
