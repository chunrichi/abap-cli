import * as fs from 'fs/promises';
import type { AdtClientWrapper } from '../clients/adt-client.js';
import { CliError } from '../output/json.js';
import { resolveFile } from '../formats/file-resolver.js';
import { readAbapFile } from '../formats/abap-source.js';
import { resolveLocalTargets } from '../core/local-targets.js';
import { resolveObject, getObjectParts } from '../core/resolve.js';
import { SEARCH_RESULT_LIMIT } from '../core/limits.js';
import { toRelativeOutputPath } from '../core/path-output.js';

export type ChangeDirection = 'local-only' | 'remote-only' | 'divergent' | 'unchanged';

export interface ChangedPart {
  object: string;
  part: string;
  direction: ChangeDirection;
  detail?: string;
}

export interface StatusResult {
  changedParts: ChangedPart[];
  truncated: boolean;
  checked: number;
}

export interface StatusOptions {
  remoteOnly?: boolean;
  localOnly?: boolean;
  limit?: number;
  since?: string;
  all?: boolean;
  cwd?: string;
}

/**
 * Compare the local file set against SAP and produce a standardized
 * changedParts list.
 */
export async function computeChangedParts(client: AdtClientWrapper, opts: StatusOptions = {}): Promise<StatusResult> {
  const cwd = opts.cwd ?? process.cwd();
  const targets = await resolveLocalTargets({ all: true }, cwd);
  const parts: ChangedPart[] = [];
  let checked = 0;

  for (const file of targets.files) {
    if (!file.endsWith('.abap')) continue;
    if (opts.since) {
      const stat = await fs.stat(file);
      if (stat.mtimeMs < new Date(opts.since).getTime()) continue;
    }
    // detail carries a cwd-relative POSIX path relative to the flow's own cwd.
    const detail = `local file: ${toRelativeOutputPath(file, cwd)}`;
    const resolved = resolveFile(file);
    try {
      const object = await resolveObject(client, resolved.objectName, resolved.objectType);
      const partsList = await getObjectParts(client, object);
      const part = partsList.find((p) => p.subtype === resolved.subtype) ?? partsList.find((p) => p.subtype === 'main');
      if (!part) continue;
      const remoteContent = await client.getObjectSource(part.sourceUrl);
      const localContent = await readAbapFile(file);
      checked++;
      if (remoteContent === localContent) {
        if (opts.all) {
          parts.push({ object: object.name, part: resolved.subtype, direction: 'unchanged', detail });
        }
      } else {
        parts.push({ object: object.name, part: resolved.subtype, direction: 'divergent', detail });
      }
    } catch (error: unknown) {
      if (error instanceof CliError && (error.code === 'OBJECT_NOT_FOUND' || error.code === 'AMBIGUOUS_OBJECT')) {
        parts.push({ object: resolved.objectName, part: resolved.subtype, direction: 'local-only', detail });
      } else {
        throw error;
      }
    }
  }

  // Remote-only enumeration, bounded by --limit.
  const limit = opts.limit ?? SEARCH_RESULT_LIMIT;
  const remoteAll = await client.searchObject('', undefined, limit);
  const localNames = new Set(targets.files.map((f) => resolveFile(f).objectName));
  for (const r of remoteAll) {
    if (!localNames.has(r['adtcore:name'])) {
      parts.push({ object: r['adtcore:name'], part: 'object', direction: 'remote-only' });
    }
  }

  let filtered = parts;
  if (opts.remoteOnly) filtered = filtered.filter((p) => p.direction === 'remote-only');
  if (opts.localOnly) filtered = filtered.filter((p) => p.direction === 'local-only');
  // The default limit always bounds the result; truncation is signalled when
  // the remote enumeration or the combined list is capped.
  const truncated = remoteAll.length >= limit || filtered.length > limit;
  filtered = filtered.slice(0, limit);

  return { changedParts: filtered, truncated, checked };
}
