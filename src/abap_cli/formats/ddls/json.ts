/**
 * Spec 036 US4: DDLS (CDS view) local ↔ wire mapping.
 *
 * Local shape (AFF nested):
 *   { formatVersion, header, sourceOrigin, sourceType, parentName? }
 *
 * Companion file `<name>.ddls.acds` carries the raw DDL source string
 * (the wire body's `ddl:ddlSourceString` element). The acds parser in
 * `acds.ts` recognises 5 top-level forms (viewEntity / projectionView /
 * tableFunction / viewEntityExtend / viewExtend).
 *
 * Wire body: SAP ADT `ddl:ddlSource` XML — wraps the source string with
 * header metadata + transport hints. localToWire rebuilds the envelope;
 * wireToLocal pulls just the source string out (the rest of the metadata
 * round-trips via the JSON shape).
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { CliError } from '../../output/json.js';
import { validateAff } from '../../aff/schema-validator.js';
import { detectSourceTypeFromDdl } from './acds.js';

export interface DdlsLocal {
  formatVersion: '1';
  header: { description: string; originalLanguage: string; abapLanguageVersion?: string };
  sourceOrigin?: string;
  sourceType: 'viewEntity' | 'viewEntityExtend' | 'projectionView' | 'tableFunction' | 'viewExtend' | 'ddicBasedView' | 'tableEntity' | 'abstractEntity' | 'customEntity' | 'hierarchy' | 'externalEntity' | 'unknown';
  parentName?: string;
  /** Path to the companion `.ddls.acds` file (caller-supplied; not serialised). */
  acds?: string;
}

export async function readDdlsJson(filePath: string): Promise<DdlsLocal> {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw) as DdlsLocal;
}

export async function writeDdlsJson(filePath: string, doc: DdlsLocal): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(doc, null, 2) + '\n', 'utf8');
}

/** Pull the DDL source out of the wire body and return both pieces. */
export function wireToLocal(xml: string): { doc: DdlsLocal; source: string } {
  const tag = (re: RegExp): string => {
    const m = xml.match(re);
    return (m?.[1] ?? '').trim();
  };
  const source = tag(/<[^>]*ddlSourceString[^>]*>([\s\S]*?)<\/[^>]+>/i);
  const description = tag(/<[^>]*description[^>]*>([^<]+)<\/[^>]+>/i);
  const originalLanguage = (tag(/<[^>]*originalLanguage[^>]*>([^<]+)<\/[^>]+>/i) || 'EN').toUpperCase();
  const abapLangMatch = xml.match(/<[^>]*abapLanguageVersion[^>]*>([^<]+)<\/[^>]+>/i);
  const abapLanguageVersion = abapLangMatch?.[1]?.trim();
  const sourceOrigin = tag(/<[^>]*sourceOrigin[^>]*>([^<]+)<\/[^>]+>/i) || 'abapDevelopmentTools';
  const sourceType = detectSourceTypeFromDdl(source || xml);
  const parentName = tag(/<[^>]*parentName[^>]*>([^<]+)<\/[^>]+>/i) || undefined;
  return {
    doc: {
      formatVersion: '1',
      header: { description, originalLanguage, ...(abapLanguageVersion ? { abapLanguageVersion } : {}) },
      sourceOrigin,
      sourceType,
      ...(parentName ? { parentName } : {}),
    },
    source,
  };
}

export function localToWire(local: DdlsLocal, source: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<ddl:ddlSource xmlns:ddl="http://www.sap.com/adt/ddic/ddl/sources">',
    `  <ddl:description>${local.header.description ?? ''}</ddl:description>`,
    `  <ddl:originalLanguage>${local.header.originalLanguage}</ddl:originalLanguage>`,
    ...(local.header.abapLanguageVersion ? [`  <ddl:abapLanguageVersion>${local.header.abapLanguageVersion}</ddl:abapLanguageVersion>`] : []),
    `  <ddl:sourceOrigin>${local.sourceOrigin ?? 'abapDevelopmentTools'}</ddl:sourceOrigin>`,
    `  <ddl:sourceType>${local.sourceType}</ddl:sourceType>`,
    ...(local.parentName ? [`  <ddl:parentName>${local.parentName}</ddl:parentName>`] : []),
    '  <ddl:ddlSourceString><![CDATA[',
    source,
    '  ]]></ddl:ddlSourceString>',
    '</ddl:ddlSource>',
  ].join('\n');
}

export async function validateDdlsObject(doc: unknown): Promise<string[]> {
  const result = await validateAff('DDLS', doc);
  if (result.status === 'pass' || result.status === 'warn') return [];
  return result.errors.map((e) => `${e.instancePath || '/'}: ${e.message ?? ''}`);
}

export async function loadAndValidate(filePath: string): Promise<DdlsLocal> {
  const doc = await readDdlsJson(filePath);
  const errors = await validateDdlsObject(doc);
  if (errors.length > 0) {
    throw new CliError('AFF_FIXTURE_INVALID', `DDLS file ${filePath} failed schema validation: ${errors.join('; ')}`, {
      file: filePath,
      details: errors,
    });
  }
  return doc;
}