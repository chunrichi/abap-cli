import type { AdtClientWrapper } from '../clients/adt-client.js';
import { CliError } from '../output/json.js';
import { getObjectPartsWithMeta } from '../sync/resolve.js';
import { buildFilename } from './file-resolver.js';
import { renderObjectMetadataJson } from './object-metadata.js';
import { fugrStrategy } from './pull-fugr.js';

/** A file to write for an object; content is lazy to avoid fetching unused parts. */
export interface OutputFile {
  filename: string;
  content: () => Promise<string>;
}

export interface PullContext {
  client: AdtClientWrapper;
  object: { name: string; type: string; objectUrl: string };
  opts: { includeTests?: boolean; includeAllParts?: boolean };
}

/**
 * Per-object pull strategy: turns one SAP object into the local files that
 * abap-file-format expects for its type.
 *
 * To add a new object type (e.g. FUGR):
 *   1. Implement a strategy returning OutputFile[] — filenames follow
 *      abap-file-format, content is fetched lazily so unused parts are skipped.
 *   2. Register it in strategyFor() below (FUGR needs a multi-file layout:
 *      sapl<name>.reps.*, l<name>top.reps.*, one .func.* per function module).
 *   3. The shared write/conflict handling in pullObject() applies unchanged.
 */
export interface PullStrategy {
  /** Generate the files (metadata + source parts) for one object. */
  files(ctx: PullContext): Promise<OutputFile[]>;
}

/**
 * CLAS/PROG/INTF share the objectStructure + source-parts layout:
 * one <name>.<type>.json metadata file plus one .abap per include part.
 */
function sourceObjectStrategy(): PullStrategy {
  return {
    async files({ client, object, opts }) {
      const { parts: allParts, metadata } = await getObjectPartsWithMeta(client, object);
      const parts = opts.includeAllParts
        ? allParts
        : allParts.filter((p) => (opts.includeTests ? true : p.subtype !== 'testclasses'));
      return [
        {
          filename: buildFilename(object.name, object.type, undefined, '.json'),
          content: async () => renderObjectMetadataJson(metadata),
        },
        ...parts.map((p) => ({
          filename: buildFilename(object.name, object.type, p.subtype, '.abap'),
          content: async () => client.getObjectSource(p.sourceUrl),
        })),
      ];
    },
  };
}

const SOURCE_OBJECT_TYPES = new Set(['CLAS', 'PROG', 'INTF']);

/**
 * Pick the pull strategy for an object type.
 * Types sharing the objectStructure + source-parts layout stay in
 * sourceObjectStrategy(); add divergent layouts (e.g. FUGR) here.
 */
export function strategyFor(type: string): PullStrategy {
  const primary = type.split('/')[0]!.toUpperCase();
  if (SOURCE_OBJECT_TYPES.has(primary)) return sourceObjectStrategy();
  if (primary === 'FUGR') return fugrStrategy();
  throw new CliError('TYPE_NOT_SUPPORTED', `Pull not supported for object type ${primary}`, { type: primary });
}
