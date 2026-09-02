import { CliError } from '../output/json.js';
import { enumerateFugr, readFuncIncludeNumbers } from './fugr-layout.js';
import type { OutputFile, PullContext, PullStrategy } from './pull-strategy.js';

/**
 * FUGR pull strategy (abap-file-format fugr/README.md).
 * Layout per function group <name>:
 *   <name>.fugr.json                    — group metadata (header + fixPointArithmetic)
 *   <name>.fugr.sapl<name>.reps.abap    — function-pool main program (= FUGR source/main)
 *   <name>.fugr.sapl<name>.reps.json    — reps metadata (includeType: functionGroup)
 *   <name>.fugr.l<name>top.reps.abap    — TOP include source
 *   <name>.fugr.l<name>top.reps.json    — reps metadata (includeType: include)
 *   <name>.fugr.<fm>.func.abap          — one file per function module
 *   <name>.fugr.<fm>.func.json          — func metadata (processingType required)
 * The generated UXX include is intentionally skipped (the spec does not require it).
 */

/** Render <name>.fugr.json — header + fixPointArithmetic (spec $required). */
function renderFugrMetadata(meta: { description?: string; masterLanguage?: string; fixPointArithmetic?: boolean; abapLanguageVersion?: string }): string {
  const doc: Record<string, unknown> = {
    formatVersion: '1',
    header: {
      description: meta.description ?? '',
      originalLanguage: (meta.masterLanguage ?? 'EN').toLowerCase(),
    },
  };
  if (meta.abapLanguageVersion) {
    (doc.header as Record<string, unknown>).abapLanguageVersion = meta.abapLanguageVersion;
  }
  if (meta.fixPointArithmetic !== undefined) doc.fixPointArithmetic = meta.fixPointArithmetic;
  return JSON.stringify(doc, null, 2) + '\n';
}

/** Render <name>...reps.json — includeType is $required. */
function renderRepsMetadata(description: string, includeType: 'functionGroup' | 'include', abapLanguageVersion?: string): string {
  const header: Record<string, unknown> = { description };
  if (abapLanguageVersion) header.abapLanguageVersion = abapLanguageVersion;
  return JSON.stringify(
    { formatVersion: '1', header, includeType },
    null,
    2,
  ) + '\n';
}

/** Render <name>...func.json — processingType + includeNumber are $required. */
function renderFuncMetadata(description: string, processingType: string | undefined, includeNumber: string, abapLanguageVersion?: string): string {
  const header: Record<string, unknown> = { description };
  if (abapLanguageVersion) header.abapLanguageVersion = abapLanguageVersion;
  return JSON.stringify(
    { formatVersion: '1', header, processingType: processingType ?? 'normal', includeNumber },
    null,
    2,
  ) + '\n';
}

export function fugrStrategy(): PullStrategy {
  return {
    async files({ client, object }: PullContext): Promise<OutputFile[]> {
      const layout = await enumerateFugr(client, object.objectUrl);
      const { groupLow } = layout;
      const files: OutputFile[] = [];

      const struc = await client.objectStructure(object.objectUrl);
      const meta = struc.metaData as unknown as Record<string, unknown>;
      const abapLanguageVersion = meta['abapsource:abapLanguageVersion'] as string | undefined;
      // mock and partial fixtures may omit abapsource:fixPointArithmetic; spec US4
      // pins the default to `false` so on-prem consumers always see a boolean.
      const fixPointArithmetic = (meta['abapsource:fixPointArithmetic'] as boolean | undefined) ?? false;

      // <name>.fugr.json
      files.push({
        filename: `${groupLow}.fugr.json`,
        content: async () => renderFugrMetadata({
          description: meta['adtcore:description'] as string,
          masterLanguage: meta['adtcore:masterLanguage'] as string,
          fixPointArithmetic,
          abapLanguageVersion,
        }),
      });

      // sapl<name>.reps.abap + .json (function-pool main program)
      files.push({
        filename: `${groupLow}.fugr.sapl${groupLow}.reps.abap`,
        content: async () => client.getObjectSource(layout.saplUrl),
      });
      files.push({
        filename: `${groupLow}.fugr.sapl${groupLow}.reps.json`,
        content: async () => renderRepsMetadata(meta['adtcore:description'] as string, 'functionGroup', abapLanguageVersion),
      });

      // l<name>top.reps.abap + .json (TOP include)
      const top = layout.includes.find((i) => i.name === `L${layout.group}TOP`);
      if (top) {
        files.push({
          filename: `${groupLow}.fugr.l${groupLow}top.reps.abap`,
          content: async () => client.getObjectSource(top.sourceUrl),
        });
        files.push({
          filename: `${groupLow}.fugr.l${groupLow}top.reps.json`,
          content: async () => renderRepsMetadata(top.description, 'include', abapLanguageVersion),
        });
      }

      // One .func.abap + .func.json per function module. includeNumber comes
      // from the group's UXX include (required by func-v1.json); fall back to
      // the module's position in the group when UXX is missing/unparsable.
      const includeNumbers = await readFuncIncludeNumbers(client, layout.group, layout.includes);
      let funcIndex = 0;
      for (const fm of layout.funcs) {
        const fmLow = fm.name.toLowerCase();
        funcIndex += 1;
        const includeNumber = includeNumbers.get(fm.name) ?? String(funcIndex).padStart(2, '0');
        files.push({
          filename: `${groupLow}.fugr.${fmLow}.func.abap`,
          content: async () => client.getObjectSource(fm.sourceUrl),
        });
        files.push({
          filename: `${groupLow}.fugr.${fmLow}.func.json`,
          content: async () => renderFuncMetadata(fm.description, fm.processingType, includeNumber, abapLanguageVersion),
        });
      }

      if (files.length === 0) {
        throw new CliError('SAP_ERROR', `No source parts found for function group ${object.name}`, { object: object.name });
      }
      return files;
    },
  };
}
