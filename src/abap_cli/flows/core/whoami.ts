/**
 * `abap whoami` flow — report the identity the SAP system says the current
 * session runs as.
 *
 * The identity is NOT read from the local profile: the bundled ICF service
 * answers `GET /sap/abap_cli/whoami` from the ABAP session that authenticated
 * the HTTP request (`sy-uname`, `sy-sysid`, `sy-mandt`, ...). That keeps the
 * answer truthful when the auth method changes later (SSO / ticket / any
 * future mechanism): the system, not the CLI config, states who the caller is.
 *
 * Profile name and endpoint are still projected because they are connection
 * context, not identity: they tell the reader which workspace binding produced
 * the answer. No secret is ever projected.
 */

import type { IcfResponse } from '../../clients/icf-client.js';
import { IcfClient } from '../../clients/icf-client.js';
import type { SystemIdentity } from '../../clients/system-identity.js';
import type { ProjectConfig } from '../../config/project-config.js';
import { CliError } from '../../output/json.js';

/** Minimum client surface the flow needs — lets unit tests pass a fake. */
export interface WhoamiClient {
  getConfig(): ProjectConfig;
  getSystemIdentity(): Promise<IcfResponse<SystemIdentity>>;
}

/** Server-side environment facts, projected only when reported. */
export interface WhoamiServerFacts {
  applicationServer?: string;
  database?: string;
  os?: string;
  abapRelease?: string;
}

/** `data` payload of `abap whoami --json`; unknown fields are omitted. */
export interface WhoamiData {
  profile: string;
  url: string;
  system: string;
  client: string;
  user: string;
  server?: WhoamiServerFacts;
}

export interface WhoamiResult {
  data: WhoamiData;
  human: string;
}

/** The deployed ICF service does not expose /whoami (not deployed / outdated). */
function identityUnavailable(cause: CliError, profileName: string): CliError {
  return new CliError(
    'ICF_IDENTITY_UNAVAILABLE',
    `The bundled abap_cli ICF service on profile '${profileName}' does not expose /whoami — the service is not deployed or outdated.`,
    {
      details: { cause: cause.message },
      nextSteps: [
        'Deploy the current bundled ICF service: abap deploy --yes',
        'Confirm the deployed service version: abap deploy status --json',
      ],
      example: 'abap deploy --yes',
      references: 'skills/abap-cli-setup/references/errors.md#icf_identity_unavailable',
    },
  );
}

/**
 * True when the failure means "this ICF service has no /whoami route": either
 * an old handler's JSON NOT_FOUND envelope, or a plain 404 when the SICF node
 * is absent. Every other failure (TLS / auth / server error) propagates as-is.
 */
function isMissingIdentityRoute(error: unknown): error is CliError {
  if (!(error instanceof CliError)) return false;
  if (error.code === 'NOT_FOUND') return true;
  return error.code === 'SAP_ERROR' && error.details?.httpStatus === 404;
}

/** Read the system-reported identity, translating only the "old service" case. */
async function readSystemIdentity(client: WhoamiClient): Promise<SystemIdentity> {
  let response: IcfResponse<SystemIdentity>;
  try {
    response = await client.getSystemIdentity();
  } catch (error: unknown) {
    if (isMissingIdentityRoute(error)) throw identityUnavailable(error, client.getConfig().systemName);
    throw error;
  }
  if (response.status !== 'success' || !response.data) {
    throw new CliError(
      'SAP_ERROR',
      `ICF /whoami returned no identity data${response.error?.message ? `: ${response.error.message}` : ''}`,
    );
  }
  const identity = response.data;
  if (!identity.user || !identity.systemId || !identity.client) {
    throw new CliError('SAP_ERROR', 'ICF /whoami returned an incomplete identity (user / systemId / client missing).');
  }
  return identity;
}

/** Project the connection context + system-reported identity into `data`. */
export function projectWhoami(config: ProjectConfig, identity: SystemIdentity): WhoamiData {
  const data: WhoamiData = {
    profile: config.systemName,
    url: config.sap.url,
    system: identity.systemId,
    client: identity.client,
    user: identity.user,
  };
  const server: WhoamiServerFacts = {};
  if (identity.applicationServer) server.applicationServer = identity.applicationServer;
  if (identity.database) server.database = identity.database;
  if (identity.os) server.os = identity.os;
  if (identity.abapRelease) server.abapRelease = identity.abapRelease;
  if (Object.keys(server).length > 0) data.server = server;
  return data;
}

/** Human-readable identity block (one labelled line per fact group). */
export function renderWhoami(data: WhoamiData): string {
  const lines = [
    'Connection identity:',
    `  profile:  ${data.profile}`,
    `  system:   ${data.system} client ${data.client}`,
    `  user:     ${data.user}`,
  ];
  lines.push(`  url:      ${data.url}`);
  if (data.server) {
    const facts: string[] = [];
    if (data.server.database) facts.push(data.server.database);
    if (data.server.os) facts.push(data.server.os);
    if (data.server.applicationServer) facts.push(data.server.applicationServer);
    if (data.server.abapRelease) facts.push(`ABAP ${data.server.abapRelease}`);
    lines.push(`  server:   ${facts.join(' · ')}`);
  }
  return lines.join('\n');
}

/** Run the identity check through the bundled ICF service (or a fake). */
export async function runWhoami(client?: WhoamiClient): Promise<WhoamiResult> {
  const whoamiClient = client ?? (await IcfClient.create());
  const identity = await readSystemIdentity(whoamiClient);
  const data = projectWhoami(whoamiClient.getConfig(), identity);
  return { data, human: renderWhoami(data) };
}
