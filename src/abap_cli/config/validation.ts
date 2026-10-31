/**
 * Profile validation.
 *
 * Basic auth is the only supported login method: username + a password stored
 * in the OS keychain. This module validates the surrounding profile fields and
 * rejects entries that still declare a removed auth method.
 */
import { CliError } from '../output/json.js';
import type { SystemProfile } from './user-config.js';

/** Profile names become systems.json keys and keychain accounts; keep them
 *  shell/URL friendly and stable across export/import. */
const PROFILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

export function assertValidProfileName(name: string): void {
  if (PROFILE_NAME_PATTERN.test(name)) return;
  throw new CliError(
    'INVALID_ARGUMENT',
    `Invalid profile name '${name}' — use 1-64 characters: letters, digits, '_', '.', '-', starting with a letter or digit`,
    {
      nextSteps: ["Use a name like 'dev' or 'qa-100'."],
      example: 'abap profile add dev --url <url> --username <user> --password <password>',
    },
  );
}

export interface NormalizedProfileUrl {
  /** Scheme + host + port only (no path, query, fragment, credentials). */
  url: string;
  /** Non-trivial parts that were dropped, e.g. `path '/sap/bc/ui2/flp'`. */
  dropped: string[];
}

/**
 * Normalize a user-supplied SAP URL to the ADT API origin.
 *
 * Users commonly paste a browser URL (Fiori launchpad, WebGUI, a deep link).
 * The ADT client appends `/sap/bc/adt/...` to the configured base URL, so any
 * path/query/fragment kept here produces 404s. Official ADT uses the same
 * cleanup ("strip path/query/fragment, then probe the API URL").
 */
export function normalizeProfileUrl(raw: string): NormalizedProfileUrl {
  const trimmed = raw.trim();
  if (!trimmed) throw new CliError('INVALID_ARGUMENT', 'URL is required');
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new CliError('INVALID_ARGUMENT', 'Invalid URL format — must start with http:// or https://');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new CliError('INVALID_ARGUMENT', 'Invalid URL format — must start with http:// or https://');
  }
  if (parsed.username || parsed.password) {
    throw new CliError(
      'INVALID_ARGUMENT',
      'URL must not embed credentials — pass --username/--password instead',
      {
        nextSteps: ['Remove the user:pass@ part from the URL.'],
        example: 'abap profile add dev --url https://sap.example.com:44300 --username DEV --password <password>',
      },
    );
  }
  const dropped: string[] = [];
  if (parsed.pathname && parsed.pathname !== '/') dropped.push(`path '${parsed.pathname}'`);
  if (parsed.search) dropped.push(`query '${parsed.search}'`);
  if (parsed.hash) dropped.push(`fragment '${parsed.hash}'`);
  return { url: parsed.origin, dropped };
}

/** Validate the profile fields that every write path must satisfy. */
export function assertValidProfile(p: {
  url: string;
  client?: string;
  username: string;
  language?: string;
}): void {
  if (!p.url) throw new CliError('INVALID_ARGUMENT', 'URL is required');
  normalizeProfileUrl(p.url);
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
