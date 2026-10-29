/**
 * BTP service-key parsing (shared by `abap profile add/set`, `abap init`
 * and the oauth_password auth strategy).
 */
import { CliError } from '../output/json.js';

/** BTP service-key JSON shape we care about. Other fields are ignored. */
interface BtpServiceKeyShape {
  uaa?: { url?: string; clientid?: string; clientsecret?: string };
}

/**
 * Parse a BTP service-key JSON file and extract the OAuth clientid/secret/uaaUrl.
 * Shared between `abap profile add/set` and `abap init` so the file-shape
 * contract lives in one place.
 */
export function parseBtpServiceKey(raw: unknown): { uaaUrl: string; clientId: string; clientSecret: string } {
  const sk = raw as BtpServiceKeyShape;
  if (!sk?.uaa?.url || !sk.uaa.clientid || !sk.uaa.clientsecret) {
    throw new CliError('INVALID_ARGUMENT',
      'Service key missing uaa.url / uaa.clientid / uaa.clientsecret.',
      { example: 'Download the JSON-format service key (not the binding-secret format).' });
  }
  return { uaaUrl: sk.uaa.url, clientId: sk.uaa.clientid, clientSecret: sk.uaa.clientsecret };
}
