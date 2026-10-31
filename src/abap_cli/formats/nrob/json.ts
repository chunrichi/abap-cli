/**
 * (B1): NROB (number range object) local ↔ wire mapping.
 *
 * The local shape mirrors the upstream `nrob-v1.json` AFF schema (vendored
 * under `src/abap_cli/schema/nrob-v1.json`):
 *   { formatVersion, header, interval, configuration }
 *
 * NROB has no abap-adt-api endpoint, so both read and write go through the
 * ICF fallback path (`/ddic/nrob`). The wire body is JSON with the same
 * shape as the local file (the ABAP side does the SAP `NRIV` translation).
 *
 * Note: the upstream `nrob-v1.json` schema is rich (interval sub-objects,
 * buffering mode enum, percent warning, sub-type binding). The CLI
 * intentionally uses a 1:1 pass-through for these fields — the local
 * `NrobLocal` shape is the JSON schema contract; the ABAP side decides how
 * to translate to NRIV. Validation runs against the upstream schema; tests
 * construct documents that match the required-field set.
 */
import { defineWireArtifact } from '../artifact.js';

export interface NrobIntervalLocal {
  /** Number length domain (e.g. ZNR_DOC_ID). Required by the AFF schema. */
  numberLengthDomain: string;
  /** Percent-warning threshold (0.1..99.9). Required. */
  percentWarning: number;
  /** Sub-type data element binding. Required. */
  subType: string;
  untilYear: boolean;
  rolling: boolean;
  prefix: boolean;
}

export interface NrobConfigurationLocal {
  /** Optional transaction code binding. */
  transactionId?: string;
  buffering: 'mainBuffer' | 'parallel' | 'none';
  bufferedNumbers: number;
}

export interface NrobLocal {
  formatVersion: '1';
  header: { description: string; originalLanguage: string };
  interval: NrobIntervalLocal;
  configuration: NrobConfigurationLocal;
}

export function wireToLocal(wire: Record<string, unknown>): NrobLocal {
  const header = (wire.header && typeof wire.header === 'object') ? wire.header as Record<string, unknown> : {};
  const interval = (wire.interval && typeof wire.interval === 'object') ? wire.interval as Record<string, unknown> : {};
  const configuration = (wire.configuration && typeof wire.configuration === 'object') ? wire.configuration as Record<string, unknown> : {};
  const bufferingRaw = String(configuration.buffering ?? 'mainBuffer');
  const buffering: NrobConfigurationLocal['buffering'] =
    bufferingRaw === 'mainBuffer' || bufferingRaw === 'parallel' || bufferingRaw === 'none' ? bufferingRaw : 'mainBuffer';
  return {
    formatVersion: '1',
    header: {
      description: String(header.description ?? ''),
      originalLanguage: String(header.originalLanguage ?? 'en').toLowerCase(),
    },
    interval: {
      numberLengthDomain: String(interval.numberLengthDomain ?? '').toUpperCase(),
      percentWarning: Number(interval.percentWarning ?? 10),
      subType: String(interval.subType ?? '').toUpperCase(),
      untilYear: interval.untilYear === true,
      rolling: interval.rolling !== false,
      prefix: interval.prefix !== false,
    },
    configuration: {
      ...(typeof configuration.transactionId === 'string' ? { transactionId: configuration.transactionId } : {}),
      buffering,
      bufferedNumbers: Number(configuration.bufferedNumbers ?? 10),
    },
  };
}

export function localToWire(local: NrobLocal): Record<string, unknown> {
  return {
    formatVersion: '1',
    header: local.header,
    interval: local.interval,
    configuration: local.configuration,
  };
}

/** NROB AFF artifact: file/schema plumbing + JSON wire mapping. */
export const nrobArtifact = defineWireArtifact<NrobLocal, Record<string, unknown>>({
  type: 'NROB',
  toWire: (local) => localToWire(local),
  fromWire: (wire) => wireToLocal(wire),
});
