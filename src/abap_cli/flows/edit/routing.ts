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
import { readFile } from 'node:fs/promises';
import type { AdtClientWrapper } from '../../clients/adt-client.js';
import { CliError, type OutputMode } from '../../output/json.js';
import type { DdicSupportedType } from '../../types/registry.js';
import { ttypArtifact } from '../../formats/ttyp/json.js';
import { typeArtifact } from '../../formats/type/json.js';
import { msagArtifact } from '../../formats/msag/json.js';
import { ddlsArtifact } from '../../formats/ddls/json.js';
import { enquArtifact } from '../../formats/enqu/json.js';
import { nrobArtifact } from '../../formats/nrob/json.js';
import { chkcArtifact, chkoArtifact, chkvArtifact, type AtcType } from '../../formats/atc/json.js';
import {
  dtdcArtifact,
  dtebArtifact,
  dsfdArtifact,
  dsfiArtifact,
  drtyArtifact,
  type CdsTechType,
} from '../../formats/cds-tech/json.js';
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
import { createBdefHandler } from './create-bdef.js';
import { createSrvbHandler } from './create-srvb.js';
import { createAtcHandler } from './create-atc.js';
import { pullAtcHandler } from './pull-atc.js';
import { runPushAtc } from './push-atc.js';
import { createCdsTechHandler } from './create-cds-tech.js';
import { pullCdsTechHandler } from './pull-cds-tech.js';
import { runPushCdsTech } from './push-cds-tech.js';
import { createTypeHandler } from './create-type.js';
import { pullTypeHandler } from './pull-type.js';
import { runPushType } from './push-type.js';
import { createEnquHandler } from './create-enqu.js';
import { createNrobHandler } from './create-nrob.js';
import { createDevcHandler } from './create-devc.js';
import { createViewHandler } from './create-view.js';
import { createShlpHandler } from './create-shlp.js';
import { pullDevcHandler } from './pull-devc.js';
import { createXsltHandler } from './create-xslt.js';
import { runPullXslt } from './pull-xslt.js';
import { pushXsltFile, validateXsltFile } from './push-xslt.js';
import { pullTtypHandler } from './pull-ttyp.js';
import { pullMsagHandler } from './pull-msag.js';
import { pullDdlsHandler } from './pull-ddls.js';
import { pullSrvdHandler } from './pull-srvd.js';
import { pullBdefHandler } from './pull-bdef.js';
import { pullCdsExtensionHandler } from './pull-cds-extension.js';
import { pullEnquHandler } from './pull-enqu.js';
import { pullNrobHandler } from './pull-nrob.js';
import { runPullView } from './pull-view.js';
import { runPullShlp } from './pull-shlp.js';
import { runPullDdic } from './pull-ddic.js';
import { runPullHttp } from './pull-http.js';
import { runPullTran } from './pull-transport.js';
import { runPushTtyp } from './push-ttyp.js';
import { runPushMsag } from './push-msag.js';
import { runPushDdls } from './push-ddls.js';
import { runPushEnqu } from './push-enqu.js';
import { runPushNrob } from './push-nrob.js';
import { pushViewFile, validateViewFile } from './push-view.js';
import { pushShlpFile, validateShlpFile } from './push-shlp.js';
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
  /** Local structural validation, used by `--atomic`. */
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
  CHKC: chkcArtifact,
  CHKO: chkoArtifact,
  CHKV: chkvArtifact,
  DTDC: dtdcArtifact,
  DTEB: dtebArtifact,
  DSFD: dsfdArtifact,
  DSFI: dsfiArtifact,
  DRTY: drtyArtifact,
  TYPE: typeArtifact,
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

/** ATC ADT write route: locked PUT, then activation unless --no-activate. */
function atcPushRoute(type: AtcType): JsonPushRoute {
  return {
    kind: 'aff-json',
    channel: 'adt',
    run: async ({ client, file, opts }) => {
      await runPushAtc(client, type, file, { transport: opts.tr, activate: opts.activate });
      return { transport: opts.tr ?? '', channel: 'adt' };
    },
    validate: (file, objectType) => validateAffFile(objectType, file),
  };
}

/**
 * CDS technical objects: `.acds` sidecars are read together with their JSON
 * document, so `--atomic` validates the JSON against the AFF schema and only
 * checks the sidecar is non-empty.
 */
async function validateCdsTechFile(file: string, objectType: string): Promise<void> {
  const resolved = path.basename(file).toLowerCase();
  if (resolved.endsWith('.acds')) {
    const content = await readFile(file, 'utf8');
    if (!content.trim()) throw new CliError('VALIDATION_ERROR', `Empty source sidecar: ${path.basename(file)}`);
    return;
  }
  await validateAffFile(objectType, file);
}

/** CDS technical ADT write route: locked source PUT, then activation. */
function cdsTechPushRoute(type: CdsTechType): JsonPushRoute {
  return {
    kind: 'aff-json',
    channel: 'adt',
    run: async ({ client, file, opts }) => {
      await runPushCdsTech(client, type, file, { transport: opts.tr, activate: opts.activate });
      return { transport: opts.tr ?? '', channel: 'adt' };
    },
    validate: (file, objectType) => validateCdsTechFile(file, objectType),
  };
}

/**
 * Type-pool push: `.type.abap` is the source companion of `.type.json`. Pushing
 * it on its own is rejected, but `--atomic` validation must only check the
 * companion is non-empty instead of trying to JSON-parse it.
 */
function typePushRoute(): JsonPushRoute {
  return {
    kind: 'aff-json',
    channel: 'adt',
    run: async ({ file, opts }) => {
      await runPushType(file, { transport: opts.tr, activate: opts.activate });
      return { transport: opts.tr ?? '', channel: 'adt' };
    },
    validate: async (file, objectType) => {
      if (path.basename(file).toLowerCase().endsWith('.type.abap')) {
        const content = await readFile(file, 'utf8');
        if (!content.trim()) throw new CliError('VALIDATION_ERROR', `Empty TYPE source companion: ${path.basename(file)}`);
        return;
      }
      await validateAffFile(objectType, file);
    },
  };
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

  // Package (DEVC) — one ADT resource, no source include. Create/pull are
  // dedicated handlers (`create-devc` / `pull-devc`) because the wire format is
  // the `pak:package` XML, not ABAP source. No push route: ADT has no package
  // update endpoint (PUT is rejected by the resource controller).
  DEVC: {
    create: handler('adt', createDevcHandler),
    pull: handler('adt', pullDevcHandler),
  },

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

  // Database view (SE11 view) — local-extension `view-v1` document, ICF only;
  // ADT has no view resource, so all three operations go through /ddic/view.
  VIEW: {
    create: handler('icf', createViewHandler),
    pull: handler('icf', ({ objectName, opts }) => runPullView(objectName, opts)),
    push: {
      kind: 'icf-json',
      channel: 'icf',
      run: ({ client, resolved, file, opts }) => pushViewFile(client, resolved, file, opts),
      validate: (file) => validateViewFile(file),
    },
  },

  // Search help (SE11 search help) — local-extension `shlp-v1` document, ICF
  // only; ADT has no search-help resource, so all operations use /ddic/shlp.
  SHLP: {
    create: handler('icf', createShlpHandler),
    pull: handler('icf', ({ objectName, opts }) => runPullShlp(objectName, opts)),
    push: {
      kind: 'icf-json',
      channel: 'icf',
      run: ({ client, resolved, file, opts }) => pushShlpFile(client, resolved, file, opts),
      validate: (file) => validateShlpFile(file),
    },
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
  // Transformation (XSLT program) — ICF `/xslt/<name>`; AFF pair
  // (<name>.xslt.json + <name>.xslt.xml) on the local side.
  XSLT: {
    create: handler('icf', createXsltHandler),
    pull: handler('icf', ({ objectName, opts }) => runPullXslt(objectName, opts)),
    push: {
      kind: 'icf-json',
      channel: 'icf',
      run: ({ client, resolved, file, opts }) => pushXsltFile(client, resolved, file, opts),
      validate: (file) => validateXsltFile(file),
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
    create: handler('adt', createBdefHandler),
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

  // Service binding — metadata-only pull; create posts the ADT binding and
  // can publish it. Push/update is not supported (AFF is lossy).
  SRVB: {
    create: handler('adt', createSrvbHandler),
    pull: source(),
  },

  // ATC configuration objects — pure-JSON AFF over versioned ADT XML
  // resources. Create needs an explicit activate; push is a locked PUT.
  CHKC: {
    create: handler('adt', createAtcHandler('CHKC')),
    pull: handler('adt', pullAtcHandler('CHKC')),
    push: atcPushRoute('CHKC'),
  },
  CHKO: {
    create: handler('adt', createAtcHandler('CHKO')),
    pull: handler('adt', pullAtcHandler('CHKO')),
    push: atcPushRoute('CHKO'),
  },
  CHKV: {
    create: handler('adt', createAtcHandler('CHKV')),
    pull: handler('adt', pullAtcHandler('CHKV')),
    push: atcPushRoute('CHKV'),
  },

  // CDS technical objects — metadata + `.acds` source pairs (DSFI: single
  // AFF JSON document). No ICF fallback.
  DTDC: {
    create: handler('adt', createCdsTechHandler('DTDC')),
    pull: handler('adt', pullCdsTechHandler('DTDC')),
    push: cdsTechPushRoute('DTDC'),
  },
  DTEB: {
    create: handler('adt', createCdsTechHandler('DTEB')),
    pull: handler('adt', pullCdsTechHandler('DTEB')),
    push: cdsTechPushRoute('DTEB'),
  },
  DSFD: {
    create: handler('adt', createCdsTechHandler('DSFD')),
    pull: handler('adt', pullCdsTechHandler('DSFD')),
    push: cdsTechPushRoute('DSFD'),
  },
  DSFI: {
    create: handler('adt', createCdsTechHandler('DSFI')),
    pull: handler('adt', pullCdsTechHandler('DSFI')),
    push: cdsTechPushRoute('DSFI'),
  },
  DRTY: {
    create: handler('adt', createCdsTechHandler('DRTY')),
    pull: handler('adt', pullCdsTechHandler('DRTY')),
    push: cdsTechPushRoute('DRTY'),
  },
  TYPE: {
    create: handler('adt', createTypeHandler),
    pull: handler('adt', pullTypeHandler),
    push: typePushRoute(),
  },
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
