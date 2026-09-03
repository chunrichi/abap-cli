import { describe, expect, it, vi } from 'vitest';
import type { HttpClientResponse, RequestOptions } from 'abap-adt-api/build/AdtHTTP.js';
import {
  buildDumpsQuery,
  DUMPS_PATH,
  fetchDumpsFeed,
  parseDumpsFeed,
  type DumpsRequestor,
} from '../../src/abap_cli/clients/dumps-feed.js';

// Structurally faithful to the real SAP response: namespaced atom feed, two
// categories on the runtime-error entry, single category on the second one.
const ATOM_FEED = `<?xml version="1.0" encoding="utf-8"?>
<atom:feed xmlns:atom="http://www.w3.org/2005/Atom">
  <atom:author><atom:name>SAP AG</atom:name></atom:author>
  <atom:contributor><atom:name>A4H</atom:name></atom:contributor>
  <atom:link href="/sap/bc/adt/runtime/dumps?$top=5&amp;from=20260829121934" rel="self" type="application/atom+xml"/>
  <atom:link href="/sap/bc/adt/runtime/dumps?$top=5&amp;to=20260828172703" rel="next" type="application/atom+xml"/>
  <atom:title>ABAP Short Dump Analysis: Selected ABAP Runtime Errors</atom:title>
  <atom:updated>2026-09-02T15:30:53Z</atom:updated>
  <atom:entry xml:lang="EN">
    <atom:author FullName="John Doe"><atom:name>DEVELOPER</atom:name></atom:author>
    <atom:category term="OBJECTS_OBJREF_NOT_ASSIGNED_NO" label="ABAP runtime error"/>
    <atom:category term="CL_ADT_REST_COMP_CNT_HANDLER==CP" label="Terminated ABAP program"/>
    <atom:id>DUMP-ID-1</atom:id>
    <atom:link href="adt://A4H/sap/bc/adt/runtime/dump/1" rel="self" type="text/plain"/>
    <atom:summary type="html">&lt;p&gt;Access using a &apos;Z&apos; reference variable is not possible&lt;/p&gt;</atom:summary>
  </atom:entry>
  <atom:entry xml:lang="EN">
    <atom:category term="CONVT_NO_NUMBER" label="ABAP runtime error"/>
    <atom:id>DUMP-ID-2</atom:id>
    <atom:summary type="text">Cannot convert &quot;abc&quot; to a number</atom:summary>
  </atom:entry>
  <atom:entry xml:lang="EN">
    <atom:id>DUMP-ID-3</atom:id>
  </atom:entry>
</atom:feed>`;

const EMPTY_FEED = `<?xml version="1.0" encoding="utf-8"?>
<atom:feed xmlns:atom="http://www.w3.org/2005/Atom">
  <atom:title>ABAP Short Dump Analysis</atom:title>
  <atom:updated>2026-09-02T15:30:53Z</atom:updated>
</atom:feed>`;

function fakeRequestor(body: string): DumpsRequestor & { calls: { url: string; config?: RequestOptions }[] } {
  const calls: { url: string; config?: RequestOptions }[] = [];
  const request = vi.fn(
    async (url: string, config?: RequestOptions): Promise<HttpClientResponse> => {
      calls.push({ url, config });
      return { body, status: 200, statusText: 'OK', headers: {} };
    },
  );
  return { request, calls };
}

describe('dumps-feed: buildDumpsQuery', () => {
  it('returns undefined when nothing to filter on', () => {
    expect(buildDumpsQuery()).toBeUndefined();
    expect(buildDumpsQuery(undefined, '')).toBeUndefined();
  });

  it('maps the numeric limit to $top', () => {
    expect(buildDumpsQuery(5)).toEqual({ $top: '5' });
  });

  it('maps the user filter to $filter', () => {
    expect(buildDumpsQuery(undefined, 'DEVELOPER')).toEqual({ $filter: "author eq 'DEVELOPER'" });
  });

  it('combines $top and $filter', () => {
    expect(buildDumpsQuery(5, 'DEVELOPER')).toEqual({
      $top: '5',
      $filter: "author eq 'DEVELOPER'",
    });
  });

  it('escapes embedded quotes in the user filter', () => {
    expect(buildDumpsQuery(5, "O'BRIEN")).toEqual({ $top: '5', $filter: "author eq 'O''BRIEN'" });
  });
});

describe('dumps-feed: fetchDumpsFeed', () => {
  it('requests the feed with OData $top/$filter as direct query params', async () => {
    const http = fakeRequestor(ATOM_FEED);
    const feed = await fetchDumpsFeed(http, 5, 'DEVELOPER');

    expect(http.calls).toHaveLength(1);
    const { url, config } = http.calls[0];
    expect(url).toBe(DUMPS_PATH);
    expect(config?.method).toBe('GET');
    expect(config?.headers).toEqual({ Accept: 'application/atom+xml;type=feed' });
    expect(config?.qs).toEqual({ $top: '5', $filter: "author eq 'DEVELOPER'" });
    expect(feed.dumps).toHaveLength(3);
  });

  it('sends no query string when no limit or user is given', async () => {
    const http = fakeRequestor(ATOM_FEED);
    await fetchDumpsFeed(http);
    const { config } = http.calls[0];
    expect(config?.qs).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(config, 'qs')).toBe(false);
  });
});

describe('dumps-feed: parseDumpsFeed', () => {
  it('parses feed metadata and dump entries', () => {
    const feed = parseDumpsFeed(ATOM_FEED);

    expect(feed.title).toContain('ABAP Short Dump Analysis');
    expect(feed.updated.toISOString()).toBe('2026-09-02T15:30:53.000Z');
    expect(feed.href).toBe('/sap/bc/adt/runtime/dumps?$top=5&from=20260829121934');
    expect(feed.dumps).toHaveLength(3);

    const [first, second, third] = feed.dumps;
    expect(first.id).toBe('DUMP-ID-1');
    expect(first.author).toBe('DEVELOPER');
    expect(first.categories).toEqual([
      { term: 'OBJECTS_OBJREF_NOT_ASSIGNED_NO', label: 'ABAP runtime error' },
      { term: 'CL_ADT_REST_COMP_CNT_HANDLER==CP', label: 'Terminated ABAP program' },
    ]);
    expect(first.text).toContain('Access using a');
    expect(first.type).toBe('html');

    expect(second.categories).toEqual([{ term: 'CONVT_NO_NUMBER', label: 'ABAP runtime error' }]);
    expect(second.text).toBe('Cannot convert "abc" to a number');
    expect(second.type).toBe('text');

    // Entry without author/summary still projects.
    expect(third.author).toBeUndefined();
    expect(third.text).toBe('');
  });

  it('returns an empty dump list for a feed without entries', () => {
    const feed = parseDumpsFeed(EMPTY_FEED);
    expect(feed.dumps).toEqual([]);
    expect(feed.updated.toISOString()).toBe('2026-09-02T15:30:53.000Z');
  });
});
