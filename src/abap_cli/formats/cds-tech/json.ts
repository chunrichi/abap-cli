/**
 * CDS technical objects — local AFF documents.
 *
 * Four upstream abap-file-formats schemas:
 *   DTDC — Dynamic Cache           (`<name>.dtdc.json` + `.dtdc.acds`)
 *   DTEB — CDS Entity Buffer       (`<name>.dteb.json` + `.dteb.acds`)
 *   DSFD — Scalar Function Def.    (`<name>.dsfd.json` + `.dsfd.acds`)
 *   DSFI — Scalar Function Impl.   (`<name>.dsfi.json`, single JSON document)
 *
 * The three source-bearing types follow the DDLS layout: a header-only AFF
 * metadata document plus an `.acds` sidecar carrying the CDS source. DSFI has
 * no sidecar — the ADT resource's `source/main` *is* the AFF JSON, so the local
 * document and the wire body are the same shape (after normalising the empty
 * `abapLanguageVersion` SAP writes).
 */
import { defineJsonArtifact, type JsonArtifact } from '../artifact.js';

/** AFF object type codes for the CDS technical group. */
export const CDS_TECH_TYPES = ['DTDC', 'DTEB', 'DSFD', 'DSFI'] as const;
export type CdsTechType = (typeof CDS_TECH_TYPES)[number];

/** True for DTDC / DTEB / DSFD / DSFI. */
export function isCdsTechType(type: string | undefined): type is CdsTechType {
  return type !== undefined && (CDS_TECH_TYPES as readonly string[]).includes(type.toUpperCase());
}

/** Header shared by the four CDS technical AFF schemas. */
export interface CdsTechHeader {
  description: string;
  originalLanguage: string;
  /**
   * Omitted for standard objects. DTDC/DSFD/DSFI also allow `keyUser`;
   * DTEB only allows `standard` / `cloudDevelopment` (per its schema).
   */
  abapLanguageVersion?: 'standard' | 'keyUser' | 'cloudDevelopment';
}

/** `dtdc-v1.json` — dynamic cache (metadata only; source in the `.acds`). */
export interface DtdcLocal {
  formatVersion: '1';
  header: CdsTechHeader;
}

/** `dteb-v1.json` — CDS entity buffer (metadata only; source in the `.acds`). */
export interface DtebLocal {
  formatVersion: '1';
  header: CdsTechHeader;
}

/** `dsfd-v1.json` — scalar function definition (metadata + `.acds` source). */
export interface DsfdLocal {
  formatVersion: '1';
  header: CdsTechHeader;
}

/** `dsfi-v1.json` — scalar function implementation reference (single JSON). */
export interface DsfiSqlPropertiesLocal {
  /** AMDP implementation reference, e.g. `ZCL_DSFI_EXAMPLE=>EXECUTE`. */
  amdpReference: string;
  autoExposedInSqlServices?: boolean;
}

export type DsfiEngineLocal = 'analyticalEngine' | 'sqlEngine';

export interface DsfiLocal {
  formatVersion: '1';
  header: CdsTechHeader;
  scalarFunctionName: string;
  /** Defaults to `analyticalEngine` in the AFF schema. */
  engine?: DsfiEngineLocal;
  /** Required by the schema when `engine` is `sqlEngine`. */
  sqlProperties?: DsfiSqlPropertiesLocal;
}

/** Local document union for callers that are type-agnostic. */
export type CdsTechLocal = DtdcLocal | DtebLocal | DsfdLocal | DsfiLocal;

/** `dtdc-v1.json` artifact plumbing. */
export const dtdcArtifact = defineJsonArtifact<DtdcLocal>({ type: 'DTDC' });
/** `dteb-v1.json` artifact plumbing. */
export const dtebArtifact = defineJsonArtifact<DtebLocal>({ type: 'DTEB' });
/** `dsfd-v1.json` artifact plumbing. */
export const dsfdArtifact = defineJsonArtifact<DsfdLocal>({ type: 'DSFD' });
/** `dsfi-v1.json` artifact plumbing. */
export const dsfiArtifact = defineJsonArtifact<DsfiLocal>({ type: 'DSFI' });

/** Per-type artifact lookup used by the create / pull / push flows. */
export function cdsTechArtifactFor(type: CdsTechType): JsonArtifact<CdsTechLocal> {
  return (
    type === 'DTDC'
      ? dtdcArtifact
      : type === 'DTEB'
        ? dtebArtifact
        : type === 'DSFD'
          ? dsfdArtifact
          : dsfiArtifact
  ) as unknown as JsonArtifact<CdsTechLocal>;
}

/** True when the type carries an `.acds` source sidecar. */
export function hasCdsSourceSidecar(type: CdsTechType): boolean {
  return type !== 'DSFI';
}
