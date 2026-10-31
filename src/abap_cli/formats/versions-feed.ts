/**
 * ADT versions Atom-feed parser.
 *
 * The upstream `abap-adt-api` `revisions()` helper reads the version from the
 * transport-request atom link only. Class / interface include feeds carry the
 * version in `atom:id` and usually have no transport link, so that helper
 * returns an empty `version` there — unusable for `--show <version>`.
 * Parsing the feed here keeps `version` stable and also surfaces the optional
 * transport request for object-level feeds.
 *
 * Feed shape (verified against S/4HANA, class include `main`):
 *
 *   <atom:feed ...>
 *     <atom:entry>
 *       <atom:author><atom:name>DEV</atom:name></atom:author>
 *       <atom:content type="text/plain" src=".../versions/<id>/<version>/content"/>
 *       <atom:id>00000</atom:id>
 *       <atom:updated>2026-10-31T19:20:44Z</atom:updated>
 *     </atom:entry>
 *   </atom:feed>
 */

export interface VersionFeedEntry {
  /** ADT version id (`atom:id`, e.g. "00000" / "000004"). */
  version: string;
  /** Entry `atom:updated` timestamp (ISO 8601 as returned by SAP). */
  date: string;
  author: string;
  /** Entry `atom:title` when present (often empty for class includes). */
  title: string;
  /** Content URI accepted by `getObjectSource` to read this version. */
  uri: string;
  /** Transport request carrying this version, when SAP exposes the link. */
  transport?: string;
}

const ENTRY_PATTERN = /<atom:entry\b[^>]*>([\s\S]*?)<\/atom:entry>/g;
const TRANSPORT_LINK_PATTERN = /<atom:link\b[^>]*type="application\/vnd\.sap\.adt\.transportrequests\.v1\+xml"[^>]*>/;
const CONTENT_SRC_PATTERN = /<atom:content\b[^>]*\bsrc="([^"]*)"/;

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function textTag(entry: string, name: string): string {
  const match = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`).exec(entry);
  return match?.[1] !== undefined ? decodeXmlEntities(match[1].trim()) : '';
}

function xmlAttr(fragment: string, name: string): string {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(fragment);
  return match?.[1] !== undefined ? decodeXmlEntities(match[1]) : '';
}

/** Fallback: derive the version id from the content URI's `.../<version>/content`. */
function versionFromUri(uri: string): string {
  const match = /\/([^/]+)\/content\/?$/.exec(uri);
  return match?.[1] ?? '';
}

/** Parse an ADT versions Atom feed into stable `VersionFeedEntry` records. */
export function parseVersionsFeed(xml: string): VersionFeedEntry[] {
  const entries: VersionFeedEntry[] = [];
  ENTRY_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ENTRY_PATTERN.exec(xml)) !== null) {
    const entry = match[1] ?? '';
    const contentTag = CONTENT_SRC_PATTERN.exec(entry)?.[0] ?? '';
    const uri = xmlAttr(contentTag, 'src');
    const version = textTag(entry, 'atom:id') || versionFromUri(uri);
    const authorBlock = /<atom:author\b[^>]*>([\s\S]*?)<\/atom:author>/.exec(entry)?.[1] ?? '';
    const transportTag = entry.match(TRANSPORT_LINK_PATTERN)?.[0] ?? '';
    const transport = transportTag ? xmlAttr(transportTag, 'adtcore:name') : '';
    entries.push({
      version,
      date: textTag(entry, 'atom:updated'),
      author: authorBlock ? textTag(authorBlock, 'atom:name') : '',
      title: textTag(entry, 'atom:title'),
      uri,
      ...(transport ? { transport } : {}),
    });
  }
  return entries;
}
