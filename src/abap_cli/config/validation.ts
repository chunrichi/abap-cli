import { CliError } from '../output/json.js';

/** Shared profile field validation (used by init and system commands). */
export function assertValidProfile(p: { url: string; client?: string; username: string; language?: string }): void {
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
