/**
 * `abap pull` flow coordinator.
 *
 * Routes the pull selector (object name / --package / --tr / --remote /
 * --textpool / type-specific HTTP/TRAN/DDIC) to the appropriate per-flow
 * module. Each per-flow module owns one pull path:
 *
 *   pull-source      CLAS / INTF / PROG / FUGR / others (ADT REST)
 *   pull-ddic        DOMA / DTEL / TABL / STRU (ICF /ddic/<type>)
 *   pull-http        HTTP service (ICF /http/<name>)
 *   pull-transport   TRAN transaction codes (ICF /tran/<code>)
 *   pull-textpool    .properties files (mixed-mode route)
 *   pull-remote      Version Management remote source
 *   pull-package     --package selector (search + per-object)
 *   pull-tr          --tr selector (transport contents)
 *
 * Add new pull paths by adding a sibling module + a route in `runPull`.
 */
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { CliError } from '../../output/json.js';
import { resolveObject } from '../../core/resolve.js';
import { normalizePullData } from '../../core/path-output.js';
import { DDIC_SUPPORTED_TYPES } from '../../formats/ddic/json.js';
import type { PullOptions, PullResult } from './pull-shared.js';
import { pullObject, humanSummary } from './pull-source.js';
import { runPullDdic, isDdicSupportedType } from './pull-ddic.js';
import { runPullHttp } from './pull-http.js';
import { runPullTran } from './pull-transport.js';
import { runPullTextpool } from './pull-textpool.js';
import { runPullRemote } from './pull-remote.js';
import { runPackagePull } from './pull-package.js';
import { runTransportPull } from './pull-tr.js';
import { runPullTtyp } from './pull-ttyp.js';
import { runPullMsag } from './pull-msag.js';
import { runPullDdls } from './pull-ddls.js';
import { runPullSrvd } from './pull-srvd.js';
import { runPullBdef } from './pull-bdef.js';
import { runPullCdsExtension } from './pull-cds-extension.js';

export type { PullOptions, PullEntry, PullResult } from './pull-shared.js';
export { parsePositiveInt } from './pull-shared.js';
export { pullObject, humanSummary } from './pull-source.js';

export async function runPull(objectName: string, opts: PullOptions): Promise<PullResult> {
  // --tr selector — mutually exclusive with object name and --package.
  if (opts.tr !== undefined) {
    const selectorCount = Number(Boolean(objectName)) + Number(Boolean(opts.package)) + Number(opts.tr !== undefined);
    if (selectorCount > 1) {
      throw new CliError(
        'INVALID_ARGUMENT',
        '--tr cannot be combined with an object name or --package',
        {
          nextSteps: ['Choose exactly one pull selector: an object name, --package, or --tr.'],
          example: 'abap pull --tr NDK123456',
        },
      );
    }
    if (!opts.tr.trim()) {
      throw new CliError('INVALID_ARGUMENT', '--tr must not be empty', {
        example: 'abap pull --tr NDK123456',
      });
    }
    const client = await AdtClientWrapper.create();
    return runTransportPull(client, opts.tr.trim(), opts);
  }

  const client = await AdtClientWrapper.create();
  if (opts.package) {
    return runPackagePull(client, opts);
  }
  if (!objectName) {
    throw new CliError('USAGE', 'Specify an object name (e.g., ZCL_MY_CLASS)', {
      nextSteps: ['Run `abap search <query>` first if you do not know the exact name.'],
      example: 'abap pull ZCL_DEMO',
    });
  }

  if (opts.remote) {
    return runPullRemote(objectName, opts.type, opts.remote, opts);
  }

  if (opts.textpool) {
    return runPullTextpool(objectName, opts.type, opts);
  }

  const typeUpper = opts.type?.toUpperCase();
  if (typeUpper === 'HTTP') {
    return runPullHttp(objectName, opts);
  }
  if (typeUpper === 'TRAN') {
    return runPullTran(objectName, opts);
  }
  if (typeUpper && isDdicSupportedType(typeUpper)) {
    return runPullDdic(objectName, typeUpper, opts);
  }
  // 036-ttyp-msag-ddls: dual-channel DDIC + CDS routing. ADT preferred,
  // ICF fallback for TTYP/MSAG, hard-error for DDLS on ECC.
  if (typeUpper === 'TTYP') {
    const r = await runPullTtyp(objectName, opts);
    return {
      data: normalizePullData({
        object: r.object,
        type: 'TTYP',
        entries: [{ object: r.object, type: 'TTYP', status: 'written', files: r.files }],
        written: r.files.length,
        skipped: 0,
        failed: 0,
        channel: r.channel,
        ...(r.fallbackReason ? { fallbackReason: r.fallbackReason } : {}),
      }),
      human: `Pulled TTYP ${r.object} via ${r.channel}${r.fallbackReason ? ` (${r.fallbackReason})` : ''}; wrote ${r.files.length} file(s)`,
    };
  }
  if (typeUpper === 'MSAG') {
    const r = await runPullMsag(objectName, opts);
    return {
      data: normalizePullData({
        object: r.object,
        type: 'MSAG',
        entries: [{ object: r.object, type: 'MSAG', status: 'written', files: r.files }],
        written: r.files.length,
        skipped: 0,
        failed: 0,
        channel: r.channel,
        ...(r.fallbackReason ? { fallbackReason: r.fallbackReason } : {}),
      }),
      human: `Pulled MSAG ${r.object} via ${r.channel}${r.fallbackReason ? ` (${r.fallbackReason})` : ''}; wrote ${r.files.length} file(s)`,
    };
  }
  if (typeUpper === 'DDLS') {
    const r = await runPullDdls(objectName, opts);
    return {
      data: normalizePullData({
        object: r.object,
        type: 'DDLS',
        entries: [{ object: r.object, type: 'DDLS', status: 'written', files: r.files }],
        written: r.files.length,
        skipped: 0,
        failed: 0,
        channel: r.channel,
      }),
      human: `Pulled DDLS ${r.object} via ${r.channel}; wrote ${r.files.length} file(s)`,
    };
  }
  // T3.1 — SRVD pull. Routes through the sourceObjectStrategy in
  // pull-strategy.ts (SRVD lives in SOURCE_OBJECT_TYPES), but the
  // explicit dispatcher case is kept so callers can pass --type SRVD
  // without going through the resolveObject default path.
  if (typeUpper === 'SRVD') {
    const r = await runPullSrvd(objectName, opts);
    return {
      data: normalizePullData({
        object: r.object,
        type: 'SRVD',
        entries: [{ object: r.object, type: 'SRVD', status: 'written', files: r.files }],
        written: r.files.length,
        skipped: 0,
        failed: 0,
        channel: 'adt',
      }),
      human: `Pulled SRVD ${r.object} via adt; wrote ${r.files.length} file(s)`,
    };
  }
  // T3.3 — BDEF pull. Routes through the sourceObjectStrategy in
  // pull-strategy.ts with the `.abdl` extension (BDEF carries the
  // ABAP Behavior Language, distinct from the `.acds` CDS family).
  if (typeUpper === 'BDEF') {
    const r = await runPullBdef(objectName, opts);
    return {
      data: normalizePullData({
        object: r.object,
        type: 'BDEF',
        entries: [{ object: r.object, type: 'BDEF', status: 'written', files: r.files }],
        written: r.files.length,
        skipped: 0,
        failed: 0,
        channel: 'adt',
      }),
      human: `Pulled BDEF ${r.object} via adt; wrote ${r.files.length} file(s)`,
    };
  }
  // T3.4 — DCLS / DDLX / DDLA. All three share the sourceObjectStrategy
  // flow with the .acds extension; only the AFF folder and ADT endpoint
  // differ (the helper handles that internally).
  if (typeUpper === 'DCLS' || typeUpper === 'DDLX' || typeUpper === 'DDLA') {
    const r = await runPullCdsExtension(typeUpper as 'DCLS' | 'DDLX' | 'DDLA', objectName, opts);
    return {
      data: normalizePullData({
        object: r.object,
        type: typeUpper,
        entries: [{ object: r.object, type: typeUpper, status: 'written', files: r.files }],
        written: r.files.length,
        skipped: 0,
        failed: 0,
        channel: 'adt',
      }),
      human: `Pulled ${typeUpper} ${r.object} via adt; wrote ${r.files.length} file(s)`,
    };
  }
  if (typeUpper && !isDdicSupportedType(typeUpper)) {
    if (/^(DOMA|DTEL|TABL|STRU|TTYP)$/.test(typeUpper)) {
      throw new CliError('DDIC_NOT_SUPPORTED', `Object type ${typeUpper} is not supported in this phase`, {
        type: typeUpper,
        nextSteps: [`Supported DDIC types: ${DDIC_SUPPORTED_TYPES.join(', ')}.`],
      });
    }
  }

  const object = await resolveObject(client, objectName, opts.type);
  const result = await pullObject(client, object, opts);
  return {
    data: normalizePullData({ object: object.name, type: object.type, entries: result.entries, written: result.written, skipped: result.skipped, failed: result.failed }),
    human: humanSummary(object, result),
  };
}