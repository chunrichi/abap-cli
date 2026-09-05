/**
 * DCLS / DDLX / DDLA / BDEF / SRVD push — five ADT source-object types
 * (CDS extensions + behaviour definition + service definition) share
 * the same flow (lock → setObjectSource → check → activate → unlock).
 * The `pushObject` orchestrator already covers the CLI's `abap push`
 * path via `resolveFile`, so this module is a thin typed entry point
 * for callers that bypass the CLI dispatcher (tests, programmatic
 * push from the `Run` action, etc.).
 */
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { pushObject, type PushStage } from './push-object.js';
import type { Warning } from '../../output/meta.js';
import { resolveObject, getObjectParts } from '../../core/resolve.js';
import { resolveTransport } from '../../core/transport.js';
import { CliError } from '../../output/json.js';

export type CdsExtensionType = 'DCLS' | 'DDLX' | 'DDLA';
/** Source-bearing ADT object types that share the same push flow. */
export type SourceObjectPushType = CdsExtensionType | 'BDEF' | 'SRVD';

export interface PushSourceObjectOptions {
  transport?: string;
  checkOnly?: boolean;
  dryRun?: boolean;
  activate?: boolean;
}

export interface PushSourceObjectResult {
  object: string;
  transport: string;
}

export async function pushSourceObjectOne<T extends SourceObjectPushType>(
  client: AdtClientWrapper,
  type: T,
  object: { name: string; objectUrl: string },
  source: string,
  opts: PushSourceObjectOptions & { transport?: string; onStage?: (s: PushStage) => void; onWarning?: (w: Warning) => void },
): Promise<PushSourceObjectResult> {
  const resolved = await resolveObject(client, object.name, type);
  const transport = opts.transport
    ?? (resolved.packageName === '$TMP' ? '' : await resolveTransport(client, opts.transport, client.getConfig().transport));
  if (!transport && resolved.packageName !== '$TMP') {
    throw new CliError('NO_TRANSPORT', `No transport available for ${type} push; pass --tr or set config.transport`, {
      object: object.name,
    });
  }
  const parts = await getObjectParts(client, resolved);
  const main = parts.find((p) => p.subtype === 'main');
  if (!main) {
    throw new CliError('SAP_ERROR', `No source part for ${type} ${object.name}`, {
      object: object.name,
    });
  }
  await pushObject(
    client,
    { name: resolved.name, type: resolved.type, objectUrl: resolved.objectUrl },
    [{ subtype: main.subtype, sourceUrl: main.sourceUrl, content: source }],
    {
      transport,
      checkOnly: opts.checkOnly ?? false,
      activate: opts.activate,
      dryRun: opts.dryRun,
      onStage: opts.onStage,
      onWarning: opts.onWarning,
    },
  );
  return { object: resolved.name, transport };
}

// ---------------------------------------------------------------------------
// Per-type thin wrappers. Each call site picks the wrapper that matches its
// type code; the wrappers simply forward through `pushSourceObjectOne`.
// ---------------------------------------------------------------------------

export async function pushCdsExtensionOne(
  client: AdtClientWrapper,
  type: CdsExtensionType,
  object: { name: string; objectUrl: string },
  source: string,
  opts: PushSourceObjectOptions & { transport?: string; onStage?: (s: PushStage) => void; onWarning?: (w: Warning) => void },
): Promise<PushSourceObjectResult> {
  return pushSourceObjectOne(client, type, object, source, opts);
}

export async function pushBdefOne(
  client: AdtClientWrapper,
  object: { name: string; objectUrl: string },
  source: string,
  opts: PushSourceObjectOptions & { transport?: string; onStage?: (s: PushStage) => void; onWarning?: (w: Warning) => void },
): Promise<PushSourceObjectResult> {
  return pushSourceObjectOne(client, 'BDEF', object, source, opts);
}

export async function pushSrvdOne(
  client: AdtClientWrapper,
  object: { name: string; objectUrl: string },
  source: string,
  opts: PushSourceObjectOptions & { transport?: string; onStage?: (s: PushStage) => void; onWarning?: (w: Warning) => void },
): Promise<PushSourceObjectResult> {
  return pushSourceObjectOne(client, 'SRVD', object, source, opts);
}

export function pushDclsOne(
  client: AdtClientWrapper,
  object: { name: string; objectUrl: string },
  source: string,
  opts: PushSourceObjectOptions & { transport?: string; onStage?: (s: PushStage) => void; onWarning?: (w: Warning) => void },
) {
  return pushCdsExtensionOne(client, 'DCLS', object, source, opts);
}

export function pushDdlxOne(
  client: AdtClientWrapper,
  object: { name: string; objectUrl: string },
  source: string,
  opts: PushSourceObjectOptions & { transport?: string; onStage?: (s: PushStage) => void; onWarning?: (w: Warning) => void },
) {
  return pushCdsExtensionOne(client, 'DDLX', object, source, opts);
}

export function pushDdlaOne(
  client: AdtClientWrapper,
  object: { name: string; objectUrl: string },
  source: string,
  opts: PushSourceObjectOptions & { transport?: string; onStage?: (s: PushStage) => void; onWarning?: (w: Warning) => void },
) {
  return pushCdsExtensionOne(client, 'DDLA', object, source, opts);
}
