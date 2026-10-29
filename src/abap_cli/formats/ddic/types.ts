/**
 * DDIC wire/local type shapes shared by the DDIC format modules.
 *
 * Split out of the former 880-line `ddic/json.ts`: this module is types only,
 * so I/O (`io.ts`), wire mapping (`wire.ts`), validation (`validate.ts`) and
 * agent-facing examples (`examples.ts`) can depend on it without cycles.
 */
import { DDIC_TYPES } from '../../types/registry.js';
import type { DdicSupportedType } from '../../types/registry.js';

export { DDIC_TYPES };
export type { DdicSupportedType };

export interface DdicObject {
  name: string;
  description?: string;
  [key: string]: unknown;
}

/** 014: local abap-file-format field representation (snake_case / nested). */
export interface DdicFieldLocal {
  fieldName: string;
  rollname?: string;
  dataType?: string;
  length?: number | string;
  decimals?: number | string;
  keyFlag?: boolean;
  notNull?: boolean;
  ddtext?: string;
  refTable?: string;
  refField?: string;
  checkTable?: string;
  /** 024: TABL include/append target structure name (.INCLUDE / .INCLU--AP). */
  precField?: string;
  /** 032 US6: TABL `.INCLUDE ... WITH SUFFIX <suffix>` suffix. */
  includeSuffix?: string;
  /** 032 US6: foreign-key entries for `@AbapCatalog.foreignKeys` block. */
  foreignKeys?: Array<{ checkTable: string; label?: string }>;
}

/** 014: ICF wire representation (camelCase, transport envelope). */
export interface DdicFieldWire {
  fieldName: string;
  rollname?: string;
  dataType?: string;
  length?: number;
  decimals?: number;
  keyFlag?: boolean;
  notNull?: boolean;
  ddtext?: string;
  refTable?: string;
  refField?: string;
  checkTable?: string;
  /** 024: TABL include/append target structure name (.INCLUDE / .INCLU--AP). */
  precField?: string;
}

/**
 * T2.1: split `DdicWirePayload` into per-type wire interfaces so each
 * DDIC variant (DOMA / DTEL / TABL settings) declares only the fields
 * its AFF schema actually carries. The legacy union `DdicWirePayload`
 * is preserved as a backward-compatible alias; new code should pick the
 * narrowed interface that matches its `wireToLocal<…>(type, wire)` call.
 */

/** DOMA wire payload — fields declared by `doma-v1.json`. */
export interface DdicDomaWire {
  name: string;
  description?: string;
  package?: string;
  transportRequest?: string;
  header?: {
    description?: string;
    originalLanguage?: string;
    abapLanguageVersion?: string;
  };
  format?: {
    dataType?: string;
    length?: number;
    decimals?: number;
    signFlag?: string;
    lowercase?: string;
    convExit?: string;
  };
  outputCharacteristics?: {
    length?: number;
    [k: string]: unknown;
  };
  fixedValues?: DdomaFixedValueWire[];
  warnings?: Array<{ code: string; message: string }>;
  errorCode?: string;
  errorMessage?: string;
}

/** DTEL wire payload — fields declared by `dtel-v1.json`. */
export interface DdicDtelWire {
  name: string;
  description?: string;
  package?: string;
  transportRequest?: string;
  header?: {
    description?: string;
    originalLanguage?: string;
    abapLanguageVersion?: string;
  };
  // See DdicDtelWire.dataTypeInformation for the AFF canonical categories.
  dataTypeInformation?: {
    category:
      | 'domain'
      | 'predefinedType'
      | 'referenceToPredefinedType'
      | 'referenceDictionaryType'
      | 'referenceClasIntType';
    typeName?: string;
    /** Legacy 032 alias retained on the wire shape (not in AFF schema). */
    referencedTypeName?: string;
    predefinedType?: { dataType?: string; length?: number; decimals?: number };
  };
  shortText?: string;
  mediumText?: string;
  longText?: string;
  headerText?: string;
  warnings?: Array<{ code: string; message: string }>;
  errorCode?: string;
  errorMessage?: string;
}

/** TABT buffering section - matches `tabt-v1.json#buffering`. */
export interface DdicTableBufferingWire {
  state?: 'notAllowed' | 'switchedOn' | 'allowedButSwitchedOff';
  type?: 'noBuffer' | 'single' | 'generic' | 'full';
  nrOfKeyFlds4GenericBuff?: number;
}

/** TABT dbSpecificSettings section - matches `tabt-v1.json#dbSpecificSettings`. */
export interface DdicTableDbSpecificSettingsWire {
  storageType?: 'undefined' | 'rowStore' | 'columnStore';
  loadUnit?: 'columnPreferred' | 'pagePreferred' | 'columnEnforced' | 'pageEnforced';
}

/** TABT generalInformation section - matches `tabt-v1.json#generalInformation`. */
export interface DdicTableGeneralInformationWire {
  dataClassCategory?: string;
  sizeCategory?: 'undefined' | '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';
  logChanges?: boolean;
  writableByAmdp?: boolean;
  translation?: 'noLanguageKey' | 'standard' | 'loadTable' | 'objectSpecific' | 'notRelevant';
  buffering?: DdicTableBufferingWire;
  dbSpecificSettings?: DdicTableDbSpecificSettingsWire;
}

/** TABL/STRU technical-settings wire payload — fields declared by `tabt-v1.json`. */
export interface DdicTableSettingsWire {
  name: string;
  description?: string;
  package?: string;
  transportRequest?: string;
  header?: {
    description?: string;
    originalLanguage?: string;
    abapLanguageVersion?: string;
  };
  generalInformation?: DdicTableGeneralInformationWire;
  fields?: DdicFieldWire[];
  type?: 'TABL' | 'STRU';
  mainJson?: string;
  ddicSource?: string;
  settingsJson?: string;
  hasSettings?: boolean;
  warnings?: Array<{ code: string; message: string }>;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * @deprecated Use {@link DdicDomaWire} | {@link DdicDtelWire} | {@link DdicTableSettingsWire}
 * depending on the DDIC variant you are handling. Kept as a structural union
 * for backward compatibility with the pre-T2.1 single-interface contract.
 */
export type DdicWirePayload = DdicDomaWire | DdicDtelWire | DdicTableSettingsWire;

/**
 * T2.1: type-level mapping from a DDIC variant code to its narrowed wire
 * interface. Lets `localToWire<DOMA>(...)` / `wireToLocal<DTEL>(...)`
 * return / accept exactly the wire shape the AFF schema declares.
 */
export type WireForDdicType<T extends DdicSupportedType> =
  T extends 'DOMA' ? DdicDomaWire :
  T extends 'DTEL' ? DdicDtelWire :
  DdicTableSettingsWire;

/** 032 + 033: DOMA fixed-value wire shape. `description` is the AFF canonical
 *  plain string; `fixedValueLong` is the legacy multi-language shape retained
 *  for backwards compatibility with objects that still use it. */
export interface DdomaFixedValueWire {
  fixedValue: string;
  description?: string;
  fixedValueLong?: {
    languageIndependent?: string;
    languageDependent?: Array<{ language: string; description: string }>;
  };
}

/** 033: DOMA fixed-value local shape. AFF canonical uses a plain string
 *  description; legacy used a multi-language object. Both shapes are accepted
 *  on read; writers emit the AFF canonical plain string. */
export interface DomaFixedValueLocal {
  fixedValue: string;
  description?: string | {
    languageIndependent?: string;
    languageDependent?: Array<{ language: string; description: string }>;
  };
}
