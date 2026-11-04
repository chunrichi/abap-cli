/**
 * AUTH (authorization field, transaction SU20) — authorization-family document.
 *
 * One local JSON document maps the `AUTHX` maintenance row plus its TADIR
 * metadata. The file is `<token>.auth.json` (AFF layout, name from the file
 * token — the document carries neither name nor package).
 *
 * The upstream SAP abap-file-formats `auth-v1.json` models only
 * `generalInformation.dataElement` and `alternativeSearchHelp.checkTable`; the
 * AUTHX row also stores `EXIT_FB` (search-help exit) and `ACTVT_FLAG` (activity
 * field), so the local `auth-v1.json` keeps the upstream property names and adds
 * `generalInformation.searchHelpExit` / `generalInformation.activityField`.
 * The AFF header is omitted: AUTH has no text table to carry a description or
 * language for.
 *
 * Wire: the bundled ICF service `GET/POST/PUT/DELETE /auth/auth/<name>`; the
 * package and transport request travel as query parameters (the write body is
 * the document itself). `name` / `package` in a GET response are read-side
 * metadata and are stripped before the local file is written.
 */
import { defineWireArtifact } from '../artifact.js';
import { validateAff } from '../../aff/schema-validator.js';
import { CliError } from '../../output/json.js';
import type { ErrorCode } from '../../output/error-codes.js';
import type { AuthTypeSpec } from './spec.js';

/** AUTHX-FIELDNAME is CHAR 30; SU20 field names are upper-case ABAP names. */
export const AUTH_NAME_MAX_LENGTH = 30;

/** AUTHX name character set: plain names plus `/NS/NAME` and `NS/NAME` shapes. */
const AUTH_NAME_PATTERN = /^\/?[A-Z0-9_]+(\/[A-Z0-9_]+)*$/;

/** DDIC object names (data element, table, function module): plain or `/NS/NAME`. */
const DDIC_NAME_PATTERN = /^(?:[A-Z0-9_]+|\/[A-Z0-9_]+\/[A-Z0-9_]+)$/;

export interface AuthGeneralInformation {
  /** AUTHX-ROLLNAME: data element, required. */
  dataElement: string;
  /** Local extension: AUTHX-EXIT_FB search-help exit function module. */
  searchHelpExit?: string;
  /** Local extension: AUTHX-ACTVT_FLAG = 'X' (field is an activity field). */
  activityField?: boolean;
}

export interface AuthAlternativeSearchHelp {
  /** AUTHX-CHECKTABLE: alternative search-help check table. */
  checkTable?: string;
}

/** Local `<token>.auth.json` document. */
export interface AuthLocal {
  formatVersion: '1';
  generalInformation: AuthGeneralInformation;
  alternativeSearchHelp?: AuthAlternativeSearchHelp;
}

/** GET response document: the local document plus read-side metadata. */
export interface AuthWire extends AuthLocal {
  name?: string;
  package?: string;
}

/**
 * Loose shape of the ICF wire document. `/ui2/cl_json` serializes `abap_bool`
 * as a JSON boolean and CHAR fields that were never set as empty strings, and a
 * `name` / `package` read-side pair rides on top of the local fields.
 */
interface AuthWireShape {
  formatVersion?: string;
  generalInformation?: {
    dataElement?: string;
    searchHelpExit?: string;
    activityField?: boolean | string;
  } | null;
  alternativeSearchHelp?: { checkTable?: string } | null;
  name?: string;
  package?: string;
}

/** GET wire → local document (drops `name` / `package`, empty optional fields). */
export function authFromWire(wire: AuthWireShape | undefined): AuthLocal {
  const general = wire?.generalInformation ?? {};
  const alternative = wire?.alternativeSearchHelp ?? {};
  const local: AuthLocal = {
    formatVersion: '1',
    generalInformation: {
      dataElement: (general.dataElement ?? '').trim().toUpperCase(),
    },
  };
  const searchHelpExit = (general.searchHelpExit ?? '').trim().toUpperCase();
  if (searchHelpExit) local.generalInformation.searchHelpExit = searchHelpExit;
  // `abap_bool` may come back as a JSON boolean or as 'X' depending on the
  // serialization path; accept both and normalize to a clean boolean.
  if (general.activityField === true || general.activityField === 'X') {
    local.generalInformation.activityField = true;
  }
  const checkTable = (alternative.checkTable ?? '').trim().toUpperCase();
  if (checkTable) local.alternativeSearchHelp = { checkTable };
  return local;
}

/** Local document → POST/PUT body. */
export function authToWire(local: AuthLocal): AuthWire {
  const wire: AuthWire = {
    formatVersion: '1',
    generalInformation: {
      dataElement: (local.generalInformation?.dataElement ?? '').trim().toUpperCase(),
      searchHelpExit: (local.generalInformation?.searchHelpExit ?? '').trim().toUpperCase(),
      activityField: local.generalInformation?.activityField === true,
    },
    alternativeSearchHelp: {
      checkTable: (local.alternativeSearchHelp?.checkTable ?? '').trim().toUpperCase(),
    },
  };
  return wire;
}

/** Semantic checks the JSON schema cannot express. */
export function validateAuthDocument(local: AuthLocal): string[] {
  const errors: string[] = [];
  const general = local?.generalInformation ?? ({} as AuthGeneralInformation);
  const dataElement = (general.dataElement ?? '').trim().toUpperCase();
  if (!dataElement) {
    errors.push('generalInformation.dataElement is required');
  } else if (dataElement.length > AUTH_NAME_MAX_LENGTH || !DDIC_NAME_PATTERN.test(dataElement)) {
    errors.push(`generalInformation.dataElement "${dataElement}" is not a valid data element name`);
  }
  const searchHelpExit = (general.searchHelpExit ?? '').trim().toUpperCase();
  if (searchHelpExit && (searchHelpExit.length > AUTH_NAME_MAX_LENGTH || !DDIC_NAME_PATTERN.test(searchHelpExit))) {
    errors.push(`generalInformation.searchHelpExit "${searchHelpExit}" is not a valid function module name`);
  }
  const checkTable = (local?.alternativeSearchHelp?.checkTable ?? '').trim().toUpperCase();
  if (checkTable && (checkTable.length > AUTH_NAME_MAX_LENGTH || !DDIC_NAME_PATTERN.test(checkTable))) {
    errors.push(`alternativeSearchHelp.checkTable "${checkTable}" is not a valid table name`);
  }
  return errors;
}

/** AUTH artifact: file/schema plumbing + local ↔ ICF wire mapping. */
export const authArtifact = defineWireArtifact<AuthLocal, AuthWire>({
  type: 'AUTH',
  toWire: (local) => authToWire(local),
  fromWire: (wire) => authFromWire(wire as AuthWireShape),
  validate: async (doc) => {
    const result = await validateAff('AUTH', doc);
    const schemaErrors =
      result.status === 'pass' || result.status === 'warn'
        ? []
        : result.errors.map((error) => `${error.instancePath || '/'}: ${error.message ?? ''}`);
    return [...schemaErrors, ...validateAuthDocument(doc as AuthLocal)];
  },
});

/**
 * AUTH filename token → SAP object name. AFF `(ns)name` for well-formed
 * namespaces; local `~` escape for any other slash (`ACCGO/SID` → `accgo~sid`,
 * the one interior-slash AUTHX name on the reference system).
 */
export function authNameFromToken(token: string, basename?: string): string {
  if (token.startsWith('#')) {
    throw new CliError(
      'FILE_PARSE_ERROR',
      `${basename ?? token} uses the retired '#' namespace token; abap-file-format names use '(...)'`,
      {
        file: basename ?? token,
        nextSteps: ['Re-run `abap pull` for the object to write the AFF-style file name.'],
        example: 'abap pull ZCLI_TC_AUTH_X1 --type AUTH',
      },
    );
  }
  const namespaced = /^\(([^)]+)\)(.+)$/.exec(token);
  const name = (namespaced ? `/${namespaced[1]!}/${namespaced[2]!}` : token.replace(/~/g, '/')).toUpperCase();
  if (name.length === 0 || name.length > AUTH_NAME_MAX_LENGTH || !AUTH_NAME_PATTERN.test(name)) {
    throw new CliError('FILE_PARSE_ERROR', `${basename ?? token} does not encode a valid AUTH object name`, {
      file: basename ?? token,
      nextSteps: ['The file name token must be the AFF `(ns)name` form or the lower-case object name.'],
      example: 'abap pull ZCLI_TC_AUTH_X1 --type AUTH',
    });
  }
  return name;
}

/** SAP object name → AUTH filename token. */
export function authFileToken(name: string): string {
  const namespaced = /^\/([^/]+)\/([^/]+)$/.exec(name);
  if (namespaced) return `(${namespaced[1]!.toLowerCase()})${namespaced[2]!.toLowerCase()}`;
  return name.toLowerCase().replace(/\//g, '~');
}

/** Normalize + validate one AUTH object name (CLI argument or route segment). */
export function normalizeAuthName(raw: string): string {
  const name = (raw ?? '').trim().toUpperCase();
  if (name.length === 0 || name.length > AUTH_NAME_MAX_LENGTH || !AUTH_NAME_PATTERN.test(name)) {
    throw new CliError('AUTH_NAME_INVALID' as ErrorCode, `AUTH name "${raw}" is invalid`, {
      type: 'AUTH',
      nextSteps: [
        `Use 1-${AUTH_NAME_MAX_LENGTH} characters A-Z, 0-9, _ or '/' (e.g. ZCLI_TC_AUTH_FIELD, /AIF/SEROB).`,
        'The AUTHX pseudo entry .INCLUDE is not an object and cannot be managed through abap-cli.',
      ],
      example: 'abap create AUTH ZCLI_TC_AUTH_FIELD --package $TMP --file src/zcli_tc_auth_field.auth.json',
    });
  }
  return name;
}

/** Minimal valid document for `abap create --schema AUTH`. */
export function authExample(): AuthLocal {
  return {
    formatVersion: '1',
    generalInformation: { dataElement: 'ACTIV_AUTH', activityField: true },
    alternativeSearchHelp: { checkTable: 'TACT' },
  };
}

export const authSpec: AuthTypeSpec<AuthLocal> = {
  type: 'AUTH',
  route: 'auth',
  tadirObject: 'AUTH',
  schemaFile: 'auth-v1.json',
  description: 'Authorization field (SU20)',
  nameMaxLength: AUTH_NAME_MAX_LENGTH,
  artifact: authArtifact,
  normalizeName: normalizeAuthName,
  fileToken: authFileToken,
  nameFromToken: (token, basename) => authNameFromToken(token, basename),
  validateDocument: validateAuthDocument,
  example: authExample,
};
