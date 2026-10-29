/**
 * Explicit object-type routing table.
 *
 * One table states, for every supported object type, which create / pull /
 * push handler serves it and which SAP channel that operation uses:
 *
 *   'adt'  — ADT REST API only
 *   'icf'  — self-built ICF service only
 *   'auto' — the flow runs channel detection (ADT primary, ICF fallback on
 *            older ECC releases); see `channel-detect.ts`
 *
 * `kind: 'source'` means the operation uses the generic ABAP-source path in
 * the coordinator (`create.ts` / `pull.ts` / `push.ts`); `kind: 'handler'`
 * points at a per-type flow module.
 *
 * Why a table instead of module-load registration: the former
 * `registerCreateHandler` / `registerPullHandler` side effects made the routes
 * implicit (registration order mattered, dispatch was untestable without a
 * mutable-registry snapshot API, and the import graph grew a cycle). Adding a
 * type is now one row here plus its handler module.
 */
import * as path from 'node:path';
import type { AdtClientWrapper } from '../../clients/adt-client.js';
import { CliError, type OutputMode } from '../../output/json.js';
import type { DdicSupportedType } from '../../types/registry.js';
import { ttypArtifact } from '../../formats/ttyp/json.js';
import { msagArtifact } from '../../formats/msag/json.js';
import { ddlsArtifact } from '../../formats/ddls/json.js';
import { enquArtifact } from '../../formats/enqu/json.js';
import { nrobArtifact } from '../../formats/nrob/json.js';
import type { JsonArtifact } from '../../formats/artifact.js';
import type { CreateOptions } from './create.js';
import type { PullOptions, PullResult, TypePullResult } from './pull-shared.js';
import type { JsonPushTarget, PushFileOptions, PushOneResult } from './push-types.js';
import { createDdicHandler } from './create-ddic.js';
import { createHttpHandler } from './create-http.js';
import { createTranHandler } from './create-tran.js';
import { createTtypHandler } from './create-ttyp.js';
import { createMsagHandler } from './create-msag.js';
import { createDdlsHandler } from './create-ddls.js';
import { createCdsExtensionHandler } from './create-cds-extension.js';
import { createSrvdHandler } from './create-srvd.js';
import { createEnquHandler } from './create-enqu.js';
import { createNrobHandler } from './create-nrob.js';
import { pullTtypHandler } from './pull-ttyp.js';
import { pullMsagHandler } from './pull-msag.js';
import { pullDdlsHandler } from './pull-ddls.js';
import { pullSrvdHandler } from './pull-srvd.js';
import { pullBdefHandler } from './pull-bdef.js';
import { pullCdsExtensionHandler } from './pull-cds-extension.js';
import { pullEnquHandler } from './pull-enqu.js';
import { pullNrobHandler } from './pull-nrob.js';
import { runPullDdic } from './pull-ddic.js';
import { runPullHttp } from './pull-http.js';
import { runPullTran } from './pull-transport.js';
import { runPushTtyp } from './push-ttyp.js';
import { runPushMsag } from './push-msag.js';
import { runPushDdls } from './push-ddls.js';
import { runPushEnqu } from './push-enqu.js';
import { runPushNrob } from './push-nrob.js';
import {
  pushDdicFile,
  pushHttpFile,
  pushTranFile,
  validateDdicFile,
  validateHttpFile,
  validateTranFile,
} from './push-icf.js';

/** SAP channel a write/read uses. */
export type SapChannel = 'adt' | 'icf';
/** Per-operation channel; 'auto' defers to channel detection at runtime. */
export type RouteChannel = SapChannel | 'auto';

export interface CreateHandlerArgs {
  /** Type code exactly as the user (or caller) passed it, uppercased. */
  type: string;
  name: string;
  opts: CreateOptions;
  mode: OutputMode;
}
/** Per-type create flow. */
export type CreateHandler = (args: CreateHandlerArgs) => Promise<void>;

export interface PullHandlerArgs {
  objectName: string;
  opts: PullOptions;
}
/** A pull handler either returns the ready envelope (`PullResult`) or the
 *  per-type shape the coordinator wraps (`TypePullResult`). */
export type PullRouteResult = PullResult | TypePullResult;
/** Per-type pull flow. */
export type PullHandler = (args: PullHandlerArgs) => Promise<PullRouteResult>;

export interface PushRunArgs {
  client: AdtClientWrapper;
  resolved: JsonPushTarget;
  file: string;
  opts: PushFileOptions;
}

/** Generic ABAP-source path (the coordinator itself handles the operation). */
interface SourceRoute {
  kind: 'source';
  channel: SapChannel;
}
interface HandlerRoute<H> {
  kind: 'handler';
  channel: RouteChannel;
  run: H;
}

export type CreateRoute = SourceRoute | HandlerRoute<CreateHandler>;
export type PullRoute = SourceRoute | HandlerRoute<PullHandler>;

/** Artifact push route: the local file is an AFF `.json`, not ABAP source. */
export interface JsonPushRoute {
  /** 'icf-json' posts straight through the ICF service; 'aff-json' runs channel detection. */
  kind: 'icf-json' | 'aff-json';
  channel: RouteChannel;
  run: (args: PushRunArgs) => Promise<PushOneResult>;
  /** Local structural validation, used by `--atomic` phase 1. */
  validate: (file: string, objectType: string) => Promise<void>;
}
export type PushRoute = SourceRoute | JsonPushRoute;

export interface TypeRoute {
  create?: CreateRoute;
  pull?: PullRoute;
  push?: PushRoute;
}

const source = (channel: SapChannel = 'adt'): SourceRoute => ({ kind: 'source', channel });
const handler = <H>(channel: RouteChannel, run: H): HandlerRoute<H> => ({ kind: 'handler', channel, run });

/** DDIC pull is one flow parameterised by type (ICF `/ddic/<type>`). */
function ddicPullRoute(type: DdicSupportedType): PullRoute {
  return handler('icf', ({ objectName, opts }) => runPullDdic(objectName, type, opts));
}

/** DDIC push is one ICF flow parameterised by type. */
function ddicPushRoute(type: DdicSupportedType): JsonPushRoute {
  return {
    kind: 'icf-json',
    channel: 'icf',
    run: ({ client, resolved, file, opts }) => pushDdicFile(client, resolved, file, opts, type),
    validate: (file) => validateDdicFile(file, type),
  };
}

/** Channel-routed AFF push (TTYP / MSAG / DDLS / NROB). */
function affPushRoute(
  channel: RouteChannel,
  run: (file: string, opts: PushFileOptions) => Promise<{ channel: SapChannel }>,
): JsonPushRoute {
  return {
    kind: 'aff-json',
    channel,
    run: async ({ file, opts }) => {
      const result = await run(file, opts);
      return { transport: opts.tr ?? '', status: 'written', channel: result.channel };
    },
    validate: (file, objectType) => validateAffFile(objectType, file),
  };
}

/** AFF artifacts behind the channel-routed `aff-json` push kinds. */
const AFF_ARTIFACTS: Readonly<Record<string, JsonArtifact<unknown>>> = {
  TTYP: ttypArtifact,
  MSAG: msagArtifact,
  DDLS: ddlsArtifact,
  ENQU: enquArtifact,
  NROB: nrobArtifact,
};

/** AFF validator for one channel-routed type (mirrors the create/pull sides). */
async function validateAffFile(objectType: string, file: string): Promise<void> {
  const artifact = AFF_ARTIFACTS[objectType];
  if (!artifact) {
    throw new CliError('TYPE_NOT_SUPPORTED', `No AFF artifact validator for ${objectType}`, { type: objectType });
  }
  const errors = await artifact.validate(await artifact.read(path.resolve(process.cwd(), file)));
  if (errors.length > 0) throw new CliError('VALIDATION_ERROR', errors.join('; '));
}

/**
 * The routing table — one row per supported object type.
 *
 * Rows shadow `TYPE_REGISTRY` on purpose: the registry owns local-layout
 * metadata (folder / AFF schema / create objtype), this table owns the
 * operation routes. `test/unit/routing.test.ts` fails when the two drift.
 */
export const TYPE_ROUTES: Readonly<Record<string, TypeRoute>> = {
  // Source objects — the generic ABAP-source path on all three operations.
  CLAS: { create: source(), pull: source(), push: source() },
  INTF: { create: source(), pull: source(), push: source() },
  PROG: { create: source(), pull: source(), push: source() },
  FUGR: { create: source(), pull: source(), push: source() },

  // DDIC objects — ICF `/ddic/<type>` on all three operations.
  TABL: { create: handler('icf', createDdicHandler), pull: ddicPullRoute('TABL'), push: ddicPushRoute('TABL') },
  STRU: { create: handler('icf', createDdicHandler), pull: ddicPullRoute('STRU'), push: ddicPushRoute('STRU') },
  DOMA: { create: handler('icf', createDdicHandler), pull: ddicPullRoute('DOMA'), push: ddicPushRoute('DOMA') },
  DTEL: { create: handler('icf', createDdicHandler), pull: ddicPullRoute('DTEL'), push: ddicPushRoute('DTEL') },

  // Lock object / number range object — DDIC family, ICF only on write.
  ENQU: {
    create: handler('icf', createEnquHandler),
    pull: handler('icf', pullEnquHandler),
    push: {
      kind: 'icf-json',
      channel: 'icf',
      run: async ({ file, opts }) => {
        await runPushEnqu(file, { transport: opts.tr });
        return { transport: opts.tr ?? '', status: 'written', channel: 'icf' };
      },
      validate: (file, objectType) => validateAffFile(objectType, file),
    },
  },
  NROB: {
    create: handler('icf', createNrobHandler),
    pull: handler('auto', pullNrobHandler),
    push: affPushRoute('icf', (file, opts) => runPushNrob(file, { transport: opts.tr })),
  },

  // ICF service node / transaction code — one typed ICF endpoint each.
  HTTP: {
    create: handler('icf', createHttpHandler),
    pull: handler('icf', ({ objectName, opts }) => runPullHttp(objectName, opts)),
    push: {
      kind: 'icf-json',
      channel: 'icf',
      run: ({ client, resolved, file, opts }) => pushHttpFile(client, resolved, file, opts),
      validate: (file) => validateHttpFile(file),
    },
  },
  TRAN: {
    create: handler('icf', createTranHandler),
    pull: handler('icf', ({ objectName, opts }) => runPullTran(objectName, opts)),
    push: {
      kind: 'icf-json',
      channel: 'icf',
      run: ({ client, resolved, file, opts }) => pushTranFile(client, resolved, file, opts),
      validate: (file) => validateTranFile(file),
    },
  },

  // Dual-channel DDIC + CDS: channel detection picks ADT vs ICF per release.
  TTYP: {
    create: handler('auto', createTtypHandler),
    pull: handler('auto', pullTtypHandler),
    push: affPushRoute('auto', (file, opts) => runPushTtyp(file, { transport: opts.tr })),
  },
  MSAG: {
    create: handler('auto', createMsagHandler),
    pull: handler('auto', pullMsagHandler),
    push: affPushRoute('auto', (file, opts) => runPushMsag(file, { transport: opts.tr })),
  },
  DDLS: {
    create: handler('auto', createDdlsHandler),
    pull: handler('auto', pullDdlsHandler),
    push: affPushRoute('auto', (file, opts) => runPushDdls(file, { transport: opts.tr })),
  },

  // RAP / CDS companions — ADT source objects created from AFF JSON, then
  // pushed as `.acds` source.
  SRVD: {
    create: handler('adt', createSrvdHandler),
    pull: handler('adt', pullSrvdHandler),
    push: source(),
  },
  BDEF: {
    // pull-only: abap-adt-api has no BDEF create endpoint.
    pull: handler('adt', pullBdefHandler),
    push: source(),
  },
  DCLS: {
    create: handler('adt', createCdsExtensionHandler('DCLS')),
    pull: handler('adt', pullCdsExtensionHandler('DCLS')),
    push: source(),
  },
  DDLX: {
    create: handler('adt', createCdsExtensionHandler('DDLX')),
    pull: handler('adt', pullCdsExtensionHandler('DDLX')),
    push: source(),
  },
  DDLA: {
    create: handler('adt', createCdsExtensionHandler('DDLA')),
    pull: handler('adt', pullCdsExtensionHandler('DDLA')),
    push: source(),
  },

  // Service binding — metadata-only pull (no source, no create/push path yet).
  SRVB: { pull: source() },
};

/** Full route row for a type code (case-insensitive). */
export function typeRouteFor(type: string | undefined): TypeRoute | undefined {
  if (!type) return undefined;
  return TYPE_ROUTES[type.toUpperCase()];
}

export function createRouteFor(type: string | undefined): CreateRoute | undefined {
  return typeRouteFor(type)?.create;
}

export function pullRouteFor(type: string | undefined): PullRoute | undefined {
  return typeRouteFor(type)?.pull;
}

export function pushRouteFor(type: string | undefined): PushRoute | undefined {
  return typeRouteFor(type)?.push;
}
