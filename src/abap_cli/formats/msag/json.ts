/**
 * MSAG (message class) local ↔ wire mapping.
 *
 * Local shape matches the upstream `msag-v1.json` AFF schema (already
 * mirrored under `src/abap_cli/schema/msag-v1.json`):
 *   { formatVersion, header, messages: [{number, text}] }
 *
 * Wire body is the ADT EMF `mc:messageClass` document that
 * `/sap/bc/adt/messageclass/<name>` returns and accepts (shape verified
 * against a live S/4HANA system): the header lives in `adtcore` attributes and
 * every message is one `<mc:messages>` element — the element name is plural in
 * the ADT model, and it carries the text as attributes:
 *
 *   <mc:messageClass xmlns:mc="http://www.sap.com/adt/MessageClass"
 *                    xmlns:adtcore="http://www.sap.com/adt/core"
 *                    adtcore:name="ZMY_MSAG" adtcore:type="MSAG/N"
 *                    adtcore:description="My message class"
 *                    adtcore:language="EN">
 *     <mc:messages mc:msgno="001" mc:msgtext="Object &amp;1 created"/>
 *   </mc:messageClass>
 *
 * The local file name carries the object name, so `localToWire` takes it as an
 * argument; that makes the pair a plain function pair instead of a symmetric
 * `WireArtifact`. The artifact itself keeps the shared JSON/schema plumbing.
 */
import { defineJsonArtifact } from '../artifact.js';

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

/** Inverse of `decodeXmlEntities` — `&` must be escaped first. Attribute-safe. */
function encodeXmlEntities(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Read one `adtcore:`-prefixed attribute from the `mc:messageClass` root. */
function coreAttribute(xml: string, name: string): string | undefined {
  return new RegExp(`\\badtcore:${name}\\s*=\\s*"([^"]*)"`).exec(xml)?.[1];
}

/** Read one attribute from a `<mc:messages …>` tag (namespace prefix optional). */
function messageAttribute(attrs: string, name: string): string | undefined {
  return new RegExp(`\\b(?:\\w+:)?${name}\\s*=\\s*"([^"]*)"`, 'i').exec(attrs)?.[1];
}

export function wireToLocal(xml: string): MsagLocal {
  const description = decodeXmlEntities(coreAttribute(xml, 'description') ?? '');
  // The object's original language is the ADT master language; the plain
  // `language` attribute is the fallback for objects whose TADIR master
  // language is not visible over ADT (e.g. objects written by the ICF fallback).
  const originalLanguage = (
    coreAttribute(xml, 'masterLanguage') ??
    coreAttribute(xml, 'language') ??
    'EN'
  ).toUpperCase();
  const messages: MsagMessageLocal[] = [];
  // Each message is one `<mc:messages …>` element; it may be self-closing or
  // carry `<atom:link>` children (long text / navigation links).
  for (const match of xml.matchAll(/<(?:\w+:)?messages\b([^>]*?)(?:\/>|>)/g)) {
    const attrs = match[1] ?? '';
    const number = messageAttribute(attrs, 'msgno');
    if (!number) continue;
    messages.push({
      number: number.padStart(3, '0').slice(-3),
      text: decodeXmlEntities(messageAttribute(attrs, 'msgtext') ?? ''),
    });
  }
  return {
    formatVersion: '1',
    header: { description, originalLanguage },
    messages,
  };
}

export function localToWire(local: MsagLocal, name: string): string {
  const messages = (local.messages ?? []).map(
    (msg) => `  <mc:messages mc:msgno="${encodeXmlEntities(msg.number)}" mc:msgtext="${encodeXmlEntities(msg.text)}"/>`,
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<mc:messageClass xmlns:mc="http://www.sap.com/adt/MessageClass"',
    '                 xmlns:adtcore="http://www.sap.com/adt/core"',
    `                 adtcore:name="${encodeXmlEntities(name.toUpperCase())}" adtcore:type="MSAG/N"`,
    `                 adtcore:description="${encodeXmlEntities(local.header.description)}"`,
    `                 adtcore:language="${encodeXmlEntities(local.header.originalLanguage.toUpperCase())}">`,
    ...messages,
    '</mc:messageClass>',
  ].join('\n');
}

/** MSAG AFF artifact: file/schema plumbing (wire mapping is `wireToLocal` /
 *  `localToWire` above — the write side needs the object name). */
export const msagArtifact = defineJsonArtifact<MsagLocal>({ type: 'MSAG' });
