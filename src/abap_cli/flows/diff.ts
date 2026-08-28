import * as fs from 'fs/promises';
import * as path from 'path';
import type { AdtClientWrapper } from '../clients/adt-client.js';
import { CliError } from '../output/json.js';
import { resolveFile } from '../formats/file-resolver.js';
import { readAbapFile } from '../formats/abap-source.js';
import { resolveObject, getObjectParts } from '../core/resolve.js';
import { computeChangedParts, type ChangedPart, type ChangeDirection } from './status.js';

/** Bounded line-change summary for one part (no full unified diff, FR-015). */
export interface DiffSummary {
  added: number;
  removed: number;
  /** Capped list of local line numbers that differ. */
  changedLines: number[];
}

export interface DiffPart {
  object: string;
  part: string;
  direction: ChangeDirection;
  summary?: DiffSummary;
}

export interface DiffResult {
  parts: DiffPart[];
  truncated: boolean;
  checked: number;
}

export interface DiffOptions {
  /** Single local file to compare (FR-015); when omitted, whole workspace. */
  file?: string;
  all?: boolean;
  remote?: boolean;
  localOnly?: boolean;
  limit?: number;
  cwd?: string;
}

const MAX_CHANGED_LINES = 20;

/**
 * Lightweight line-compare (no new dependency). Counts added/removed lines and
 * collects the first MAX_CHANGED_LINES local line numbers that differ.
 */
export function lineDiffSummary(local: string, remote: string): DiffSummary {
  const localLines = local.split('\n');
  const remoteLines = remote.split('\n');
  const localSet = new Map<string, number>();
  const remoteSet = new Map<string, number>();
  for (const [i, line] of localLines.entries()) localSet.set(line, (localSet.get(line) ?? 0) + 1);
  for (const [i, line] of remoteLines.entries()) remoteSet.set(line, (remoteSet.get(line) ?? 0) + 1);

  let added = 0;
  let removed = 0;
  const changedLines: number[] = [];
  for (const [i, line] of localLines.entries()) {
    const inRemote = (remoteSet.get(line) ?? 0) > 0;
    if (inRemote) {
      remoteSet.set(line, (remoteSet.get(line) ?? 0) - 1);
    } else {
      added++;
      if (changedLines.length < MAX_CHANGED_LINES) changedLines.push(i + 1);
    }
  }
  for (const count of remoteSet.values()) removed += count;

  return { added, removed, changedLines };
}

/**
 * Compare one local file against SAP (FR-015) — resolve the file's object, fetch
 * the matching part source, and report direction + line summary. A file whose
 * object does not exist on SAP is reported as local-only (not an error).
 */
async function diffSingleFile(client: AdtClientWrapper, file: string): Promise<DiffPart[]> {
  const resolved = resolveFile(file);
  let object;
  try {
    object = await resolveObject(client, resolved.objectName, resolved.objectType);
  } catch (error: unknown) {
    if (error instanceof CliError && (error.code === 'OBJECT_NOT_FOUND' || error.code === 'AMBIGUOUS_OBJECT')) {
      const local = await readAbapFile(file);
      const lines = local.split('\n').length - 1;
      return [
        {
          object: resolved.objectName,
          part: resolved.subtype,
          direction: 'local-only',
          summary: { added: lines, removed: 0, changedLines: [] },
        },
      ];
    }
    throw error;
  }
  const partsList = await getObjectParts(client, object);
  const part = partsList.find((p) => p.subtype === resolved.subtype) ?? partsList.find((p) => p.subtype === 'main');
  if (!part) {
    throw new CliError('OBJECT_NOT_FOUND', `No source part '${resolved.subtype}' for ${resolved.objectName}`);
  }
  const remoteContent = await client.getObjectSource(part.sourceUrl);
  const localContent = await readAbapFile(file);
  if (remoteContent === localContent) {
    return [{ object: object.name, part: resolved.subtype, direction: 'unchanged' }];
  }
  return [
    {
      object: object.name,
      part: resolved.subtype,
      direction: 'divergent',
      summary: lineDiffSummary(localContent, remoteContent),
    },
  ];
}

/**
 * Compare local files against SAP (FR-015..017). With a `file`, only that file is
 * compared; otherwise the whole workspace is covered (via computeChangedParts).
 * `--remote`/`--local-only` scope the result; `--limit` bounds it. Read-only.
 */
export async function computeDiff(client: AdtClientWrapper, opts: DiffOptions = {}): Promise<DiffResult> {
  const cwd = opts.cwd ?? process.cwd();
  const limit = opts.limit ?? 20;

  if (opts.file) {
    const absFile = path.isAbsolute(opts.file) ? opts.file : path.join(cwd, opts.file);
    const parts = await diffSingleFile(client, absFile);
    return { parts, truncated: false, checked: 1 };
  }

  const status = await computeChangedParts(client, {
    remoteOnly: opts.remote,
    localOnly: opts.localOnly,
    limit,
    all: opts.all,
    cwd,
  });

  // Attach a line-diff summary to each part (local-only = all added; remote-only
  // = all removed; divergent = computed). Unchanged parts get no summary.
  const parts: DiffPart[] = [];
  for (const cp of status.changedParts) {
    if (cp.direction === 'divergent') {
      const summary = await divergentSummary(client, cp, cwd);
      parts.push({ object: cp.object, part: cp.part, direction: cp.direction, summary });
    } else if (cp.direction === 'local-only') {
      // detail carries a cwd-relative POSIX path (P0); resolve for fs reads.
      const localPath = cp.detail ? cp.detail.replace(/^local file: /, '') : `${cwd}/src/${cp.object.toLowerCase()}.abap`;
      const local = await readAbapFile(path.resolve(cwd, localPath));
      const lines = local.split('\n').length - 1;
      parts.push({ object: cp.object, part: cp.part, direction: cp.direction, summary: { added: lines, removed: 0, changedLines: [] } });
    } else {
      parts.push({ object: cp.object, part: cp.part, direction: cp.direction });
    }
  }

  return { parts, truncated: status.truncated, checked: status.checked };
}

/** Compute the line summary for a divergent part (fetch remote + read local). */
async function divergentSummary(client: AdtClientWrapper, cp: ChangedPart, cwd: string): Promise<DiffSummary> {
  const localFile = cp.detail?.startsWith('local file: ') ? cp.detail.slice('local file: '.length) : null;
  if (!localFile) {
    throw new CliError('OBJECT_NOT_FOUND', `Cannot locate local file for ${cp.object}`);
  }
  // detail carries a cwd-relative POSIX path (P0); resolve for fs reads.
  const absLocal = path.resolve(cwd, localFile);
  const resolved = resolveFile(absLocal);
  const object = await resolveObject(client, resolved.objectName, resolved.objectType);
  const partsList = await getObjectParts(client, object);
  const part = partsList.find((p) => p.subtype === cp.part) ?? partsList.find((p) => p.subtype === 'main');
  const remote = part ? await client.getObjectSource(part.sourceUrl) : '';
  const local = await readAbapFile(absLocal);
  return lineDiffSummary(local, remote);
}
