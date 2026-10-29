import type { ObjectMetadata } from './object-parts.js';

/**
 * Render the `<name>.<type>.json` metadata file per abap-file-format v1.
 *
 * Branched by primary object type:
 *   - PROG (or `!primary && programType`): `generalInformation` carries
 *     programType + programStatus + fixPointArithmetic / editLocked /
 *     startsUsingVariant / authorizationGroup / application, plus a nested
 *     `logicalDatabase: { name, selectionScreen }` when either field is set.
 *   - CLAS: `category` (16 enum values) + `fixPointArithmetic` + `messageClass`
 *     + `descriptions` (types/attributes/events/methods tree).
 *   - INTF: `category` (7 enum values) + `proxy` + `descriptions`.
 *
 * `header.abapLanguageVersion` is emitted only for CLAS / INTF (PROG must not
 * carry it — that was a T1.2 spec change relative to the pre-0.3.0 renderer).
 */
export function renderObjectMetadataJson(metadata: ObjectMetadata): string {
  const primary = metadata.objectType?.split('/')[0]?.toUpperCase();
  const doc: Record<string, unknown> = {
    formatVersion: '1',
    header: {
      description: metadata.description ?? '',
      originalLanguage: (metadata.masterLanguage ?? 'EN').toLowerCase(),
    },
  };

  const languageVersion = enumValue(
    metadata.abapLanguageVersion,
    ABAP_LANGUAGE_VERSIONS,
    { '1': 'standard', '2': 'keyUser', '3': 'cloudDevelopment' },
  );
  if (languageVersion && (primary === 'CLAS' || primary === 'INTF')) {
    (doc.header as Record<string, unknown>).abapLanguageVersion = languageVersion;
  }

  const programType = programTypeOf(metadata);
  const isProgram =
    primary === 'PROG' || (!primary && programType !== undefined);
  if (isProgram) {
    const generalInformation: Record<string, unknown> = {};
    if (programType) generalInformation.programType = programType;
    const programStatus = enumValue(metadata.programStatus, PROGRAM_STATUSES, {
      S: 'sapProductionProgram',
      C: 'customerProductionProgram',
      X: 'systemProgram',
      T: 'testProgram',
    });
    if (programStatus) generalInformation.programStatus = programStatus;
    for (const [key, value] of Object.entries({
      fixPointArithmetic: metadata.fixPointArithmetic,
      editLocked: metadata.editLocked,
      startsUsingVariant: metadata.startsUsingVariant,
      authorizationGroup: metadata.authorizationGroup,
      application: metadata.application,
    })) {
      if (value !== undefined && value !== '') generalInformation[key] = value;
    }
    if (Object.keys(generalInformation).length > 0) {
      doc.generalInformation = generalInformation;
    }
    const logicalDatabase: Record<string, string> = {};
    if (metadata.logicalDatabase) logicalDatabase.name = metadata.logicalDatabase;
    if (metadata.selectionScreen) logicalDatabase.selectionScreen = metadata.selectionScreen;
    if (Object.keys(logicalDatabase).length > 0) doc.logicalDatabase = logicalDatabase;
  } else if (primary === 'CLAS') {
    const category = enumValue(
      metadata.category,
      CLASS_CATEGORIES,
      { '00': 'generalObjectType' },
    );
    if (category) doc.category = category;
    if (metadata.fixPointArithmetic !== undefined) {
      doc.fixPointArithmetic = metadata.fixPointArithmetic;
    }
    if (metadata.messageClass) doc.messageClass = metadata.messageClass;
    if (metadata.descriptions) doc.descriptions = metadata.descriptions;
  } else if (primary === 'INTF') {
    const category = enumValue(metadata.category, INTERFACE_CATEGORIES, {
      '00': 'general',
    });
    if (category) doc.category = category;
    if (metadata.proxy !== undefined) doc.proxy = metadata.proxy;
    if (metadata.descriptions) doc.descriptions = metadata.descriptions;
  }

  return JSON.stringify(doc, null, 2) + '\n';
}

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
 * Resolve a possibly-aliased ADT enum value to its canonical
 * abap-file-format name. Accepts real-SAP enum values verbatim and translates
 * raw single-letter / two-digit ADT codes via the supplied alias map. Returns
 * `undefined` for blank / unknown input so callers can skip rendering.
 */
function enumValue(
  value: string | undefined,
  allowed: Set<string>,
  aliases: Record<string, string>,
): string | undefined {
  if (!value) return undefined;
  if (allowed.has(value)) return value;
  return aliases[value] ?? aliases[value.toUpperCase()] ?? aliases[value.toLowerCase()];
}

const ABAP_LANGUAGE_VERSIONS = new Set([
  'standard',
  'keyUser',
  'cloudDevelopment',
]);

const PROGRAM_STATUSES = new Set([
  'sapProductionProgram',
  'customerProductionProgram',
  'systemProgram',
  'testProgram',
  'unknown',
]);

const CLASS_CATEGORIES = new Set([
  'generalObjectType',
  'exitClass',
  'testclassAbapUnit',
  'behaviorClass',
  'entityEventHandler',
  'persistentClass',
  'factoryForPersistentClass',
  'statusClassForPersistClass',
  'rfcProxyClass',
  'communicationConnectionClass',
  'exceptionClass',
  'areaClassSharedObjects',
  'businessClass',
  'bspApplicationClass',
  'basisClassBspElementHdlr',
  'webDynproRuntimeObject',
]);

const INTERFACE_CATEGORIES = new Set([
  'general',
  'classicBadi',
  'businessStaticComponents',
  'businessInstanceComponents',
  'dbProcedureProxy',
  'webDynproRuntime',
  'enterpriseService',
]);
