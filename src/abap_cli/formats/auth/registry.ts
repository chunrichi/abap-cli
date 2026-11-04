/**
 * Registry of the authorization-family type specs.
 *
 * The per-type modules own the document shape and name rules; the family flows
 * look them up by CLI type code here. Keep `AUTH_TYPE_CODES` (spec.ts) as the
 * single ordering source for `abap types`.
 */
import { AUTH_TYPE_CODES, type AuthTypeCode, type AuthTypeSpec } from './spec.js';
import { authSpec } from './auth.js';
import { suscSpec } from './susc.js';
import { sucuSpec } from './sucu.js';
import { sushSpec } from './sush.js';
import { susoSpec } from './suso.js';

// The concrete specs have different local document types; the registry keeps
// them type-erased so the family flows can stay generic (`<TLocal>` is
// re-established per flow call).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SPECS: Record<AuthTypeCode, AuthTypeSpec<any>> = {
  AUTH: authSpec,
  SUSC: suscSpec,
  SUCU: sucuSpec,
  SUSH: sushSpec,
  SUSO: susoSpec,
};

/** Whether the type code belongs to the authorization family. */
export function isAuthType(type: string): type is AuthTypeCode {
  return (AUTH_TYPE_CODES as readonly string[]).includes(type);
}

/** Type-erased spec for a known family type code. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function authSpecOf(type: AuthTypeCode): AuthTypeSpec<any> {
  return SPECS[type];
}

/** All family specs, in `AUTH_TYPE_CODES` order. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function allAuthSpecs(): AuthTypeSpec<any>[] {
  return AUTH_TYPE_CODES.map((type) => SPECS[type]);
}
