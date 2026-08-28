/**
 * Action body for `extensions list` (T012 / 027 US4).
 * Reads the singleton registry snapshot and renders the extension list with
 * per-entry lockfile status for npm sources.
 */

import type { ExtensionContext } from './types.js';
import { getExtensionRegistry } from './registry.js';
import { printResult, type OutputMode } from '../output/json.js';
import type { LockfileStatus } from './lockfile.js';

export interface ListExtensionEntry {
  name: string;
  type: 'command' | 'validation' | 'lifecycle';
  source: { sourceType: 'npm'; packageName: string; path?: string } | { sourceType: 'path'; path: string };
  status: 'loaded' | 'failed';
  error?: string;
  /** 027 US4 — present only on npm-source entries */
  lockfile?: { status: LockfileStatus };
}

export async function listExtensionsAction(
  _ctx: ExtensionContext,
  opts: Record<string, unknown>,
): Promise<void> {
  const mode: OutputMode = opts._prettyJson
    ? 'pretty-json'
    : (opts._json as boolean | undefined)
    ? 'json'
    : 'human';
  const registry = getExtensionRegistry();
  const snap = registry.loaded;
  const failed = registry.failed;

  const entries: ListExtensionEntry[] = [
    ...snap.map((r) => decorateWithLockfile(r, registry)),
    ...failed.map((r) => decorateWithLockfile(r, registry)),
  ];

  const topLock: { status: LockfileStatus; lastResolved?: string } | undefined =
    registry.lockfileStatus() === 'present'
      ? undefined
      : { status: registry.lockfileStatus() };

  const human = entries.length === 0
    ? 'No extensions registered.'
    : entries
        .map((e) => {
          const src = e.source.sourceType === 'npm' ? e.source.packageName : e.source.path;
          const lock = e.lockfile ? ` [lock:${e.lockfile.status}]` : '';
          return `  ${e.status === 'loaded' ? '✓' : '✗'} ${e.name} (${e.type}) — ${src}${lock}${e.error ? ` [${e.error}]` : ''}`;
        })
        .join('\n');

  printResult(mode, { extensions: entries, lockfile: topLock }, human);
}

function decorateWithLockfile(
  r: { name: string; type: 'command' | 'validation' | 'lifecycle'; source: { sourceType: 'npm'; packageName: string; path?: string } | { sourceType: 'path'; path: string }; status: 'loaded' | 'failed'; error?: string },
  registry: ReturnType<typeof getExtensionRegistry>,
): ListExtensionEntry {
  const base: ListExtensionEntry = {
    name: r.name,
    type: r.type,
    source: r.source,
    status: r.status,
    error: r.error,
  };
  if (r.source.sourceType === 'npm') {
    const status = registry.entryLockfileStatus(r.source.packageName);
    if (status) base.lockfile = { status };
  }
  return base;
}
