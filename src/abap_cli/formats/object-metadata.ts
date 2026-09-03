import type { ObjectMetadata } from './object-parts.js';

/** Map raw ADT program:programType to the abap-file-format programType enum. */
const ADT_PROGRAM_TYPE_TO_ENUM: Record<string, string> = {
  '1': 'executableProgram',
  M: 'modulePool',
  S: 'subroutinePool',
  I: 'include',
};

/** Real SAP already returns the enum value (e.g. "executableProgram"). */
const PROGRAM_TYPE_ENUMS = new Set(Object.values(ADT_PROGRAM_TYPE_TO_ENUM));

function programTypeOf(metadata: ObjectMetadata): string | undefined {
  const raw = metadata.programType;
  if (!raw) {
    // Real SAP omits program:programType on includes; infer from PROG/I.
    return metadata.objectType?.toUpperCase().endsWith('/I') ? 'include' : undefined;
  }
  if (PROGRAM_TYPE_ENUMS.has(raw)) return raw;
  return ADT_PROGRAM_TYPE_TO_ENUM[raw];
}

/**
 * Render the <name>.<type>.json metadata file per abap-file-format v1.
 * Minimum-required content: formatVersion + header (description, originalLanguage);
 * PROG objects also carry generalInformation.programType.
 */
export function renderObjectMetadataJson(metadata: ObjectMetadata): string {
  const doc: Record<string, unknown> = {
    formatVersion: '1',
    header: {
      description: metadata.description ?? '',
      originalLanguage: (metadata.masterLanguage ?? 'EN').toLowerCase(),
    },
  };
  if (metadata.abapLanguageVersion) {
    (doc.header as Record<string, unknown>).abapLanguageVersion = metadata.abapLanguageVersion;
  }
  const programType = programTypeOf(metadata);
  if (programType) {
    doc.generalInformation = { programType };
  }
  return JSON.stringify(doc, null, 2) + '\n';
}
