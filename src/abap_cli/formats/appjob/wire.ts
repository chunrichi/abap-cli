/**
 * Application-job wire mapping — AFF v1 (local) ↔ release-specific ADT JSON.
 *
 * The ADT application-job resources serve the object's JSON document directly on
 * `source/main`, but the document shape depends on the SAP release:
 *
 *   nested  — the current AFF v1 model (`generalInformation`, `exitClasses`,
 *             `sections`/`groups`/`parameters` for SAJC; `parameters.
 *             {singleValue,valueRanges}Parameters` for SAJT).
 *   legacy  — the flat model still served by SAP_BASIS 757 (the reference
 *             release): `className`/`reportName`/`checkExitClass`/… for SAJC and
 *             a flat `parameters:[{name,valueRanges}]` list for SAJT.
 *
 * The local file is always AFF v1. This module translates the legacy wire
 * documents and reports fields the legacy model cannot carry, so a push against
 * an older release never silently drops data.
 */
import { CliError } from '../../output/json.js';
import type {
  AppJobHeader,
  AppJobLocal,
  AppJobType,
  SajcLocal,
  SajtLocal,
  SajtValueRange,
} from './json.js';

/** Which wire document model the target system serves. */
export type AppJobWireFormat = 'nested' | 'legacy';

/** Flat SAJC document served by the legacy ADT object model. */
export interface SajcLegacyWire {
  formatVersion: '1';
  header: AppJobHeader;
  className: string;
  reportName?: string;
  checkExitClass?: string;
  valueHelpExitClass?: string;
}

/** Flat SAJT document served by the legacy ADT object model. */
export interface SajtLegacyWire {
  formatVersion: '1';
  header: AppJobHeader;
  catalogName: string;
  parameters?: Array<{ name: string; valueRanges: SajtValueRange[] }>;
}

/** Header carried to the wire: `standard` is omitted (schema default). */
function wireHeader(header: AppJobHeader): AppJobHeader {
  const out: AppJobHeader = {
    description: header.description,
    originalLanguage: header.originalLanguage,
  };
  if (header.abapLanguageVersion === 'cloudDevelopment') out.abapLanguageVersion = 'cloudDevelopment';
  return out;
}

/** Normalise a header read from the wire (drop defaults/empty values). */
function localHeader(header: Partial<AppJobHeader> | undefined): AppJobHeader {
  const out: AppJobHeader = {
    description: header?.description ?? '',
    originalLanguage: (header?.originalLanguage ?? 'en').toLowerCase(),
  };
  if (header?.abapLanguageVersion === 'cloudDevelopment') out.abapLanguageVersion = 'cloudDevelopment';
  return out;
}

/** AFF field paths the flat wire model cannot represent. */
function legacyUnsupportedFields(type: AppJobType, local: AppJobLocal): string[] {
  if (type === 'SAJC') {
    const doc = local as SajcLocal;
    const unsupported: string[] = [];
    if (doc.exitClasses?.notification) unsupported.push('exitClasses.notification');
    if (doc.sections && doc.sections.length > 0) unsupported.push('sections');
    if (doc.groups && doc.groups.length > 0) unsupported.push('groups');
    if (doc.parameters && doc.parameters.length > 0) unsupported.push('parameters');
    return unsupported;
  }
  const doc = local as SajtLocal;
  const single = doc.parameters?.singleValueParameters;
  return single && single.length > 0 ? ['parameters.singleValueParameters'] : [];
}

function unsupportedOnLegacyWire(type: AppJobType, fields: string[]): CliError {
  return new CliError(
    'VALIDATION_ERROR',
    `The target system's ADT application-job model is the flat/legacy variant and cannot represent ${type} field(s): ${fields.join(', ')}`,
    {
      type,
      details: { unsupportedFields: fields },
      nextSteps: [
        `Remove the unsupported field(s) from the local ${type} document, or run against a release whose ADT serves the nested AFF v1 model.`,
        'The legacy model supports: header, general information, check/value-help exits and (for SAJT) value-ranges parameters.',
      ],
    },
  );
}

/** Map a local AFF SAJC document onto the legacy flat wire document. */
export function sajcToLegacyWire(local: SajcLocal): SajcLegacyWire {
  const unsupported = legacyUnsupportedFields('SAJC', local);
  if (unsupported.length > 0) throw unsupportedOnLegacyWire('SAJC', unsupported);
  const wire: SajcLegacyWire = {
    formatVersion: '1',
    header: wireHeader(local.header),
    className: local.generalInformation.className,
  };
  if (local.generalInformation.programName) wire.reportName = local.generalInformation.programName;
  if (local.exitClasses?.check) wire.checkExitClass = local.exitClasses.check;
  if (local.exitClasses?.valueHelp) wire.valueHelpExitClass = local.exitClasses.valueHelp;
  return wire;
}

/** Map a legacy flat SAJC wire document onto the local AFF document. */
export function sajcFromLegacyWire(wire: SajcLegacyWire): SajcLocal {
  const local: SajcLocal = {
    formatVersion: '1',
    header: localHeader(wire.header),
    generalInformation: { className: wire.className ?? '' },
  };
  if (wire.reportName) local.generalInformation.programName = wire.reportName;
  const exitClasses: NonNullable<SajcLocal['exitClasses']> = {};
  if (wire.checkExitClass) exitClasses.check = wire.checkExitClass;
  if (wire.valueHelpExitClass) exitClasses.valueHelp = wire.valueHelpExitClass;
  if (Object.keys(exitClasses).length > 0) local.exitClasses = exitClasses;
  return local;
}

/** Map a local AFF SAJT document onto the legacy flat wire document. */
export function sajtToLegacyWire(local: SajtLocal): SajtLegacyWire {
  const unsupported = legacyUnsupportedFields('SAJT', local);
  if (unsupported.length > 0) throw unsupportedOnLegacyWire('SAJT', unsupported);
  const wire: SajtLegacyWire = {
    formatVersion: '1',
    header: wireHeader(local.header),
    catalogName: local.generalInformation.catalogName,
  };
  const ranges = local.parameters?.valueRangesParameters;
  if (ranges && ranges.length > 0) {
    wire.parameters = ranges.map((p) => ({ name: p.name, valueRanges: p.valueRanges }));
  }
  return wire;
}

/** Map a legacy flat SAJT wire document onto the local AFF document. */
export function sajtFromLegacyWire(wire: SajtLegacyWire): SajtLocal {
  const local: SajtLocal = {
    formatVersion: '1',
    header: localHeader(wire.header),
    generalInformation: { catalogName: wire.catalogName ?? '' },
  };
  const ranges = wire.parameters;
  if (ranges && ranges.length > 0) {
    local.parameters = {
      valueRangesParameters: ranges.map((p) => ({ name: p.name, valueRanges: p.valueRanges })),
    };
  }
  return local;
}

/** Convert a validated local document into the wire JSON text for `format`. */
export function toWireDocument(type: AppJobType, local: AppJobLocal, format: AppJobWireFormat): string {
  if (format === 'nested') return JSON.stringify(local, null, 2);
  const wire = type === 'SAJC' ? sajcToLegacyWire(local as SajcLocal) : sajtToLegacyWire(local as SajtLocal);
  return JSON.stringify(wire, null, 2);
}

interface ParsedWire {
  format: AppJobWireFormat;
  doc: AppJobLocal;
}

/** Detect the wire model from an already parsed source document. */
function formatOfDocument(value: unknown): AppJobWireFormat | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  if (record.generalInformation !== null && typeof record.generalInformation === 'object') return 'nested';
  if (typeof record.className === 'string' || typeof record.catalogName === 'string') return 'legacy';
  return undefined;
}

/** Parse the `source/main` JSON and map it to the local AFF document. */
export function fromWireDocument(type: AppJobType, source: string): ParsedWire {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new CliError('SAP_ERROR', `SAP returned a non-JSON ${type} source document`, {
      type,
      nextSteps: ['Re-run the pull; if it persists, inspect the object in ADT/SAP GUI.'],
    });
  }
  const format = formatOfDocument(value);
  if (!format) {
    throw new CliError('SAP_ERROR', `Unrecognised ${type} source document shape from SAP`, {
      type,
      details: { keys: value !== null && typeof value === 'object' ? Object.keys(value as object) : [] },
      nextSteps: ['The release may serve a newer application-job JSON model; update the CLI before pushing.'],
    });
  }
  const doc =
    format === 'nested'
      ? (value as AppJobLocal)
      : type === 'SAJC'
        ? sajcFromLegacyWire(value as SajcLegacyWire)
        : sajtFromLegacyWire(value as SajtLegacyWire);
  return { format, doc };
}

/** Detect the wire model from the raw `$schema` JSON returned by ADT. */
export function wireFormatOfSchema(type: AppJobType, schema: string): AppJobWireFormat {
  let value: unknown;
  try {
    value = JSON.parse(schema);
  } catch {
    throw new CliError('SAP_ERROR', `SAP returned a non-JSON ${type} object-type schema`, { type });
  }
  const properties = (value as { properties?: Record<string, unknown> } | null)?.properties;
  const format: AppJobWireFormat | undefined = !properties
    ? undefined
    : 'generalInformation' in properties
      ? 'nested'
      : 'className' in properties || 'catalogName' in properties
        ? 'legacy'
        : undefined;
  if (!format) {
    // The schema lists the object's top-level JSON fields, so the same shape
    // probe as source documents applies; an unknown shape is fatal rather than
    // guessed, because a wrong guess writes a document SAP cannot read.
    throw new CliError('SAP_ERROR', `Cannot determine the ${type} JSON model served by this system`, {
      type,
      details: { schemaProperties: properties ? Object.keys(properties) : [] },
      nextSteps: ['This SAP release may be newer than the CLI; check for an updated abap-cli release.'],
    });
  }
  return format;
}
