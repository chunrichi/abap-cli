/**
 * `--package <pkg>` selector — search + per-object pull.
 *
 * Enumerates every object in a package via ADT search with `packageName`
 * filter, then routes each through the standard pull pipeline.
 */
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { resolveObject } from '../../core/resolve.js';
import { SEARCH_RESULT_LIMIT } from '../../core/limits.js';
import { normalizePullData } from '../../core/path-output.js';
import type { PullEntry, PullOptions, PullResult } from './pull-shared.js';
import { parsePositiveInt } from './pull-shared.js';
import { pullObject } from './pull-source.js';

export async function runPackagePull(client: AdtClientWrapper, opts: PullOptions): Promise<PullResult> {
  const limit = parsePositiveInt(opts.limit, '--limit', SEARCH_RESULT_LIMIT);
  const page = parsePositiveInt(opts.page, '--page', 1);
  const pkg = opts.package!.trim().toUpperCase();

  const results = await client.searchObject('', opts.type, limit * page);
  const matches = results.filter((r) => (r['adtcore:packageName'] ?? '').toUpperCase() === pkg);
  const start = (page - 1) * limit;
  const window = matches.slice(start, start + limit);
  const truncated = matches.length >= limit * page;

  const entries: PullEntry[] = [];
  const written: string[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];
  for (const hit of window) {
    const object = { name: hit['adtcore:name'], type: hit['adtcore:type'], objectUrl: hit['adtcore:uri'] };
    try {
      const result = await pullObject(client, object, opts);
      entries.push(...result.entries);
      written.push(...result.written);
      skipped.push(...result.skipped);
    } catch (error: unknown) {
      const err = error instanceof Error ? error : String(error);
      entries.push({
        object: object.name,
        type: object.type,
        status: 'failed',
        code: (error as { code?: string }).code,
        detail: err instanceof Error ? err.message : String(err),
      });
      failed.push(object.name);
    }
  }

  return {
    data: normalizePullData({
      package: pkg,
      entries,
      written,
      skipped,
      failed,
      page,
      limit,
      truncated,
      ...(truncated ? { hint: `Result truncated. Use --page ${page + 1} to fetch more.` } : {}),
    }),
    human: `Pulled ${written.length} object(s) from ${pkg}${truncated ? ' (truncated)' : ''}.`,
  };
}