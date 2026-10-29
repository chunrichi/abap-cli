import * as fs from 'fs/promises';
import * as path from 'path';
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { CliError } from '../../output/json.js';
import { SEARCH_RESULT_LIMIT } from '../../core/limits.js';
import { resolveFile } from '../../formats/file-resolver.js';
import { readAbapFile, normalizeLineEndings } from '../../formats/abap-source.js';
import { resolveObject, getObjectParts } from '../../core/resolve.js';
import { computeChangedParts, type ChangedPart, type ChangeDirection } from './status.js';

/** Bounded line-change summary for one part (no full unified diff). */
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
  /** Single local file to compare; when omitted, whole workspace. */
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
  // Normalize both sides first so `\r` never pollutes the line tokens.
  const localLines = normalizeLineEndings(local).split('\n');
  const remoteLines = normalizeLineEndings(remote).split('\n');
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
 * Compare one local file against SAP — resolve the file's object, fetch
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
  // Compare normalized so CRLF/LF differences alone never report divergence.
  if (normalizeLineEndings(remoteContent) === normalizeLineEndings(localContent)) {
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
 * Compare local files against SAP. With a `file`, only that file is compared;
 * otherwise the whole workspace is covered (via computeChangedParts).
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

/** CLI-level options for `abap diff` (the pure engine takes `DiffOptions`). */
export interface DiffRunOptions {
  all?: boolean;
  remote?: boolean;
  localOnly?: boolean;
  limit?: string;
}

/** Flow outcome: JSON envelope data + human summary, printed by the command layer. */
export interface DiffEnvelope {
  data: DiffResult;
  human: string;
}

/**
 * True when the positional argument is clearly an ABAP object name rather than
 * a local file path — i.e. it carries neither a path separator nor a `.` file
 * extension. F-18: `abap diff ZCL_ZR_T5` used to fall through to the filename
 * parser and fail with `FILE_PARSE_ERROR "Cannot resolve object type from
 * filename: ZCL_ZR_T5"`, which reads like a filename bug instead of "you
 * passed an object name". Genuine bad filenames (with a separator or an
 * extension) still reach that FILE_PARSE_ERROR path unchanged.
 */
function looksLikeObjectName(arg: string): boolean {
  return !arg.includes('/') && !arg.includes('\\') && !arg.includes('.');
}

export async function runDiff(file: string | undefined, opts: DiffRunOptions = {}): Promise<DiffEnvelope> {
  if (file && (opts.all || opts.remote || opts.localOnly)) {
    throw new CliError('INVALID_ARGUMENT', 'A file argument cannot be combined with --all/--remote/--local-only.', {
      nextSteps: ['Either diff a single file or scope the workspace; not both.'],
      example: 'abap diff src/zcl_demo.clas.abap --json',
    });
  }
  // Precedence: the scoping-conflict check above runs first (both problems are
  // argument-shape bugs); then an object-name argument is rejected here before
  // any client/SAP call, so the misleading FILE_PARSE_ERROR from the filename
  // resolver is never reached for bare names.
  if (file && looksLikeObjectName(file)) {
    const name = file.toUpperCase();
    throw new CliError(
      'INVALID_ARGUMENT',
      `'${file}' looks like an ABAP object name, not a file path. abap diff compares a local file against SAP and does not resolve object names.`,
      {
        nextSteps: [
          `Pull the object first: abap pull ${name} --type <T> (e.g. --type CLAS)`,
          `Then diff the pulled file: abap diff src/${file.toLowerCase()}.clas.abap`,
        ],
        example: `abap pull ${name} --type CLAS && abap diff src/${file.toLowerCase()}.clas.abap`,
      },
    );
  }
  const client = await AdtClientWrapper.create();
  const limit = opts.limit ? Number(opts.limit) : SEARCH_RESULT_LIMIT;
  const result = await computeDiff(client, {
    file,
    all: opts.all,
    remote: opts.remote,
    localOnly: opts.localOnly,
    limit,
  });
  const human = [
    ...(result.parts.length === 0
      ? ['No differences.']
      : result.parts.map((p) => {
          const sum = p.summary ? ` (+${p.summary.added}/-${p.summary.removed})` : '';
          return `  ${p.object} (${p.part}): ${p.direction}${sum}`;
        })),
    ...(result.truncated ? ['Result truncated — use --limit <n> or narrow with --remote/--local-only.'] : []),
  ].join('\n');
  return { data: result, human };
}
