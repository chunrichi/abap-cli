/**
 * Terminate a stateful ADT session.
 *
 * The legacy ICF logoff service (`/sap/public/bc/icf/logoff`) is disabled on
 * some systems and answers 403. `ADTClient.logout()` treats that as a hard
 * failure, and the old best-effort callers swallowed it: the SAP session stayed
 * in SM04, and every command leaked one more entry until SAP answered new
 * logins with an anonymous context and stateful ADT requests failed with
 * `400 Session not found`.
 *
 * SAP's own ADT clients close the context through the dedicated sessions
 * resource. NW 7.50 has no such resource; its stateful-header backport closes
 * the context on a stateless discovery request instead. Keep the legacy logoff
 * as the last resort and return the outcome so callers can warn instead of
 * silently dropping a failed cleanup.
 */
import { session_types, type ADTClient } from 'abap-adt-api';

const SESSIONS_PATH = '/sap/bc/adt/core/http/sessions';
const DISCOVERY_PATH = '/sap/bc/adt/core/discovery';

export type AdtSessionCloseOutcome =
  | 'closed'
  | 'closed-discovery'
  | 'logged-off'
  | 'not-needed'
  | 'failed';

export interface AdtSessionCloseResult {
  outcome: AdtSessionCloseOutcome;
  /** HTTP status of the failing request, when the transport exposed one. */
  status?: number;
}

/** Read a cookie value from the client's live cookie header. */
function cookieValue(client: ADTClient, name: string): string | undefined {
  const header = client.session?.cookieHeader?.() ?? '';
  const match = new RegExp(`(?:^|;\\s*)${name}=([^;]*)`, 'i').exec(header);
  return match?.[1];
}

/** SAP resets the context cookie to 0 when the context is gone. */
function contextClosed(client: ADTClient): boolean {
  const contextId = cookieValue(client, 'sap-contextid');
  return contextId === undefined || contextId === '' || contextId === '0';
}

/** HTTP status from `abap-adt-api` errors (AdtErrorException / AdtHttpException). */
function statusOf(error: unknown): number | undefined {
  const candidate = error as { err?: unknown; status?: unknown; response?: { status?: unknown } } | undefined;
  if (typeof candidate?.err === 'number') return candidate.err;
  if (typeof candidate?.status === 'number') return candidate.status;
  const responseStatus = candidate?.response?.status;
  return typeof responseStatus === 'number' ? responseStatus : undefined;
}

/** Drop the local session state after a remote close (or a failed one). */
function clearLocalSession(client: ADTClient): void {
  try {
    client.stateful = session_types.stateless;
  } catch {
    // Stateless clones reject the setter; their parent owns the context.
  }
  client.session?.clearCookies?.();
  if (client.httpClient) client.httpClient.csrfToken = 'fetch';
}

/** Last resort for systems without the close resource and its backport. */
async function legacyLogout(client: ADTClient, cause?: unknown): Promise<AdtSessionCloseResult> {
  try {
    await client.logout();
    return { outcome: 'logged-off' };
  } catch (error) {
    clearLocalSession(client);
    return { outcome: 'failed', status: statusOf(error) ?? statusOf(cause) };
  }
}

/**
 * Close the client's stateful SAP context (or, on old releases, log it off).
 * Never throws: callers only need the outcome for their warning.
 */
export async function closeAdtSession(client: ADTClient): Promise<AdtSessionCloseResult> {
  const cookieHeader = client.session?.cookieHeader?.();
  if (cookieHeader === undefined) return legacyLogout(client);

  const contextId = cookieValue(client, 'sap-contextid');
  if (contextId === undefined || contextId === '' || contextId === '0') {
    clearLocalSession(client);
    return { outcome: 'not-needed' };
  }

  // The close request must switch the same context to stateless.
  try {
    client.stateful = session_types.stateless;
  } catch {
    // Stateless clones reject the setter; the context still pins the header.
  }
  try {
    await client.httpClient.request(SESSIONS_PATH, {
      method: 'GET',
      headers: {
        Accept: '*/*',
        'sap-adt-purpose': 'close-session',
        'sap-contextid': contextId,
      },
    });
    clearLocalSession(client);
    return { outcome: 'closed' };
  } catch (error) {
    // NW 7.50 can return 400 after resetting the context cookie to 0.
    if (contextClosed(client)) {
      clearLocalSession(client);
      return { outcome: 'closed' };
    }
    if (statusOf(error) !== 404) return legacyLogout(client, error);

    try {
      await client.httpClient.request(DISCOVERY_PATH, { method: 'HEAD', headers: { Accept: '*/*' } });
      clearLocalSession(client);
      return { outcome: 'closed-discovery' };
    } catch (fallbackError) {
      if (contextClosed(client)) {
        clearLocalSession(client);
        return { outcome: 'closed-discovery' };
      }
      return legacyLogout(client, fallbackError);
    }
  }
}

/**
 * Warning line for a failed close, or `undefined` when cleanup succeeded.
 * The context is e.g. "after the command" / "after the probe".
 */
export function adtSessionCloseWarning(result: AdtSessionCloseResult, context: string): string | undefined {
  if (result.outcome !== 'failed') return undefined;
  const reason = result.status === undefined ? 'no HTTP status' : `HTTP ${result.status}`;
  return `could not close the SAP session ${context} (${reason}); it may remain in SM04 until SAP logs it out.`;
}
