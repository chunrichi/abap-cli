/**
 * SUCU (authorization group, transaction SU21) — authorization-family document.
 *
 * One local JSON document maps a cross-client `TBRG_AUTH` key row (`BRGRU` +
 * `OBJECT`) plus the language-dependent `TBRG_AUTHT` texts. SAP keys the object
 * by the fixed-width TADIR composite `<BRGRU padded to 30><OBJECT padded to 10>`
 * (40 characters, `R3TR SUCU`), so a local file always carries the two key
 * fields; the CLI object name is the compact `<GROUP>~<OBJECT>` form (TADIR
 * names cannot contain `~`).
 *
 * Upstream SAP abap-file-formats has no SUCU schema (`suco-v1.json` is the
 * different TADIR object type "Authorization Default Variant"), so the document
 * is a local extension (`sucu-v1.json`) in the AFF top-level style
 * (`formatVersion` + `header`). The header description is the text of the
 * original language; the other `TBRG_AUTHT` languages travel in `texts[]`.
 *
 * Wire: the bundled ICF service `GET/POST/PUT/DELETE /auth/sucu/<name>`;
 * package / transport request travel as query parameters. `name` / `package`
 * in a GET response are read-side metadata and are stripped before the local
 * file is written.
 */
import { affObjectNameFromToken, affObjectToken } from '../file-resolver.js';
import { defineWireArtifact } from '../artifact.js';
import { validateAff } from '../../aff/schema-validator.js';
import { CliError } from '../../output/json.js';
import type { ErrorCode } from '../../output/error-codes.js';
import type { AuthTypeSpec } from './spec.js';

/** TBRG_AUTH-BRGRU is CHAR 30 (domain SU2X_GRP). */
export const SUCU_GROUP_MAX_LENGTH = 30;
/** TBRG_AUTH-OBJECT is CHAR 10 (domain XUOBJECT, check table TOBJ). */
export const SUCU_OBJECT_MAX_LENGTH = 10;
/** TADIR-OBJ_NAME is CHAR 40: BRGRU padded to 30 + OBJECT padded to 10. */
export const SUCU_TADIR_NAME_MAX_LENGTH = 40;
/** Canonical CLI name: `<GROUP>~<OBJECT>` (30 + 1 + 10 characters). */
export const SUCU_NAME_MAX_LENGTH = SUCU_GROUP_MAX_LENGTH + 1 + SUCU_OBJECT_MAX_LENGTH;
/** TBRG_AUTHT-BEZEI is CHAR 40. */
export const SUCU_TEXT_MAX_LENGTH = 40;

/** SAP name character set of both key fields: plain names plus `/NS/NAME`. */
const SUCU_PART_PATTERN = /^[A-Z0-9_/]+$/;

/** Two-letter ISO language code (AFF header convention, lower case on file). */
const LANGUAGE_PATTERN = /^[A-Za-z]{2}$/;

/** One `TBRG_AUTHT` text row (a language other than the original language). */
export interface SucuText {
  /** Two-letter ISO language code (T002-LAISO, lower case). */
  language: string;
  /** TBRG_AUTHT-BEZEI (max 40 characters). */
  description: string;
}

/** Local `<token>.sucu.json` document. */
export interface SucuLocal {
  formatVersion: '1';
  header: {
    /** TBRG_AUTHT-BEZEI of the original language. */
    description: string;
    /** Two-letter ISO code of the original language (TADIR-MASTERLANG). */
    originalLanguage: string;
  };
  generalInformation: {
    /** TBRG_AUTH-BRGRU (CHAR 30). */
    authorizationGroup: string;
    /** TBRG_AUTH-OBJECT (CHAR 10). */
    authorizationObject: string;
  };
  /** Further TBRG_AUTHT rows; the original language lives in `header`. */
  texts?: SucuText[];
}

/** GET response document: the local document plus read-side metadata. */
export interface SucuWire extends SucuLocal {
  name?: string;
  package?: string;
}

/** Loose shape of the ICF wire document (read-side tolerant). */
interface SucuWireShape {
  formatVersion?: string;
  header?: { description?: string; originalLanguage?: string } | null;
  generalInformation?: { authorizationGroup?: string; authorizationObject?: string } | null;
  texts?: Array<{ language?: string; description?: string }> | null;
  name?: string;
  package?: string;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asLower(value: unknown): string {
  return asText(value).trim().toLowerCase();
}

function asUpper(value: unknown): string {
  return asText(value).trim().toUpperCase();
}

/** GET wire → local document (drops `name` / `package`, normalizes case). */
export function sucuFromWire(wire: SucuWireShape | undefined): SucuLocal {
  const header = wire?.header ?? {};
  const general = wire?.generalInformation ?? {};
  const texts = (Array.isArray(wire?.texts) ? wire.texts : [])
    .map((text) => ({ language: asLower(text?.language), description: asText(text?.description).trim() }))
    .filter((text) => text.language !== '')
    .sort((left, right) => left.language.localeCompare(right.language));
  const local: SucuLocal = {
    formatVersion: '1',
    header: {
      description: asText(header.description).trim(),
      originalLanguage: asLower(header.originalLanguage) || 'en',
    },
    generalInformation: {
      authorizationGroup: asUpper(general.authorizationGroup),
      authorizationObject: asUpper(general.authorizationObject),
    },
  };
  if (texts.length > 0) local.texts = texts;
  return local;
}

/** Local document → POST/PUT body. */
export function sucuToWire(local: SucuLocal): SucuWire {
  const texts = (local.texts ?? []).map((text) => ({
    language: asLower(text.language),
    description: asText(text.description).trim(),
  }));
  return {
    formatVersion: '1',
    header: {
      description: asText(local.header?.description).trim(),
      originalLanguage: asLower(local.header?.originalLanguage),
    },
    generalInformation: {
      authorizationGroup: asUpper(local.generalInformation?.authorizationGroup),
      authorizationObject: asUpper(local.generalInformation?.authorizationObject),
    },
    texts,
  };
}

/** Semantic checks the JSON schema cannot express. */
export function validateSucuDocument(local: SucuLocal): string[] {
  const errors: string[] = [];
  const header = local?.header ?? ({} as SucuLocal['header']);
  const general = local?.generalInformation ?? ({} as SucuLocal['generalInformation']);

  const description = asText(header.description).trim();
  if (description.length > SUCU_TEXT_MAX_LENGTH) {
    errors.push(`header.description is ${description.length} characters long; the SAP text limit is ${SUCU_TEXT_MAX_LENGTH}`);
  }
  const language = asLower(header.originalLanguage);
  if (!language) {
    errors.push('header.originalLanguage is required');
  } else if (!LANGUAGE_PATTERN.test(language)) {
    errors.push(`header.originalLanguage "${language}" is not a two-letter ISO language code (e.g. "en", "de")`);
  }

  const group = asUpper(general.authorizationGroup);
  const object = asUpper(general.authorizationObject);
  if (!group) {
    errors.push('generalInformation.authorizationGroup is required');
  } else if (group.length > SUCU_GROUP_MAX_LENGTH || !SUCU_PART_PATTERN.test(group)) {
    errors.push(
      `generalInformation.authorizationGroup "${group}" must be 1-${SUCU_GROUP_MAX_LENGTH} characters A-Z, 0-9, _ or /`,
    );
  }
  if (!object) {
    errors.push('generalInformation.authorizationObject is required');
  } else if (object.length > SUCU_OBJECT_MAX_LENGTH || !SUCU_PART_PATTERN.test(object)) {
    errors.push(
      `generalInformation.authorizationObject "${object}" must be 1-${SUCU_OBJECT_MAX_LENGTH} characters A-Z, 0-9, _ or /`,
    );
  }

  const seen = new Set<string>();
  (local?.texts ?? []).forEach((text, index) => {
    const textLanguage = asLower(text?.language);
    const textDescription = asText(text?.description).trim();
    if (!LANGUAGE_PATTERN.test(textLanguage)) {
      errors.push(`texts[${index}].language "${textLanguage}" is not a two-letter ISO language code (e.g. "en", "de")`);
    } else if (textLanguage === language) {
      errors.push(`texts[${index}].language "${textLanguage}" repeats header.originalLanguage`);
    } else if (seen.has(textLanguage)) {
      errors.push(`texts[${index}].language "${textLanguage}" appears more than once`);
    }
    seen.add(textLanguage);
    if (textDescription.length > SUCU_TEXT_MAX_LENGTH) {
      errors.push(`texts[${index}].description is ${textDescription.length} characters long; the SAP text limit is ${SUCU_TEXT_MAX_LENGTH}`);
    }
  });

  return errors;
}

/** SUCU artifact: file/schema plumbing + local ↔ ICF wire mapping. */
export const sucuArtifact = defineWireArtifact<SucuLocal, SucuWire>({
  type: 'SUCU',
  toWire: (local) => sucuToWire(local),
  fromWire: (wire) => sucuFromWire(wire as SucuWireShape),
  validate: async (doc) => {
    const result = await validateAff('SUCU', doc);
    const schemaErrors =
      result.status === 'pass' || result.status === 'warn'
        ? []
        : result.errors.map((error) => `${error.instancePath || '/'}: ${error.message ?? ''}`);
    return [...schemaErrors, ...validateSucuDocument(doc as SucuLocal)];
  },
});

interface SucuKey {
  group: string;
  object: string;
}

function nameInvalid(raw: string, reason: string): CliError {
  return new CliError('SUCU_NAME_INVALID' as ErrorCode, `SUCU name "${raw}" is invalid: ${reason}`, {
    type: 'SUCU',
    nextSteps: [
      'Use the compact <GROUP>~<OBJECT> form (e.g. CMMFDOR~S_TABU_DIS), or the raw 40-character TADIR name.',
      `The authorization group is 1-${SUCU_GROUP_MAX_LENGTH} characters A-Z, 0-9, _ or /; the authorization object is 1-${SUCU_OBJECT_MAX_LENGTH} characters of the same set.`,
    ],
    example: 'abap pull CMMFDOR~S_TABU_DIS --type SUCU',
  });
}

/**
 * Split one CLI/route name into the two TBRG_AUTH key fields. Accepts the
 * canonical compact `<GROUP>~<OBJECT>` form and the raw 40-character padded
 * TADIR name (both are normalized upper case; padding is trimmed).
 */
function parseSucuKey(raw: string): SucuKey {
  const name = (raw ?? '').trim();
  if (!name) throw nameInvalid(raw ?? '', 'the name is empty');

  let group: string;
  let object: string;
  if (name.includes('~')) {
    const parts = name.split('~');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw nameInvalid(name, 'the compact form must be <GROUP>~<OBJECT> with exactly one separator');
    }
    group = parts[0];
    object = parts[1];
  } else if (name.length === SUCU_TADIR_NAME_MAX_LENGTH) {
    // Raw TADIR key: BRGRU padded to 30 + OBJECT padded to 10.
    group = name.slice(0, SUCU_GROUP_MAX_LENGTH);
    object = name.slice(SUCU_GROUP_MAX_LENGTH);
  } else {
    throw nameInvalid(
      name,
      `expected <GROUP>~<OBJECT> or the ${SUCU_TADIR_NAME_MAX_LENGTH}-character TADIR name`,
    );
  }

  const normalizedGroup = group.trim().toUpperCase();
  const normalizedObject = object.trim().toUpperCase();
  if (
    normalizedGroup.length < 1 ||
    normalizedGroup.length > SUCU_GROUP_MAX_LENGTH ||
    !SUCU_PART_PATTERN.test(normalizedGroup)
  ) {
    throw nameInvalid(
      name,
      `authorization group "${normalizedGroup}" must be 1-${SUCU_GROUP_MAX_LENGTH} characters A-Z, 0-9, _ or /`,
    );
  }
  if (
    normalizedObject.length < 1 ||
    normalizedObject.length > SUCU_OBJECT_MAX_LENGTH ||
    !SUCU_PART_PATTERN.test(normalizedObject)
  ) {
    throw nameInvalid(
      name,
      `authorization object "${normalizedObject}" must be 1-${SUCU_OBJECT_MAX_LENGTH} characters A-Z, 0-9, _ or /`,
    );
  }
  return { group: normalizedGroup, object: normalizedObject };
}

/** Normalize + validate one SUCU object name (CLI argument or route segment). */
export function normalizeSucuName(raw: string): string {
  const key = parseSucuKey(raw);
  return `${key.group}~${key.object}`;
}

/** Compact object name from the document key (used to cross-check file/CLI name). */
export function sucuObjectNameFromDocument(local: SucuLocal): string | undefined {
  const group = asUpper(local?.generalInformation?.authorizationGroup);
  const object = asUpper(local?.generalInformation?.authorizationObject);
  if (!group || !object) return undefined;
  return `${group}~${object}`;
}

/**
 * SUCU filename token → CLI object name. `affObjectToken` maps a namespaced
 * element to the AFF `(ns)name` form, so the token is `<group-token>~<object-token>`
 * (`cmmfdor~s_tabu_dis`, `(accgo)ppm_gr~(aif)cdlog`). The generic resolver has
 * already expanded the first namespace token; the object token may still need
 * expanding.
 */
export function sucuNameFromToken(token: string, basename?: string): string {
  if (token.startsWith('#')) {
    throw new CliError(
      'FILE_PARSE_ERROR',
      `${basename ?? token} uses the retired '#' namespace token; abap-file-format names use '(...)'`,
      {
        file: basename ?? token,
        nextSteps: ['Re-run `abap pull` for the object to write the AFF-style file name.'],
        example: 'abap pull CMMFDOR~S_TABU_DIS --type SUCU',
      },
    );
  }
  const parts = token.split('~');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new CliError('FILE_PARSE_ERROR', `${basename ?? token} does not encode a SUCU object name`, {
      file: basename ?? token,
      nextSteps: ['The file name token must be `<group>~<object>` in lower case (e.g. cmmfdor~s_tabu_dis).'],
      example: 'abap pull CMMFDOR~S_TABU_DIS --type SUCU',
    });
  }
  const expand = (part: string): string => {
    // A leading `(ns)` was expanded by the generic resolver; namespace tokens
    // inside the object element (`(aif)cdlog`) are still local and expand here.
    if (part.startsWith('(')) return affObjectNameFromToken(part, basename);
    return part.toUpperCase();
  };
  const group = expand(parts[0]);
  const object = expand(parts[1]);
  try {
    return normalizeSucuName(`${group}~${object}`);
  } catch (error: unknown) {
    if (error instanceof CliError) throw error;
    throw new CliError('FILE_PARSE_ERROR', `${basename ?? token} does not encode a valid SUCU object name`, {
      file: basename ?? token,
      example: 'abap pull CMMFDOR~S_TABU_DIS --type SUCU',
    });
  }
}

/** CLI object name (compact or padded alias) → SUCU filename token. */
export function sucuFileToken(name: string): string {
  const key = parseSucuKey(name);
  return `${affObjectToken(key.group)}~${affObjectToken(key.object)}`;
}

/** Minimal valid document for `abap create --schema SUCU`. */
export function sucuExample(): SucuLocal {
  return {
    formatVersion: '1',
    header: { description: 'Example authorization group', originalLanguage: 'en' },
    generalInformation: { authorizationGroup: 'ZCLI_TC_SUCU_1', authorizationObject: 'S_TABU_DIS' },
  };
}

export const sucuSpec: AuthTypeSpec<SucuLocal> = {
  type: 'SUCU',
  route: 'sucu',
  tadirObject: 'SUCU',
  schemaFile: 'sucu-v1.json',
  description: 'Authorization group (SU21, TBRG_AUTH)',
  nameMaxLength: SUCU_NAME_MAX_LENGTH,
  artifact: sucuArtifact,
  normalizeName: normalizeSucuName,
  fileToken: sucuFileToken,
  nameFromToken: (token, basename) => sucuNameFromToken(token, basename),
  objectNameFromDocument: sucuObjectNameFromDocument,
  validateDocument: validateSucuDocument,
  example: sucuExample,
};
