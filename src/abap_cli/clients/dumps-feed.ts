/**
 * Wire request + Atom parse for the read-only ADT runtime-dumps feed
 * `GET /sap/bc/adt/runtime/dumps`. The library's own `dumps(h, query)` sends
 * the whole query as `$query=...`, which the server rejects with HTTP 400
 * "Data is invalid and could not be converted"; this module sends OData
 * `$top` / `$filter` as direct URL parameters instead and mirrors the
 * library's Atom parsing so callers keep the `DumpsFeed` shape.
 */
import type { Dump, DumpsFeed } from 'abap-adt-api';
import type { HttpClientResponse, RequestOptions } from 'abap-adt-api/build/AdtHTTP.js';
import { fullParse, parseJsonDate, xmlArray, xmlNodeAttr } from 'abap-adt-api/build/utilities.js';

export const DUMPS_PATH = '/sap/bc/adt/runtime/dumps';
const DUMPS_ACCEPT = 'application/atom+xml;type=feed';

/** Minimal request surface the feed fetch needs from an ADT http client. */
export interface DumpsRequestor {
  request(url: string, config?: RequestOptions): Promise<HttpClientResponse>;
}

/** OData query parameters the runtime-dumps feed accepts. */
export interface DumpsQuery {
  $top?: string;
  $filter?: string;
}

/** Build the OData query; `undefined` when nothing to filter on. */
export function buildDumpsQuery(limit?: number, user?: string): DumpsQuery | undefined {
  const query: DumpsQuery = {};
  if (typeof limit === 'number') query.$top = String(limit);
  if (user) query.$filter = `author eq '${user.replace(/'/g, "''")}'`;
  return query.$top || query.$filter ? query : undefined;
}

/** Fetch the feed with `$top`/`$filter` applied server-side. */
export async function fetchDumpsFeed(
  http: DumpsRequestor,
  limit?: number,
  user?: string,
): Promise<DumpsFeed> {
  const qs = buildDumpsQuery(limit, user);
  const response = await http.request(DUMPS_PATH, {
    method: 'GET',
    headers: { Accept: DUMPS_ACCEPT },
    ...(qs ? { qs } : {}),
  });
  return parseDumpsFeed(response.body);
}

/** Parse the Atom feed body into the `DumpsFeed` shape. */
export function parseDumpsFeed(body: string): DumpsFeed {
  const feed = fullParse(body, { removeNSPrefix: true, processEntities: { enabled: true } })?.feed;
  return {
    href: selfHref(feed?.link),
    title: feed?.title ?? '',
    updated: parseJsonDate(feed?.updated ?? ''),
    dumps: xmlArray(feed, 'entry').map(parseEntry),
  };
}

function selfHref(link: unknown): string {
  const links = Array.isArray(link) ? link : link ? [link] : [];
  for (const item of links) {
    const attrs = xmlNodeAttr(item);
    if (attrs?.rel === 'self') return attrs.href ?? '';
  }
  return '';
}

function parseEntry(entry: any): Dump {
  const summary = entry?.summary;
  return {
    categories: xmlArray(entry, 'category').map(xmlNodeAttr),
    links: xmlArray(entry, 'link').map(xmlNodeAttr),
    id: entry?.id ?? '',
    author: entry?.author?.name?.trim() || undefined,
    text: summary?.['#text'] ?? '',
    type: summary?.['@_type'] ?? 'text',
  };
}
