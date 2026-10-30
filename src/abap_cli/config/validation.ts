/**
 * Profile validation.
 *
 * Basic auth is the only supported login method: username + a password stored
 * in the OS keychain. This module validates the surrounding profile fields and
 * rejects entries that still declare a removed auth method.
 */
import { CliError } from '../output/json.js';
import type { SystemProfile } from './user-config.js';

export function assertValidProfile(p: {
  url: string;
  client?: string;
  username: string;
  language?: string;
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
}

/**
 * Refuse to connect with a profile that still declares a removed auth method.
 * `unsupportedAuth` is populated by `loadUserConfig` from fields on disk; it
 * never reaches a write, so one successful `profile set` (or a recreated
 * profile) migrates the entry to basic auth.
 */
export function assertSupportedAuth(
  name: string,
  profile: Pick<SystemProfile, 'unsupportedAuth'>,
): void {
  if (!profile.unsupportedAuth) return;
  throw new CliError(
    'CONFIG_ERROR',
    `Profile '${name}' uses the removed '${profile.unsupportedAuth}' auth method; only basic auth (username + password) is supported.`,
    {
      nextSteps: [
        `Keep the profile and store a password: abap profile set ${name} --password <password>`,
        `Or recreate it from scratch: abap profile delete ${name} && abap profile add ${name} --url <url> --username <user> --password <password>`,
      ],
      example: `abap profile set ${name} --password <password>`,
    },
  );
}
