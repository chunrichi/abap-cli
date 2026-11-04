/**
 * Generic AFF pull: fetch the object's official AFF document(s) and write them
 * flat into `--dir` verbatim.
 *
 * The transport depends on the type's channel:
 *
 *   - APLO / CHDO / EVTB / SMBC (`affChannel: 'adt-blue'`): GET the blueSource
 *     metadata (package/description) + `source/main` (the AFF JSON document).
 *   - ENHO / ENHS (`affChannel: 'icf'`): GET `/aff/<TYPE>/<NAME>`; the endpoint
 *     may return more than one file, so every returned file is written.
 *
 * The bundle writer is exported because the create flows pull the fresh object
 * back the same way.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { IcfClient } from '../../clients/icf-client.js';
import { CliError } from '../../output/json.js';
import { normalizePullData, toRelativeOutputPath } from '../../core/path-output.js';
import { fileExists } from '../../formats/abap-source.js';
import {
  affMainFileName,
  safeAffOutputName,
  type AffBundle,
} from '../../formats/aff/bundle.js';
import { pullAdtAffObject } from '../../formats/aff/adt-transport.js';
import {
  affChannelForType,
  fetchAffBundle,
  normalizeAffObjectName,
  requireAdtAffType,
  requireAffBundleType,
} from './aff-shared.js';
import type { PullOptions, PullResult } from './pull-shared.js';
import type { PullHandler } from './routing.js';

/** Options shared by pull and create-then-pull. */
export interface AffBundleWriteOptions {
  /** Output directory (create-then-pull uses the default `src/`). */
  dir: string;
  overwrite?: boolean;
  skipExisting?: boolean;
}

/** One written/skipped file in a bundle write. */
export interface AffBundleWriteEntry {
  /** cwd-relative POSIX path (output boundary). */
  file: string;
  status: 'written' | 'skipped';
}

export interface AffBundleWriteResult {
  entries: AffBundleWriteEntry[];
  written: string[];
  skipped: string[];
  /** Existing files kept by `skipExisting`, with a content-diff flag. */
  skippedExisting: Array<{ file: string; changed: boolean }>;
}

/**
 * Write a bundle flat into `opts.dir` with the standard overwrite contract:
 * existing files require `--overwrite` (unless `--skip-existing` was asked
 * for), and skipped files keep their on-disk content untouched.
 */
export async function writeAffBundle(
  bundle: AffBundle,
  opts: AffBundleWriteOptions,
): Promise<AffBundleWriteResult> {
  const targets = bundle.files.map((file) => {
    const name = safeAffOutputName(file.name);
    const abs = path.resolve(process.cwd(), opts.dir, name);
    return { name, abs, file: toRelativeOutputPath(abs), content: file.content };
  });

  const seen = new Set<string>();
  for (const target of targets) {
    const key = target.name.toLowerCase();
    if (seen.has(key)) {
      throw new CliError('AFF_READ_FAILED', `AFF endpoint returned duplicate file ${target.name}`, {
        file: target.name,
        nextSteps: ['Verify the deployed ICF service version (run `abap doctor`).'],
      });
    }
    seen.add(key);
  }

  const existing = await Promise.all(targets.map((target) => fileExists(target.abs)));
  const anyExisting = existing.some(Boolean);
  if (anyExisting && !opts.overwrite && !opts.skipExisting) {
    const conflicting = targets.filter((_, index) => existing[index]).map((target) => target.file);
    throw new CliError(
      'OVERWRITE_REQUIRED',
      `${conflicting.join(', ')} already exists; use --overwrite to replace`,
      {
        file: conflicting.join(', '),
        nextSteps: ['Re-run with --overwrite to replace the existing files.'],
        example: `abap pull ${bundle.name} --type ${bundle.type} --overwrite`,
      },
    );
  }

  const entries: AffBundleWriteEntry[] = [];
  const written: string[] = [];
  const skipped: string[] = [];
  const skippedExisting: Array<{ file: string; changed: boolean }> = [];

  for (const [index, target] of targets.entries()) {
    if (existing[index] && opts.skipExisting) {
      let changed = true;
      try {
        changed = (await fs.readFile(target.abs, 'utf8')) !== target.content;
      } catch {
        // Unreadable existing file: report it as changed (the caller warns).
      }
      skipped.push(target.file);
      skippedExisting.push({ file: target.file, changed });
      entries.push({ file: target.file, status: 'skipped' });
      continue;
    }
    await fs.mkdir(path.dirname(target.abs), { recursive: true });
    await fs.writeFile(target.abs, target.content, 'utf8');
    written.push(target.file);
    entries.push({ file: target.file, status: 'written' });
  }

  return { entries, written, skipped, skippedExisting };
}

/** `abap pull <NAME> --type <AFF type>`: fetch + verbatim bundle write. */
export async function runPullAff(objectName: string, opts: PullOptions): Promise<PullResult> {
  const type = requireAffBundleType(opts.type);
  const channel = affChannelForType(type);
  const name = normalizeAffObjectName(objectName);

  let bundle: AffBundle;
  if (channel === 'adt-blue') {
    const client = await AdtClientWrapper.create();
    const fresh = await pullAdtAffObject(client, requireAdtAffType(type), name);
    bundle = {
      type,
      name,
      ...(fresh.meta.packageName ? { package: fresh.meta.packageName } : {}),
      files: [{ name: affMainFileName(name, type), content: fresh.source }],
    };
  } else {
    const icf = await IcfClient.create();
    bundle = await fetchAffBundle(icf, type, name, { action: 'pull' });
  }

  const written = await writeAffBundle(bundle, {
    dir: opts.dir,
    overwrite: opts.overwrite,
    skipExisting: opts.skipExisting,
  });

  const data = normalizePullData({
    object: name,
    type,
    channel,
    ...(bundle.package ? { package: bundle.package } : {}),
    ...(bundle.masterLanguage ? { masterLanguage: bundle.masterLanguage } : {}),
    entries: written.entries,
    written: written.written,
    skipped: written.skipped,
    failed: [],
  });

  const filesNote = [...written.written, ...written.skipped].join(', ');
  const human = written.written.length > 0
    ? `Pulled ${type} ${name} via ${channel === 'adt-blue' ? 'ADT' : 'ICF'} to ${written.written.join(', ')}${written.skipped.length > 0 ? ` (kept ${written.skipped.join(', ')})` : ''}`
    : `Skipped ${type} ${name} (files already exist: ${filesNote})`;

  return { data, human };
}

export const pullAffHandler: PullHandler = async ({ objectName, opts }) => runPullAff(objectName, opts);
