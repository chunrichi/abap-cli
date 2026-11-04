/**
 * Shared contract for the authorization-object family: AUTH / SUSC / SUCU /
 * SUSH / SUSO.
 *
 * These five types have no ADT resource on the supported releases and no AFF
 * object handler, so they are served by hand-written routes of the bundled ICF
 * service (`/auth/<sub>/<name>`) ported from the abapGit handlers. The local
 * file is one JSON document per object; the per-type module owns its document
 * shape (upstream AFF schema when the field model fits, local `<sub>-v1.json`
 * extension otherwise), the name rules and the wire mapping.
 *
 * The family flows (`create-auth` / `pull-auth` / `push-auth` / `delete-auth`)
 * stay type-agnostic: they look the spec up by CLI type code and then follow
 * one uniform lifecycle (POST create, GET pull, PUT update, DELETE delete) with
 * the shared transport rule (`$` package transport-free, otherwise `--tr`).
 */
import type { WireArtifact } from '../artifact.js';

/** CLI type codes of the family, in `abap types` order. */
export const AUTH_TYPE_CODES = ['AUTH', 'SUSC', 'SUCU', 'SUSH', 'SUSO'] as const;
export type AuthTypeCode = (typeof AUTH_TYPE_CODES)[number];

/** Lowercase route segment of one family member (`/auth/<route>/<name>`). */
export type AuthRoute = 'auth' | 'susc' | 'sucu' | 'sush' | 'suso';

/**
 * One authorization-family type. The per-type module implements this; the
 * family flows and the wiring tables only consume it.
 */
export interface AuthTypeSpec<TLocal = unknown> {
  /** CLI type code (uppercase). */
  readonly type: AuthTypeCode;
  /** ICF route segment below `/auth/` (lowercase). */
  readonly route: AuthRoute;
  /** TADIR object type recorded for the object (`abap types` catalog). */
  readonly tadirObject: string;
  /** AFF schema filename used for local validation (`<sub>-v1.json`). */
  readonly schemaFile: string;
  /** One-line description for `abap types` / `create --schema`. */
  readonly description: string;
  /** SAP-side object-name length limit. */
  readonly nameMaxLength: number;
  /** Local document validator + wire mapping. */
  readonly artifact: WireArtifact<TLocal, unknown>;
  /**
   * Uppercase and validate one CLI/route object name. Throws
   * `CliError('<TYPE>_NAME_INVALID', ...)` for an illegal name.
   */
  normalizeName(raw: string): string;
  /** Canonical AFF filename token for `abap pull` (`(ns)name` for simple names). */
  fileToken(name: string): string;
  /**
   * Reverse of {@link fileToken}: read the canonical SAP object name back from
   * the filename token (`abap push`). Throws `FILE_PARSE_ERROR` when the token
   * cannot encode this type's names.
   */
  nameFromToken(token: string, basename?: string): string;
  /**
   * When the local document itself carries the object key (composite TADIR
   * names, e.g. SUCU/SUSH), return that canonical name so a push can detect a
   * file/serve-name mismatch. Return `undefined` for name-less AFF documents.
   */
  objectNameFromDocument?(local: TLocal): string | undefined;
  /** Semantic checks beyond the JSON schema; rendered into `<TYPE>_INVALID_PAYLOAD`. */
  validateDocument?(local: TLocal): string[];
  /** Minimal valid document for `abap create --schema <TYPE>`. */
  example(): TLocal;
}

/** Suffix of one family document (`<name>.<route>.json`). */
export function authFileSuffix(route: AuthRoute): string {
  return `.${route}.json`;
}

/** Route segment of a family type code. */
export function authRouteOf(type: AuthTypeCode): AuthRoute {
  return type.toLowerCase() as AuthRoute;
}
