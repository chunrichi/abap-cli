/**
 * Short-lived raw `ADTClient` sessions for probe-style work.
 *
 * A few flows must talk to SAP before the workspace wrapper (`AdtClientWrapper`)
 * exists or makes sense: `profile test` / `init` probe a profile that may not be
 * bound to the current workspace yet, and the runtime probe runs while
 * `deploy` is still deciding which channel to use. Those flows cannot use the
 * wrapper's cookie jar, but they *do* open a real stateful SAP session on every
 * `login()`.
 *
 * That makes the lifecycle non-optional: every session opened here must be
 * released, otherwise each `profile test` / `abap deploy` leaves an entry in
 * SM04 (the SAP user-session list). Leaked sessions pile up until the ICM
 * session table is exhausted — at which point SAP answers logins with an
 * anonymous `sap-contextid` only and every stateful ADT request fails with
 * `400 Session not found`.
 *
 * Use `withRawAdtSession` so the release happens on the error path too.
 */

import type { ADTClient, ClientOptions } from 'abap-adt-api';

/** Connection inputs shared by every raw probe client. */
export interface RawAdtSessionConfig {
  url: string;
  username: string;
  password: string;
  client: string;
  language: string;
  options: ClientOptions;
}

export interface RawAdtSession {
  readonly client: ADTClient;
  /** Best-effort logout. Idempotent and never throws. */
  close(): Promise<void>;
}

/**
 * Log in and hand out the client. The caller owns the returned session and
 * must call `close()` — prefer `withRawAdtSession`, which does it for you.
 */
export async function openRawAdtSession(config: RawAdtSessionConfig): Promise<RawAdtSession> {
  const { ADTClient } = await import('abap-adt-api');
  const client = new ADTClient(config.url, config.username, config.password, config.client, config.language, config.options);
  await client.login();
  let closed = false;
  return {
    client,
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      try {
        await client.logout();
      } catch {
        // Best-effort: a failed logout must never mask the probe result.
      }
    },
  };
}

/**
 * Run `fn` against a logged-in raw client and always release the SAP session.
 * Probe failures are the caller's business; the session release is not.
 */
export async function withRawAdtSession<T>(
  config: RawAdtSessionConfig,
  fn: (client: ADTClient) => Promise<T>,
): Promise<T> {
  const session = await openRawAdtSession(config);
  try {
    return await fn(session.client);
  } finally {
    await session.close();
  }
}
