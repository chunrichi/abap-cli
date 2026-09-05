/**
 * FUNCTION / ENDFUNCTION pseudo-syntax parser.
 *
 * ABAP function modules (FUNC) come from SAP in two flavours:
 *   1. SAP-native: a `FUNCTION <name>.` header followed by `*"~` comment
 *      lines that describe each interface section. The body itself is plain
 *      ABAP between the header and the trailing `ENDFUNCTION.`.
 *   2. AFF canonical (abap-file-format func/README): explicit
 *      `IMPORTING <name> TYPE <type>.` declarations, one per section.
 *
 * This module accepts either form, parses to a structured
 * {@link FuncPseudoSyntax}, and can re-emit it as the canonical AFF form
 * (so pull → push round-trips stay stable). Created in T1.4 (Phase 1) to
 * unblock T1.5 FUGR pull (which writes `.func.json` metadata describing
 * IMPORTING / EXPORTING / CHANGING / TABLES / RAISING components).
 */
import { CliError } from '../output/json.js';

export type FuncInterfaceSectionName =
  | 'IMPORTING'
  | 'EXPORTING'
  | 'CHANGING'
  | 'TABLES'
  | 'RAISING';

export interface FuncInterfaceSection {
  name: FuncInterfaceSectionName;
  declarations: string[];
}

export interface FuncComponent {
  name: string;
  description: string;
}

export interface FuncPseudoSyntax {
  name: string;
  sections: FuncInterfaceSection[];
  body: string;
}

const SECTION_NAMES = new Set<FuncInterfaceSectionName>([
  'IMPORTING',
  'EXPORTING',
  'CHANGING',
  'TABLES',
  'RAISING',
]);

/**
 * Parse an ABAP function-module source (either SAP-native `*"~` comment form
 * or AFF canonical `IMPORTING ... TYPE ...` form) into structured sections.
 *
 * Throws {@link CliError} `FILE_PARSE_ERROR` when the source is missing the
 * `FUNCTION <name>` header or the closing `ENDFUNCTION.` footer.
 */
export function parseFuncPseudoSyntax(content: string): FuncPseudoSyntax {
  const lines = content
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  const startIndex = lines.findIndex((line) => /^\s*FUNCTION\s+/i.test(line));
  if (startIndex < 0) {
    throw new CliError(
      'FILE_PARSE_ERROR',
      'FUNC source must start with a FUNCTION statement',
    );
  }

  const header = /^\s*FUNCTION\s+([A-Za-z_/][A-Za-z0-9_/]*)\s*(?:\.)?\s*$/i.exec(
    lines[startIndex]!,
  );
  if (!header) {
    throw new CliError(
      'FILE_PARSE_ERROR',
      `Invalid FUNC header: ${lines[startIndex]!.trim()}`,
    );
  }
  const endIndex = lines.findIndex(
    (line, index) =>
      index > startIndex &&
      /^\s*ENDFUNCTION\s*\.\s*(?:".*)?$/i.test(line),
  );
  if (endIndex < 0) {
    throw new CliError(
      'FILE_PARSE_ERROR',
      `FUNC ${header[1]} is missing ENDFUNCTION.`,
    );
  }

  const inner = lines.slice(startIndex + 1, endIndex);
  const actual = parseActualInterface(inner);
  const commented =
    actual.sections.length === 0 ? parseCommentedInterface(inner) : undefined;
  const sections =
    actual.sections.length > 0
      ? actual.sections
      : (commented?.sections ?? []);
  const bodyStart =
    actual.sections.length > 0
      ? actual.bodyStart
      : (commented?.bodyStart ?? 0);

  return {
    name: header[1]!,
    sections,
    body: trimEmptyLines(inner.slice(bodyStart)),
  };
}

/**
 * Render a canonical AFF FUNC file. Used as the on-disk shape for
 * `.func.abap` so round-trips do not depend on the SAP-native comment form.
 */
export function renderFuncPseudoSyntax(syntax: FuncPseudoSyntax): string {
  const sections = syntax.sections.filter(
    (section) => section.name && section.declarations.length > 0,
  );
  const lines: string[] = [`FUNCTION ${syntax.name}`];
  if (sections.length === 0) {
    lines[0] = `${lines[0]}.`;
  } else {
    for (const section of sections) {
      lines.push(`  ${section.name}`);
      for (const declaration of section.declarations) {
        lines.push(`    ${declaration.trim()}`);
      }
    }
    const lastDeclaration = lines.length - 1;
    lines[lastDeclaration] = `${lines[lastDeclaration]!.replace(/\s*\.$/, '')}.`;
  }
  if (syntax.body) lines.push('', ...syntax.body.split('\n'));
  lines.push('ENDFUNCTION.');
  return `${lines.join('\n')}\n`;
}

/**
 * Convert raw FUNC source to canonical pseudo syntax while retaining opaque
 * bodies. When parsing fails AND a `fallbackName` is provided, the raw content
 * is returned verbatim (after BOM/CRLF normalisation + trailing newline);
 * callers can use this to round-trip unparseable sources without losing
 * their bodies. When parsing fails AND no `fallbackName` is given, the
 * original `CliError` is re-thrown.
 */
export function toCanonicalFuncSource(content: string, fallbackName?: string): string {
  try {
    return renderFuncPseudoSyntax(parseFuncPseudoSyntax(content));
  } catch (error: unknown) {
    if (!fallbackName) throw error;
    return content
      .replace(/^﻿/, '')
      .replace(/\r\n?/g, '\n')
      .replace(/\n?$/, '\n');
  }
}

/**
 * Extract schema-compatible parameter or exception components for the given
 * interface section. The schema (`fugr/func-v1.json`) accepts an array of
 * `{ name, description }` records for each section.
 */
export function componentsFromFuncSections(
  sections: FuncInterfaceSection[],
  sectionName: FuncInterfaceSectionName,
): FuncComponent[] {
  const section = sections.find((item) => item.name === sectionName);
  if (!section) return [];
  return section.declarations.flatMap((declaration) => {
    const clean = declaration.replace(/\s+".*$/, '').trim();
    const match =
      sectionName === 'RAISING'
        ? /^([A-Za-z_/][A-Za-z0-9_/]*)/.exec(clean)
        : /^(?:VALUE\s*\(\s*)?([A-Za-z_/][A-Za-z0-9_/]*)/i.exec(clean);
    if (
      !match ||
      SECTION_NAMES.has(match[1]!.toUpperCase() as FuncInterfaceSectionName)
    ) {
      return [];
    }
    return [
      { name: match[1]!, description: descriptionFromDeclaration(declaration) },
    ];
  });
}

function parseActualInterface(
  lines: string[],
): { sections: FuncInterfaceSection[]; bodyStart: number } {
  const sections: FuncInterfaceSection[] = [];
  let current: FuncInterfaceSection | undefined;
  let sawSection = false;
  for (let index = 0; index < lines.length; index++) {
    const text = lines[index]!.trim();
    const section = sectionName(text);
    if (section) {
      current = { name: section, declarations: [] };
      sections.push(current);
      sawSection = true;
      continue;
    }
    if (!sawSection) {
      if (text === '' || isCommentLine(lines[index]!)) continue;
      return { sections: [], bodyStart: index };
    }
    if (text === '' || isCommentLine(lines[index]!)) continue;
    if (text === '.') return { sections, bodyStart: index + 1 };
    current!.declarations.push(removeTerminalPeriod(text));
    if (endsWithPeriod(text)) return { sections, bodyStart: index + 1 };
  }
  return { sections: [], bodyStart: 0 };
}

function parseCommentedInterface(
  lines: string[],
): { sections: FuncInterfaceSection[]; bodyStart: number } | undefined {
  const firstSection = lines.findIndex(
    (line) => sectionName(commentText(line) ?? '') !== undefined,
  );
  if (firstSection < 0) return undefined;

  let bodyStart = firstSection;
  while (
    bodyStart > 0 &&
    (lines[bodyStart - 1]!.trim() === '' || isCommentLine(lines[bodyStart - 1]!))
  )
    bodyStart--;
  let end = firstSection;
  while (
    end < lines.length &&
    (lines[end]!.trim() === '' || isCommentLine(lines[end]!))
  )
    end++;

  const sections: FuncInterfaceSection[] = [];
  let current: FuncInterfaceSection | undefined;
  for (const line of lines.slice(bodyStart, end)) {
    const text = commentText(line)?.trim();
    if (!text || /^[-*]+$/.test(text) || /Local Interface:/i.test(text)) continue;
    const section = sectionName(text);
    if (section) {
      current = { name: section, declarations: [] };
      sections.push(current);
      continue;
    }
    if (current && !endsWithPeriod(text)) current.declarations.push(text);
    else if (current && text !== '.')
      current.declarations.push(removeTerminalPeriod(text));
  }
  return { sections, bodyStart: end };
}

function sectionName(text: string): FuncInterfaceSectionName | undefined {
  const value = text.replace(/\s+".*$/, '').trim().toUpperCase();
  return SECTION_NAMES.has(value as FuncInterfaceSectionName)
    ? (value as FuncInterfaceSectionName)
    : undefined;
}

function commentText(line: string): string | undefined {
  const match = /^\s*\*"?\s?(.*)$/.exec(line);
  return match?.[1];
}

function isCommentLine(line: string): boolean {
  return commentText(line) !== undefined;
}

function endsWithPeriod(text: string): boolean {
  return /\.\s*(?:".*)?$/.test(text);
}

function removeTerminalPeriod(text: string): string {
  return text.replace(/\.\s*(?:".*)?$/, '').trim();
}

function descriptionFromDeclaration(declaration: string): string {
  const quote = declaration.indexOf('"');
  if (quote < 0) return '';
  const raw = declaration.slice(quote + 1).trim();
  // Strip the closing quote (and optional trailing whitespace).
  return raw.endsWith('"') ? raw.slice(0, -1).trim() : raw;
}

function trimEmptyLines(lines: string[]): string {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]!.trim() === '') start++;
  while (end > start && lines[end - 1]!.trim() === '') end--;
  return lines.slice(start, end).join('\n');
}
