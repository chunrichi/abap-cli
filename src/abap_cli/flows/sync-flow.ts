import * as path from 'path';
import * as fs from 'fs/promises';
import type { AdtClientWrapper } from '../clients/adt-client.js';
import { CliError } from '../output/json.js';
import { resolveFile, buildFilename, objectDirName } from '../formats/file-resolver.js';
import { writeAbapFile } from '../formats/abap-source.js';
import { resolveObject, getObjectParts } from './resolve.js';
import { computeChangedParts, type ChangedPart } from './status.js';
import { pushObject } from './push-flow.js';

export type SyncDirection = 'pull' | 'push' | 'status';
export type SyncActionStatus = 'planned' | 'done' | 'skipped' | 'conflict' | 'failed';

export interface SyncAction {
  object: string;
  part: string;
  direction: string;
  action: 'pull' | 'push' | 'none';
  status: SyncActionStatus;
  reason?: string;
}

export interface SyncResult {
  direction: SyncDirection;
  dryRun: boolean;
  parts: SyncAction[];
  skipped: string[];
  nextSteps: string[];
}

export interface SyncOptions {
  direction: SyncDirection;
  dryRun?: boolean;
  yes?: boolean;
  cwd?: string;
}

/** A local-only part under push needs a create flow (not pushObject) — skipped with guidance. */
function pushActionFor(part: ChangedPart): { action: 'push' | 'none'; status: SyncActionStatus; reason?: string } {
  if (part.direction === 'divergent') return { action: 'push', status: 'planned' };
  if (part.direction === 'local-only') {
    return {
      action: 'none',
      status: 'skipped',
      reason: 'local-only parts need a create flow — use abap create <type> <object>',
    };
  }
  return { action: 'none', status: 'skipped', reason: `not pushed: ${part.direction}` };
}

/** Pull one divergent/remote-only part into its local file (reuses pull semantics). */
async function executePull(client: AdtClientWrapper, part: ChangedPart, cwd: string): Promise<void> {
  const object = await resolveObject(client, part.object);
  const partsList = await getObjectParts(client, object);
  const sourcePart = partsList.find((p) => p.subtype === part.part) ?? partsList.find((p) => p.subtype === 'main');
  if (!sourcePart) {
    throw new CliError('OBJECT_NOT_FOUND', `No source part '${part.part}' for ${part.object}`);
  }
  const content = await client.getObjectSource(sourcePart.sourceUrl);
  const filename = buildFilename(object.name, object.type, sourcePart.subtype, '.abap');
  await writeAbapFile(path.resolve(cwd, 'src', objectDirName(object.name), filename), content);
}

/**
 * Plan (and optionally execute) a sync direction over the changed-part list
 * (FR-018..021). `--dry-run` returns planned actions with zero mutating calls.
 * `--push` never auto-pushes divergent parts — they are conflicts unless --yes.
 */
export async function planSync(client: AdtClientWrapper, opts: SyncOptions): Promise<SyncResult> {
  const cwd = opts.cwd ?? process.cwd();
  const status = await computeChangedParts(client, { all: true, cwd });

  const parts: SyncAction[] = [];
  const skipped: string[] = [];
  const nextSteps: string[] = [];
  const hasDivergent = status.changedParts.some((p) => p.direction === 'divergent');

  for (const cp of status.changedParts) {
    if (cp.direction === 'unchanged') {
      parts.push({ object: cp.object, part: cp.part, direction: cp.direction, action: 'none', status: 'skipped', reason: 'unchanged' });
      continue;
    }

    if (opts.direction === 'status') {
      parts.push({ object: cp.object, part: cp.part, direction: cp.direction, action: 'none', status: 'planned' });
      continue;
    }

    if (opts.direction === 'pull') {
      if (cp.direction === 'local-only') {
        parts.push({
          object: cp.object,
          part: cp.part,
          direction: cp.direction,
          action: 'pull',
          status: 'skipped',
          reason: 'local-only — nothing to pull from SAP',
        });
        skipped.push(cp.object);
        continue;
      }
      parts.push({ object: cp.object, part: cp.part, direction: cp.direction, action: 'pull', status: 'planned' });
      continue;
    }

    // direction === 'push'
    if (cp.direction === 'divergent' && !opts.yes) {
      parts.push({
        object: cp.object,
        part: cp.part,
        direction: cp.direction,
        action: 'push',
        status: 'conflict',
        reason: 'local and SAP both changed — refusing to overwrite without explicit confirmation',
      });
      continue;
    }
    const push = pushActionFor(cp);
    parts.push({ object: cp.object, part: cp.part, direction: cp.direction, action: push.action, status: push.status, reason: push.reason });
    if (push.status === 'skipped') skipped.push(cp.object);
  }

  if (opts.direction === 'push' && hasDivergent && !opts.yes) {
    nextSteps.push('Re-run with --yes to overwrite divergent changes explicitly.');
  }

  if (opts.direction === 'pull' || opts.direction === 'push') {
    for (const part of parts) {
      if (part.status !== 'planned') continue;
      if (opts.dryRun) continue;
      try {
        if (part.action === 'pull') {
          const cp = status.changedParts.find((p) => p.object === part.object && p.part === part.part)!;
          await executePull(client, cp, cwd);
        } else if (part.action === 'push') {
          const cp = status.changedParts.find((p) => p.object === part.object && p.part === part.part)!;
          const resolved = await resolveObject(client, cp.object);
          const partsList = await getObjectParts(client, resolved);
          const sourcePart = partsList.find((p) => p.subtype === part.part) ?? partsList.find((p) => p.subtype === 'main');
          if (!sourcePart) throw new CliError('OBJECT_NOT_FOUND', `No source part '${part.part}' for ${cp.object}`);
          const content = await fs.readFile(localFileFor(cp, cwd), 'utf-8');
          await pushObject(
            client,
            { name: resolved.name, type: resolved.type, objectUrl: resolved.objectUrl },
            [{ subtype: sourcePart.subtype, sourceUrl: sourcePart.sourceUrl, content }],
            { transport: '', checkOnly: false },
          );
        }
        part.status = 'done';
      } catch (error: unknown) {
        part.status = 'failed';
        part.reason = error instanceof Error ? error.message : String(error);
      }
    }
  }

  // Conflict refusal fails fast (exit 7) — no silent overwrite (FR-021).
  if (opts.direction === 'push' && hasDivergent && !opts.yes) {
    throw new CliError('VALIDATION_ERROR', 'sync --push refused: divergent changes require explicit confirmation.', {
      nextSteps,
      example: 'abap sync --push --yes',
    });
  }

  return { direction: opts.direction, dryRun: !!opts.dryRun, parts, skipped, nextSteps };
}

function localFileFor(cp: ChangedPart, cwd: string): string {
  if (cp.detail?.startsWith('local file: ')) {
    const rel = cp.detail.slice('local file: '.length);
    return path.isAbsolute(rel) ? rel : path.join(cwd, rel);
  }
  return path.join(cwd, 'src', `${cp.object.toLowerCase()}.abap`);
}
