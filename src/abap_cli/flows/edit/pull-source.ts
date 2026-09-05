/**
 * Pull CLAS / INTF / PROG / FUGR (and any other ADT REST-routable object)
 * via the per-type `PullStrategy`.
 *
 * Pulls one object's selected parts into local files; the coordinator
 * (pull.ts) invokes this for both single-object and package-pull flows.
 *
 * T2.6: file writes funnel through {@link writePullFile}, which:
 *   - pre-validates `.json` metadata against the matching AFF schema
 *     (so callers cannot write a fixture that violates abap-file-format);
 *   - pre-validates `.tabl.ddic` DDL via `parseTablDdic` (rejects malformed
 *     source before disk);
 *   - centralises OVERWRITE_REQUIRED / AFF_FIXTURE_INVALID / FILE_PARSE_ERROR
 *     handling so the per-type strategies do not need to repeat it.
 */
import * as path from 'path';
import * as fs from 'fs/promises';
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { objectDirName } from '../../formats/file-resolver.js';
import { folderFor } from '../../formats/type-folder.js';
import { fileExists, writeAbapFile } from '../../formats/abap-source.js';
import { strategyFor, type OutputFile } from '../../formats/pull-strategy.js';
import { CliError } from '../../output/json.js';
import { toOutputPath } from '../../core/path-output.js';
import { assertAffMetadata } from '../../aff/assert-metadata.js';
import type { PullEntry, PullResult } from './pull-shared.js';

/**
 * Options consumed by {@link writePullFile}.
 *
 * `overwrite` / `skipExisting` mirror the CLI flags; when both are false
 * and the local file differs from the new content, writePullFile throws
 * `OVERWRITE_REQUIRED`.
 */
export interface WritePullFileOptions {
  filePath: string;
  content: string;
  overwrite?: boolean;
  skipExisting?: boolean;
  /** Object the file belongs to (used for entries / error context). */
  object?: { name: string; type: string };
}

export interface WritePullFileResult {
  /** Relative output path (POSIX). */
  outPath: string;
  /** What happened to the file on disk. */
  status: 'written' | 'skipped';
  /** Populated when status='skipped' so callers can distinguish reasons. */
  detail?: string;
}

/**
 * T2.6: generic pull-file writer.
 *
 * Handles three concerns:
 *  1. Pre-write validation:
 *     - `.json` files are parsed and validated against the AFF schema
 *       inferred from the filename (e.g. `zmy.prog.json` → PROG).
 *       `assertAffMetadata` throws `CliError('AFF_FIXTURE_INVALID')`
 *       on schema violation — the write is rejected before any disk I/O.
 *     - `.tabl.ddic` files are reverse-validated via `parseTablDdic`
 *       (rejects malformed DDL with `FILE_PARSE_ERROR`).
 *  2. Conflict resolution: identical content ⇒ skipped; differing content
 *     ⇒ respected `overwrite` / `skipExisting` flags (or thrown
 *     `OVERWRITE_REQUIRED` when neither is set).
 *  3. Disk write: parents created, content written UTF-8.
 */
export async function writePullFile(opts: WritePullFileOptions): Promise<WritePullFileResult> {
  const absPath = path.resolve(process.cwd(), opts.filePath);
  const outPath = toOutputPath(opts.filePath);

  // (1a) Pre-write AFF schema validation for metadata files.
  await preValidateMetadata(absPath, opts.content, outPath);

  // (2) Conflict resolution.
  if (await fileExists(absPath)) {
    const existing = await fs.readFile(absPath, 'utf-8');
    if (existing === opts.content) {
      return { outPath, status: 'skipped', detail: 'already matches' };
    }
    if (opts.skipExisting) {
      return { outPath, status: 'skipped', detail: 'local file differs; --skip-existing' };
    }
    if (!opts.overwrite) {
      throw new CliError(
        'OVERWRITE_REQUIRED',
        `Local file ${outPath} differs from SAP; refusing to overwrite.`,
        {
          details: { file: outPath, object: opts.object?.name },
          nextSteps: [
            'Re-run with --overwrite to replace the local file.',
            'Or re-run with --skip-existing to keep the local file unchanged.',
          ],
          example: opts.object ? `abap pull ${opts.object.name} --overwrite` : undefined,
        },
      );
    }
  }

  // (3) Disk write.
  await writeAbapFile(absPath, opts.content);
  return { outPath, status: 'written' };
}

/**
 * Validate `content` against the AFF schema implied by the filename,
 * rejecting the write on schema mismatch. TABL/STRU `.tabl.ddic` files
 * get a DDL parse round-trip instead.
 */
async function preValidateMetadata(absPath: string, content: string, outPath: string): Promise<void> {
  const fileName = path.basename(absPath);
  if (fileName.endsWith('.tabl.ddic')) {
    // Reverse-validate the DDL before writing. The parser is sync, so we
    // import lazily to keep the cold path cheap.
    try {
      const { parseTablDdic } = await import('../../formats/ddic/tabl-artifact.js');
      parseTablDdic(content);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new CliError(
        'FILE_PARSE_ERROR',
        `Malformed TABL/STRU DDL (${outPath}): ${msg}`,
        { file: outPath, nextSteps: ['Inspect the pulled DDL; abap-cli cannot round-trip malformed source.'] },
      );
    }
    return;
  }
  if (!fileName.endsWith('.json')) return;
  const type = affTypeFromFilename(fileName);
  if (!type) return; // unknown shape — let downstream readers handle it.
  let doc: unknown;
  try {
    doc = JSON.parse(content);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new CliError(
      'FILE_PARSE_ERROR',
      `Invalid JSON in ${outPath}: ${msg}`,
      { file: outPath },
    );
  }
  await assertAffMetadata(type, doc, { context: outPath });
}

/**
 * Map an abap-cli pull filename to its AFF schema type code.
 * Returns `undefined` for filenames that are not metadata (e.g. `.http.json`
 * is HTTP — handled separately by `pull-http.ts` so writePullFile does not
 * validate it here; the same goes for other types that already validate
 * inline at the strategy layer).
 *
 * The function is intentionally narrow: it only matches the unambiguous
 * single-token extensions used by the `sourceObjectStrategy()` family and
 * the FUGR strategy (`.fugr.json`, `.reps.json`, `.func.json`). New types
 * added in Phase 3 should register their mapping here.
 */
function affTypeFromFilename(fileName: string): string | undefined {
  // FUGR: name.fugr.json / name.<include>.reps.json / name.<fm>.func.json
  if (/\.fugr\.json$/.test(fileName)) return 'FUGR';
  if (/\.reps\.json$/.test(fileName)) return 'REPS';
  if (/\.func\.json$/.test(fileName)) return 'FUNC';
  // Source-object layout: name.<type>.json (CLAS / INTF / PROG / DDLS / …).
  const m = fileName.match(/\.([a-z]+)\.json$/);
  if (!m) return undefined;
  const t = m[1]!.toUpperCase();
  // Only validate the canonical AFF types whose schemas the project vendors.
  // T3.x — Phase 3 added SRVD / BDEF / DCLS / DDLX / DDLA alongside DDLS
  // (SRVB is metadata-only, validated inline at the strategy layer).
  const KNOWN = new Set([
    'CLAS', 'INTF', 'PROG', 'DDLS', 'TABL', 'STRU', 'DOMA', 'DTEL', 'TTYP', 'MSAG',
    'SRVD', 'BDEF', 'DCLS', 'DDLX', 'DDLA',
  ]);
  return KNOWN.has(t) ? t : undefined;
}

export async function pullObject(
  client: AdtClientWrapper,
  object: { name: string; type: string; objectUrl: string },
  opts: { dir: string; overwrite?: boolean; skipExisting?: boolean; includeTests?: boolean; includeAllParts?: boolean },
): Promise<{ entries: PullEntry[]; written: string[]; skipped: string[]; failed: string[] }> {
  const files = await strategyFor(object.type).files({ client, object, opts });

  const entries: PullEntry[] = [];
  const written: string[] = [];
  const skipped: string[] = [];

  // abap-file-format layout: one directory per object under <typeFolder>/<opts.dir>.
  const objectDir = objectDirName(object.name);
  const typeFolder = folderFor(object.type);

  for (const file of files) {
    const result = await writeFile(file, objectDir, typeFolder);
    if (result.status === 'written') {
      entries.push({ object: object.name, type: object.type, status: 'written', files: [result.outPath] });
      written.push(result.outPath);
    } else {
      entries.push({
        object: object.name,
        type: object.type,
        status: 'skipped',
        detail: result.detail,
      });
      skipped.push(result.outPath);
    }
  }
  return { entries, written, skipped, failed: [] };

  /** Compose the file's target path and delegate to the generic writer. */
  async function writeFile(file: OutputFile, dir: string, folder: string): Promise<WritePullFileResult> {
    const filePath = path.join(opts.dir, folder, dir, file.filename);
    const content = await file.content();
    return writePullFile({
      filePath,
      content,
      overwrite: opts.overwrite,
      skipExisting: opts.skipExisting,
      object,
    });
  }
}

export function humanSummary(
  object: { name: string; type: string },
  result: { written: string[]; skipped: string[] },
): string {
  const lines = [`Pulled ${object.name} (${object.type}):`];
  for (const f of result.written) lines.push(`  ${f}`);
  if (result.skipped.length > 0) {
    lines.push(`Skipped ${result.skipped.length} file(s):`);
    for (const f of result.skipped) lines.push(`  ${f}`);
  }
  return lines.join('\n');
}