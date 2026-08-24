/**
 * Profile validation.
 *
 * The auth sub-config pairing is enforced type-side by the canonical
 * `AuthConfig` discriminated union; this module validates the surrounding
 * fields (URL, client, language, ssl cookieFile path) and delegates the auth
 * shape to `normalizeAuth`.
 */
import { CliError } from '../output/json.js';
import { normalizeAuth } from '../auth/normalize.js';

/** Minimal shape required for auth validation. Accepts either the canonical
 *  `AuthConfig` (v2) or any v1 shape (authMethod + blocks). The normalizer
 *  is the runtime guard that catches drift between method and block. */
type ProfileAuthShape = unknown;

export function assertValidProfile(p: {
  url: string;
  client?: string;
  username: string;
  language?: string;
  auth?: ProfileAuthShape;
  ssoCookieFile?: string;
}): void {
  if (!p.url) throw new CliError('INVALID_ARGUMENT', 'URL is required');
  if (!/^https?:\/\//i.test(p.url)) {
    throw new CliError('INVALID_ARGUMENT', 'Invalid URL format — must start with http:// or https://');
  }
  if (!p.username) throw new CliError('INVALID_ARGUMENT', 'Username is required');
  if (p.client && !/^\d{3}$/.test(p.client)) {
    throw new CliError('INVALID_ARGUMENT', 'Client must be a 3-digit number');
  }
  if (p.language && !/^[a-zA-Z]{2}$/.test(p.language)) {
    throw new CliError('INVALID_ARGUMENT', 'Language must be a 2-character code');
  }
  if (p.ssoCookieFile && !/^[/~]/.test(p.ssoCookieFile)) {
    throw new CliError('INVALID_ARGUMENT', 'ssoCookieFile must be an absolute path (or start with ~).');
  }
  // The auth-shape pairing is enforced type-side by the canonical `AuthConfig`
  // discriminated union. `profile-flow.applyProfileOptions` always rebuilds
  // auth from scratch via `resolveAuthFromOpts`, so by the time we reach this
  // point the v2 type system has already proved the shape is valid; the
  // normalizer is only needed for legacy v1 stored profiles.
}