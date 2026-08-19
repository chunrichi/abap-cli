/**
 * Action body for `extensions list` (T012).
 * Reads the singleton registry snapshot and renders the extension list.
 */

import type { ExtensionContext } from './types.js';
import { getExtensionRegistry } from './registry.js';
import { printResult, type OutputMode } from '../output/json.js';

export interface ListExtensionEntry {
  name: string;
  type: 'command' | 'validation' | 'lifecycle';
  source: { sourceType: 'npm'; packageName: string; path?: string } | { sourceType: 'path'; path: string };
  status: 'loaded' | 'failed';
  error?: string;
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
    ...snap.map((r) => ({ name: r.name, type: r.type, source: r.source, status: 'loaded' as const })),
    ...failed.map((r) => ({ name: r.name, type: r.type, source: r.source, status: 'failed' as const, error: r.error })),
  ];

  const human = entries.length === 0
    ? 'No extensions registered.'
    : entries
        .map((e) => `  ${e.status === 'loaded' ? '✓' : '✗'} ${e.name} (${e.type}) — ${
            e.source.sourceType === 'npm' ? e.source.packageName : e.source.path
          }${e.error ? ` [${e.error}]` : ''}`)
        .join('\n');

  printResult(mode, { extensions: entries }, human);
}
