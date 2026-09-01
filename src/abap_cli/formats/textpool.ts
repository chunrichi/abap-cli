/**
 * abap-file-format .properties textpool files.
 * Wire format matches the ADT text-elements API line format:
 *   - `@MaxLength:<n>` directive applies to the following symbol entries
 *   - `@DDICReference:<name>` directive applies to the following selection entry
 *   - `ID=text` entries; blank lines separate entries (except headings)
 */
import { CliError } from '../output/json.js';

export type TextElementCategory = 'symbols' | 'selections' | 'headings';

export interface TextElement {
  id: string;
  text: string;
  maxLength?: number;
  ddicReference?: string;
}

const VALID_HEADINGS = new Set(['LISTHEADER', 'COLUMNHEADER_1', 'COLUMNHEADER_2', 'COLUMNHEADER_3', 'COLUMNHEADER_4']);

/** Map the .properties file category (texts/selections/headings) to ADT category. */
export function toAdtCategory(category: TextElementCategory | 'texts'): TextElementCategory {
  return category === 'texts' ? 'symbols' : category;
}

/** Category as used by callers: ADT name or the .properties file name (texts). */
export type TextpoolCategoryArg = TextElementCategory | 'texts';

/**
 * Parse a .properties text (Java properties style) into text elements for the
 * given category. Directives (@MaxLength / @DDICReference) attach to the next
 * entry; comment lines (# / !) and blank lines are ignored.
 */
export function parseTextpoolProperties(category: TextpoolCategoryArg, content: string): TextElement[] {
  const adt = toAdtCategory(category);
  const elements: TextElement[] = [];
  let currentMaxLength: number | undefined;
  let currentDdicReference: string | undefined;
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('@MaxLength:')) {
      const n = parseInt(line.slice('@MaxLength:'.length), 10);
      currentMaxLength = Number.isNaN(n) ? undefined : n;
      continue;
    }
    if (line.startsWith('@DDICReference:')) {
      currentDdicReference = line.slice('@DDICReference:'.length);
      continue;
    }
    if (line === '' || line.startsWith('#') || line.startsWith('!')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const id = line.slice(0, eq).trim();
    const text = line.slice(eq + 1);
    if (!id) continue;
    elements.push({
      id,
      text,
      ...(adt === 'symbols' && currentMaxLength !== undefined ? { maxLength: currentMaxLength } : {}),
      ...(adt === 'selections' && currentDdicReference ? { ddicReference: currentDdicReference } : {}),
    });
    // Directives apply to the immediately following entry only.
    currentMaxLength = undefined;
    currentDdicReference = undefined;
  }
  return elements;
}

/** Validate text elements against the category constraints. */
export function validateTextElements(elements: TextElement[], category: TextpoolCategoryArg): void {
  const adt = toAdtCategory(category);
  for (const el of elements) {
    const id = el.id.toUpperCase();
    if (adt === 'symbols') {
      if (id.length !== 3) throw new CliError('VALIDATION_ERROR', `Symbol key "${el.id}" must be exactly 3 characters`);
      if (/\s/.test(id)) throw new CliError('VALIDATION_ERROR', `Symbol key "${el.id}" must not contain blanks`);
      if (el.maxLength !== undefined && el.text.length > el.maxLength) {
        throw new CliError('VALIDATION_ERROR', `Symbol "${el.id}" text exceeds maxLength ${el.maxLength}`);
      }
    } else if (adt === 'headings') {
      if (!VALID_HEADINGS.has(id)) {
        throw new CliError('VALIDATION_ERROR', `Invalid heading key "${el.id}". Allowed: ${[...VALID_HEADINGS].join(', ')}`);
      }
      const limit = id === 'LISTHEADER' ? 71 : 255;
      if (el.text.length > limit) throw new CliError('VALIDATION_ERROR', `Heading "${el.id}" text exceeds maximum length of ${limit}`);
    } else {
      // selections
      if (el.text.length > 30) throw new CliError('VALIDATION_ERROR', `Selection "${el.id}" text exceeds maximum length of 30`);
    }
  }
}

/**
 * Serialize text elements back to .properties text. Validates first.
 * Blank lines separate entries (except headings), matching abap-file-format.
 */
export function serializeTextpoolProperties(category: TextpoolCategoryArg, elements: TextElement[]): string {
  const adt = toAdtCategory(category);
  validateTextElements(elements, adt);
  const lines: string[] = [];
  for (const el of elements) {
    if (adt === 'symbols' && el.maxLength !== undefined && el.maxLength > 0) {
      lines.push(`@MaxLength:${el.maxLength}`);
    }
    if (adt === 'selections' && el.ddicReference) {
      lines.push(`@DDICReference:${el.ddicReference}`);
    }
    lines.push(`${el.id.toUpperCase()}=${el.text}`);
    if (adt !== 'headings') lines.push('');
  }
  return lines.join('\n');
}

/** Map a .properties file category back to the ADT text-elements category name. */
export function textpoolCategoryFromExtension(ext: string): TextElementCategory {
  switch (ext) {
    case 'texts':
      return 'symbols';
    case 'selections':
      return 'selections';
    case 'headings':
      return 'headings';
    default:
      throw new CliError('INVALID_ARGUMENT', `Unknown textpool category extension: ${ext}`);
  }
}
