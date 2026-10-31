/**
 * MSAG (message class) local ↔ wire mapping.
 *
 * Local shape matches the upstream `msag-v1.json` AFF schema (already
 * mirrored under `src/abap_cli/schema/msag-v1.json`):
 *   { formatVersion, header, messages: [{number, text}] }
 *
 * Wire body is SAP ADT `mc:messageClass` XML. Wire → local uses regex
 * extraction (msag XML is shallow); local → wire produces a small XML
 * payload accepted by ADT POST. File/schema plumbing comes from the shared
 * AFF artifact contract (`artifact.ts`).
 */
import { defineWireArtifact } from '../artifact.js';

export interface MsagMessageLocal {
  number: string;
  text: string;
}

export interface MsagLocal {
  formatVersion: '1';
  header: { description: string; originalLanguage: string };
  messages: MsagMessageLocal[];
}

/** Decode the five XML pre-defined entities back to their literal characters.
 *  SAP wire bodies only use `&amp; &lt; &gt; &quot; &apos;` — anything else is
 *  left as-is (consumers decode user-defined entities in higher layers). */
function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/** Inverse of `decodeXmlEntities` — `&` must be escaped first. */
function encodeXmlEntities(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function wireToLocal(xml: string): MsagLocal {
  const tag = (re: RegExp): string => {
    const m = xml.match(re);
    return (m?.[1] ?? '').trim();
  };
  const description = decodeXmlEntities(tag(/<[^>]*description[^>]*>([^<]+)<\/[^>]+>/i));
  const originalLanguage = (tag(/<[^>]*originalLanguage[^>]*>([^<]+)<\/[^>]+>/i) || 'EN').toUpperCase();
  // Anchor on the closing </...message> so a nested <mc:text> wrapper does not
  // terminate the match early.
  const messageRe =
    /<(?:\w+:)?message\b[^>]*\snumber="([^"]+)"[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?message>)/gi;
  const messages: MsagMessageLocal[] = [];
  let m: RegExpExecArray | null;
  while ((m = messageRe.exec(xml)) !== null) {
    const body = m[2] ?? '';
    // Unwrap the optional <mc:text>…</mc:text> child; self-closing bodies stay empty.
    const textMatch = body.match(/<(?:\w+:)?text\b[^>]*>([\s\S]*?)<\/(?:\w+:)?text>/i);
    const inner = (textMatch?.[1] ?? body).trim();
    messages.push({ number: m[1]!.padStart(3, '0').slice(-3), text: decodeXmlEntities(inner) });
  }
  return {
    formatVersion: '1',
    header: { description, originalLanguage },
    messages,
  };
}

export function localToWire(local: MsagLocal): string {
  const messages = (local.messages ?? []).map((msg) =>
    `      <mc:message number="${msg.number}"><mc:text>${encodeXmlEntities(msg.text)}</mc:text></mc:message>`,
  ).join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<mc:messageClass xmlns:mc="http://www.sap.com/adt/messageclass">',
    `  <mc:description>${encodeXmlEntities(local.header.description)}</mc:description>`,
    `  <mc:originalLanguage>${local.header.originalLanguage}</mc:originalLanguage>`,
    '  <mc:messages>',
    messages,
    '  </mc:messages>',
    '</mc:messageClass>',
  ].join('\n');
}

/** MSAG AFF artifact: file/schema plumbing + ADT wire mapping. */
export const msagArtifact = defineWireArtifact<MsagLocal, string>({
  type: 'MSAG',
  toWire: (local) => localToWire(local),
  fromWire: (xml) => wireToLocal(xml),
});
