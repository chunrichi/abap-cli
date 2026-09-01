/**
 * `--tr <request>` selector — pull every object bound to a transport request.
 *
 * Iterates direct objects + nested task objects, deduplicates by `type::name`,
 * then routes each through the appropriate per-type pull pipeline:
 *   - HTTP / TRAN / DDIC via ICF
 *   - source objects (CLAS / INTF / PROG / FUGR) via ADT
 */
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { resolveObject } from '../../core/resolve.js';
import { normalizePullData } from '../../core/path-output.js';
import { showTransport } from '../core/transport-ops.js';
import { CliError } from '../../output/json.js';
import type { PullEntry, PullOptions, PullResult } from './pull-shared.js';
import { runPullHttp } from './pull-http.js';
import { runPullTran } from './pull-transport.js';
import { runPullDdic, isDdicSupportedType } from './pull-ddic.js';
import { pullObject } from './pull-source.js';

export async function runTransportPull(client: AdtClientWrapper, requestNumber: string, opts: PullOptions): Promise<PullResult> {
  const transport = await showTransport(client, requestNumber);
  const seen = new Set<string>();
  const ordered: { name: string; type: string }[] = [];

  for (const obj of transport.objects) {
    const key = `${obj.type}::${obj.name}`;
    if (!seen.has(key)) {
      seen.add(key);
      ordered.push({ name: obj.name, type: obj.type });
    }
  }
  for (const task of transport.tasks) {
    for (const obj of task.objects) {
      const key = `${obj.type}::${obj.name}`;
      if (!seen.has(key)) {
        seen.add(key);
        ordered.push({ name: obj.name, type: obj.type });
      }
    }
  }

  const entries: PullEntry[] = [];
  const written: string[] = [];
  const skipped: string[] = [];
  let pulled = 0;
  let failed = 0;

  for (const item of ordered) {
    try {
      if (item.type === 'HTTP') {
        await runPullHttp(item.name, opts);
        entries.push({ object: item.name, type: item.type, status: 'written' });
        written.push(item.name);
        pulled++;
        continue;
      }
      if (item.type === 'TRAN') {
        await runPullTran(item.name, opts);
        entries.push({ object: item.name, type: item.type, status: 'written' });
        written.push(item.name);
        pulled++;
        continue;
      }
      const ddicType = item.type.toUpperCase();
      if (isDdicSupportedType(ddicType)) {
        await runPullDdic(item.name, ddicType, opts);
        entries.push({ object: item.name, type: item.type, status: 'written' });
        written.push(item.name);
        pulled++;
        continue;
      }
      const object = await resolveObject(client, item.name, item.type);
      const result = await pullObject(client, object, opts);
      entries.push({
        object: object.name,
        type: object.type,
        status: result.failed.length > 0 ? 'failed' : 'written',
        ...(result.failed.length > 0 ? { detail: result.failed[0] } : {}),
      });
      written.push(...result.written);
      skipped.push(...result.skipped);
      if (result.failed.length > 0) failed++;
      else pulled++;
    } catch (error: unknown) {
      const code = error instanceof CliError ? error.code : 'PULL_FAILED';
      const detail = error instanceof Error ? error.message : String(error);
      entries.push({ object: item.name, type: item.type, status: 'failed', code, detail });
      failed++;
    }
  }

  const data: Record<string, unknown> = normalizePullData({
    transport: requestNumber,
    requested: ordered.length,
    pulled,
    failed,
    deduplicated: transport.deduplicated,
    entries,
    written,
    skipped,
  });
  if (failed > 0) {
    data.partial = true;
  }
  const human = [
    `Pulled ${pulled}/${ordered.length} objects from transport ${requestNumber}` + (failed > 0 ? ` (${failed} failed)` : ''),
    ...written.map((f) => `  wrote ${f}`),
  ].join('\n');
  return { data, human };
}