/**
 * `extensions lock` subcommand body (027 US2 / FR-007 / FR-008).
 *
 * Recomputes `extensions.lock.json` from `.abap.json`'s `extensions[]` array,
 * records sha512 of every npm-source entry, and writes the lockfile atomically.
 *
 * First-run guard (FR-007): refuses to create a fresh lockfile unless the
 * caller passes `--allow-unsigned`, so a hostile `.abap.json` cannot quietly
 * gain an un-pinned extension on the first run.
 *
 * The `extensions lock` subcommand is registered in `commands/extensions.ts`
 * with lazy import; this module exports only the action body.
 */

import { join as pathJoin } from 'node:path';
import { findWorkspaceConfig } from '../config/project-config.js';
import {
  extensionsLockPath,
  readLockfile,
  writeLockfile,
  regenerateLock,
  lockNextSteps,
  declaredNpmPackages,
} from '../extensions/lockfile.js';
import { printResult, CliError, type OutputMode } from '../output/json.js';

export async function runExtensionsLock(
  mode: OutputMode,
  flags: { allowUnsigned: boolean },
): Promise<void> {
  const configPath = findWorkspaceConfig();
  if (!configPath) {
    throw new CliError(
      'CONFIG_ERROR',
      'No .abap.json found in this directory or any ancestor.',
      {
        details: { searchFrom: process.cwd() },
        nextSteps: ['Run `abap init` to create one, or `cd` into a workspace.'],
      },
    );
  }
  const configDir = pathJoin(configPath, '..');
  const lockfilePath = extensionsLockPath(configDir);
  const lockfileExists = await readLockfile(configDir).then((l) => l !== null);

  // First-run guard (FR-007).
  if (!lockfileExists && !flags.allowUnsigned) {
    throw new CliError(
      'CONFIG_ERROR',
      'extensions.lock.json does not exist yet. Re-run with --allow-unsigned to bootstrap it.',
      {
        details: { lockfilePath, allowUnsignedRequired: true },
        nextSteps: lockNextSteps('LOCKFILE_MISSING_ENTRY'),
      },
    );
  }

  // Re-read .abap.json so we always have the latest declared extensions.
  const { loadConfig } = await import('../config/project-config.js');
  const cfg = await loadConfig();
  const declared = declaredNpmPackages(cfg.extensions);
  if (declared.length === 0) {
    // Nothing to record — write an empty lockfile (still useful as a marker).
    await writeLockfile(configDir, {
      schemaVersion: 1,
      lastResolved: new Date().toISOString(),
      entries: [],
    });
    printResult(
      mode,
      { lockfile: lockfilePath, added: [], updated: [], removed: [], unresolved: [] },
      `Lockfile written (no npm extensions declared): ${lockfilePath}`,
    );
    return;
  }

  const result = await regenerateLock(configDir, cfg.extensions);
  await writeLockfile(configDir, result.lock);

  const data = {
    lockfile: lockfilePath,
    lastResolved: result.lock.lastResolved,
    added: result.added,
    updated: result.updated,
    removed: result.removed,
    unresolved: result.unresolved,
  };

  const human = [
    `Lockfile written: ${lockfilePath}`,
    `  added:   ${result.added.join(', ') || '(none)'}`,
    `  updated: ${result.updated.join(', ') || '(none)'}`,
    `  removed: ${result.removed.join(', ') || '(none)'}`,
    result.unresolved.length > 0 ? `  unresolved (skipped): ${result.unresolved.join(', ')}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  printResult(mode, data, human);
}