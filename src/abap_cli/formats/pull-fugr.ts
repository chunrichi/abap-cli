import type { AdtClientWrapper } from '../clients/adt-client.js';
import { CliError } from '../output/json.js';
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

interface FugrHit {
  name: string;
  type: string;
  uri: string;
}

/** Search for the function group's sub-objects via the untyped quickSearch. */
async function searchHits(client: AdtClientWrapper, query: string): Promise<FugrHit[]> {
  const results = await client.searchObject(query, '', 200);
  return results.map((r) => ({
    name: r['adtcore:name'],
    type: r['adtcore:type'],
    uri: r['adtcore:uri'],
  }));
}

/** Render <name>.fugr.json — header + fixPointArithmetic (spec $required). */
function renderFugrMetadata(meta: { description?: string; masterLanguage?: string; fixPointArithmetic?: boolean }): string {
  const doc: Record<string, unknown> = {
    formatVersion: '1',
    header: {
      description: meta.description ?? '',
      originalLanguage: (meta.masterLanguage ?? 'EN').toLowerCase(),
    },
  };
  if (meta.fixPointArithmetic !== undefined) doc.fixPointArithmetic = meta.fixPointArithmetic;
  return JSON.stringify(doc, null, 2) + '\n';
}

/** Render <name>...reps.json — includeType is $required. */
function renderRepsMetadata(description: string, includeType: 'functionGroup' | 'include'): string {
  return JSON.stringify(
    { formatVersion: '1', header: { description }, includeType },
    null,
    2,
  ) + '\n';
}

/** Render <name>...func.json — processingType is $required (ADT already returns the enum). */
function renderFuncMetadata(description: string, processingType: string | undefined): string {
  return JSON.stringify(
    { formatVersion: '1', header: { description }, processingType: processingType ?? 'normal' },
    null,
    2,
  ) + '\n';
}

export function fugrStrategy(): PullStrategy {
  return {
    async files({ client, object }: PullContext): Promise<OutputFile[]> {
      const group = object.name.toUpperCase();
      const groupLow = object.name.toLowerCase();

      const struc = await client.objectStructure(object.objectUrl);
      const meta = struc.metaData as unknown as Record<string, unknown>;
      const sourceUri = absolute(meta['abapsource:sourceUri'] as string, object.objectUrl);
      const files: OutputFile[] = [];

      // <name>.fugr.json
      files.push({
        filename: `${groupLow}.fugr.json`,
        content: async () => renderFugrMetadata({
          description: meta['adtcore:description'] as string,
          masterLanguage: meta['adtcore:masterLanguage'] as string,
          fixPointArithmetic: meta['abapsource:fixPointArithmetic'] as boolean,
        }),
      });

      // sapl<name>.reps.abap + .json (function-pool main program)
      files.push({
        filename: `${groupLow}.fugr.sapl${groupLow}.reps.abap`,
        content: async () => client.getObjectSource(sourceUri),
      });
      files.push({
        filename: `${groupLow}.fugr.sapl${groupLow}.reps.json`,
        content: async () => renderRepsMetadata(meta['adtcore:description'] as string, 'functionGroup'),
      });

      // Enumerate sub-objects: FUGR/I includes via L<group>* prefix, FUGR/FF
      // function modules via *<group>* (real ADT returns them in separate queries).
      const includeHits = await searchHits(client, `L${group}*`);
      const includes = includeHits.filter((h) => h.type.startsWith('FUGR/I') && h.name.startsWith(`L${group}`));
      const funcHits = await searchHits(client, `*${group}*`);
      const funcs = funcHits.filter((h) => h.type.startsWith('FUGR/FF') && h.uri.includes(`/functions/groups/${groupLow}/fmodules/`));

      // l<name>top.reps.abap + .json (TOP include)
      const top = includes.find((h) => h.name === `L${group}TOP`);
      if (top) {
        const topStruc = await client.objectStructure(top.uri);
        const topMeta = topStruc.metaData as unknown as Record<string, unknown>;
        const topSrc = absolute(topMeta['abapsource:sourceUri'] as string, top.uri);
        files.push({
          filename: `${groupLow}.fugr.l${groupLow}top.reps.abap`,
          content: async () => client.getObjectSource(topSrc),
        });
        files.push({
          filename: `${groupLow}.fugr.l${groupLow}top.reps.json`,
          content: async () => renderRepsMetadata(topMeta['adtcore:description'] as string, 'include'),
        });
      }

      // One .func.abap + .func.json per function module.
      for (const fm of funcs) {
        const fmLow = fm.name.toLowerCase();
        const fmStruc = await client.objectStructure(fm.uri);
        const fmMeta = fmStruc.metaData as unknown as Record<string, unknown>;
        const fmSrc = absolute(fmMeta['abapsource:sourceUri'] as string, fm.uri);
        files.push({
          filename: `${groupLow}.fugr.${fmLow}.func.abap`,
          content: async () => client.getObjectSource(fmSrc),
        });
        files.push({
          filename: `${groupLow}.fugr.${fmLow}.func.json`,
          content: async () =>
            renderFuncMetadata(fmMeta['adtcore:description'] as string, fmMeta['fmodule:processingType'] as string),
        });
      }

      if (files.length === 0) {
        throw new CliError('SAP_ERROR', `No source parts found for function group ${object.name}`, { object: object.name });
      }
      return files;
    },
  };
}

/** ADT source URIs may be relative to the object URL. */
function absolute(sourceUrl: string | undefined, objectUrl: string): string {
  if (!sourceUrl) throw new Error('Missing source URI');
  if (sourceUrl.startsWith('/')) return sourceUrl;
  return `${objectUrl.replace(/\/$/, '')}/${sourceUrl}`;
}
