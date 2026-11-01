/**
 * Cookie-aware HTTP transport for the ADT client.
 *
 * `abap-adt-api`'s `ADTClient` accepts a custom `HttpClient` (public extension
 * point — see `ClientOptions`/`HttpClient` exports). Wrapping the library's
 * own `AxiosHttpClient` lets the session layer own the cookie set end to end:
 *
 *   - inject the persisted/just-captured cookies as a `Cookie` request header;
 *   - absorb every `Set-Cookie` response header into the live controller,
 *     including attributes the library's private cookie map strips.
 *
 * This removes the old `as AdtHttpLike` cast into the library's private
 * `cookie` Map: that cast silently stopped working on a library upgrade, which
 * turned every command into a fresh login (one orphan session each — exactly
 * the class of bug this redesign removes).
 */

import type { HttpClient } from 'abap-adt-api';
import type { HttpClientOptions, HttpClientResponse } from 'abap-adt-api/build/AdtHTTP.js';
import type { SessionCookieController } from '../session/cookies.js';

/** The library marks request statefulness with this header. */
const SESSION_TYPE_HEADER = 'X-sap-adt-sessiontype';

export class SessionHttpClient implements HttpClient {
  constructor(
    private readonly inner: HttpClient,
    private readonly cookies: SessionCookieController,
  ) {}

  async request(options: HttpClientOptions): Promise<HttpClientResponse> {
    const stateful = options.headers?.[SESSION_TYPE_HEADER] === 'stateful';
    const headers = this.cookies.applyToHeaders(options.headers as Record<string, unknown> | undefined);
    const response = await this.inner.request({ ...options, headers: headers as HttpClientOptions['headers'] });
    this.cookies.observeResponse(response.headers, stateful);
    return response;
  }
}
