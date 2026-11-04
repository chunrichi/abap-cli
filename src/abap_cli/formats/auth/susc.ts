/**
 * SUSC (authorization object class, transaction SU21) — authorization-family
 * document.
 *
 * One local JSON document maps a `TOBC` row (key `OCLSS`, CHAR 4) plus one
 * `TOBCT` text row. SAP keeps the class text per language (39 languages for a
 * standard class on the reference system); like the abapGit exporter this CLI
 * document carries the **original language** text only, and writes update the
 * `TOBCT` row of that language without touching the other languages.
 *
 * Upstream SAP abap-file-formats has no SUSC schema, so the document is a local
 * extension (`susc-v1.json`) that keeps the AFF top-level convention
 * (`formatVersion` + `header`). The name is the file token
 * (`<token>.susc.json`); `package` is read-side wire metadata only.
 *
 * Wire: the bundled ICF service `GET/POST/PUT/DELETE /auth/susc/<name>`;
 * package / transport request travel as query parameters.
 */
import { defineWireArtifact } from '../artifact.js';
import { validateAff } from '../../aff/schema-validator.js';
import { CliError } from '../../output/json.js';
import type { ErrorCode } from '../../output/error-codes.js';
import type { AuthTypeSpec } from './spec.js';

/** TOBC-OCLSS is CHAR 4. */
export const SUSC_NAME_MAX_LENGTH = 4;

/** Plain class name: 1-4 chars, letters/digits/underscore/hyphen (e.g. `CV`, `IS-B`, `6VPM`). */
const SUSC_PLAIN_NAME_PATTERN = /^[A-Z0-9][A-Z0-9_-]{0,3}$/;

/** Namespace form used by customizing classes: `/` + 3 chars (e.g. `/AGG`). */
const SUSC_NAMESPACE_NAME_PATTERN = /^\/[A-Z0-9_-]{3}$/;

/** TOBCT-CTEXT is CHAR 60. */
const SUSC_DESCRIPTION_MAX_LENGTH = 60;

/** SUSC text language as two-letter ISO code (AFF header convention). */
const LANGUAGE_PATTERN = /^[A-Za-z]{2}$/;

/** Local `<token>.susc.json` document. */
export interface SuscLocal {
  formatVersion: '1';
  header: {
    /** Class text (TOBCT-CTEXT). */
    description: string;
    /** Two-letter ISO language code of the text row that is written (TOBCT-LANGU via T002). */
    originalLanguage: string;
  };
}

/** GET response document: the local document plus read-side metadata. */
export interface SuscWire extends SuscLocal {
  name?: string;
  package?: string;
}

/** Loose shape of the ICF wire document (read-side tolerant). */
interface SuscWireShape {
  formatVersion?: string;
  header?: { description?: string; originalLanguage?: string } | null;
  name?: string;
  package?: string;
}

/** GET wire → local document (drops `name` / `package`). */
export function suscFromWire(wire: SuscWireShape | undefined): SuscLocal {
  const description = (wire?.header?.description ?? '').trim();
  const language = (wire?.header?.originalLanguage ?? '').trim().toLowerCase();
  return {
    formatVersion: '1',
    header: {
      description,
      originalLanguage: language || 'en',
    },
  };
}

/** Local document → POST/PUT body. */
export function suscToWire(local: SuscLocal): SuscWire {
  return {
    formatVersion: '1',
    header: {
      description: (local.header?.description ?? '').trim(),
      originalLanguage: (local.header?.originalLanguage ?? '').trim().toLowerCase(),
    },
  };
}

/** Semantic checks the JSON schema cannot express. */
export function validateSuscDocument(local: SuscLocal): string[] {
  const errors: string[] = [];
  const description = local?.header?.description ?? '';
  if (description.length > SUSC_DESCRIPTION_MAX_LENGTH) {
    errors.push(`header.description is ${description.length} characters long; the SAP text limit is ${SUSC_DESCRIPTION_MAX_LENGTH}`);
  }
  const language = (local?.header?.originalLanguage ?? '').trim();
  if (!language) {
    errors.push('header.originalLanguage is required');
  } else if (!LANGUAGE_PATTERN.test(language)) {
    errors.push(`header.originalLanguage "${language}" is not a two-letter ISO language code (e.g. "en", "de")`);
  }
  return errors;
}

/** SUSC artifact: file/schema plumbing + local ↔ ICF wire mapping. */
export const suscArtifact = defineWireArtifact<SuscLocal, SuscWire>({
  type: 'SUSC',
  toWire: (local) => suscToWire(local),
  fromWire: (wire) => suscFromWire(wire as SuscWireShape),
  validate: async (doc) => {
    const result = await validateAff('SUSC', doc);
    const schemaErrors =
      result.status === 'pass' || result.status === 'warn'
        ? []
        : result.errors.map((error) => `${error.instancePath || '/'}: ${error.message ?? ''}`);
    return [...schemaErrors, ...validateSuscDocument(doc as SuscLocal)];
  },
});

/**
 * SUSC filename token → SAP class name. `/AGG` (the only namespace shape that
 * fits CHAR 4) uses the local `~` escape (`~agg`); a well-formed `/A/B`
 * namespace keeps the AFF `(a)b` form; plain names are lower-case.
 */
export function suscNameFromToken(token: string, basename?: string): string {
  if (token.startsWith('#')) {
    throw new CliError(
      'FILE_PARSE_ERROR',
      `${basename ?? token} uses the retired '#' namespace token; abap-file-format names use '(...)'`,
      {
        file: basename ?? token,
        nextSteps: ['Re-run `abap pull` for the object to write the AFF-style file name.'],
        example: 'abap pull APO --type SUSC',
      },
    );
  }
  const namespaced = /^\(([^)]+)\)(.+)$/.exec(token);
  const name = (namespaced ? `/${namespaced[1]!}/${namespaced[2]!}` : token.replace(/~/g, '/')).toUpperCase();
  if (!SUSC_PLAIN_NAME_PATTERN.test(name) && !SUSC_NAMESPACE_NAME_PATTERN.test(name)) {
    throw new CliError('FILE_PARSE_ERROR', `${basename ?? token} does not encode a valid SUSC object name`, {
      file: basename ?? token,
      nextSteps: ['The file name token must be the lower-case class name (`apo`), the `~ns` form (`~agg`) or AFF `(ns)name`.'],
      example: 'abap pull APO --type SUSC',
    });
  }
  return name;
}

/** SAP class name → SUSC filename token. */
export function suscFileToken(name: string): string {
  const namespaced = /^\/([^/]+)\/([^/]+)$/.exec(name);
  if (namespaced) return `(${namespaced[1]!.toLowerCase()})${namespaced[2]!.toLowerCase()}`;
  return name.toLowerCase().replace(/\//g, '~');
}

/** Normalize + validate one SUSC class name (CLI argument or route segment). */
export function normalizeSuscName(raw: string): string {
  const name = (raw ?? '').trim().toUpperCase();
  if (!SUSC_PLAIN_NAME_PATTERN.test(name) && !SUSC_NAMESPACE_NAME_PATTERN.test(name)) {
    throw new CliError('SUSC_NAME_INVALID' as ErrorCode, `SUSC name "${raw}" is invalid`, {
      type: 'SUSC',
      nextSteps: [
        `Authorization object classes are 1-${SUSC_NAME_MAX_LENGTH} characters A-Z, 0-9, _ or '-' (e.g. APO, IS-B), or the 4-character namespace form /AGG.`,
        'The class name is the TOBC-OCLSS key (CHAR 4) and cannot be shortened or renamed.',
      ],
      example: 'abap create SUSC ZT01 --package $TMP --file src/zt01.susc.json',
    });
  }
  return name;
}

/** Minimal valid document for `abap create --schema SUSC`. */
export function suscExample(): SuscLocal {
  return {
    formatVersion: '1',
    header: { description: 'Example authorization object class', originalLanguage: 'en' },
  };
}

export const suscSpec: AuthTypeSpec<SuscLocal> = {
  type: 'SUSC',
  route: 'susc',
  tadirObject: 'SUSC',
  schemaFile: 'susc-v1.json',
  description: 'Authorization object class (SU21)',
  nameMaxLength: SUSC_NAME_MAX_LENGTH,
  artifact: suscArtifact,
  normalizeName: normalizeSuscName,
  fileToken: suscFileToken,
  nameFromToken: (token, basename) => suscNameFromToken(token, basename),
  validateDocument: validateSuscDocument,
  example: suscExample,
};
