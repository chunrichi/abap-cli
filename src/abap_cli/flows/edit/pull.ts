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
 * Type routes come from `routing.ts`; selectors (--tr / --package / --remote /
 * --textpool) are resolved here before the type lookup. Add a new pull path by
 * adding its handler module + the table row in `routing.ts`.
 */
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { CliError } from '../../output/json.js';
import { collectWarning } from '../../output/meta.js';
import { resolveObject } from '../../core/resolve.js';
import { normalizePullData } from '../../core/path-output.js';
import type { PullOptions, PullResult } from './pull-shared.js';
import { wrapPullResult } from './pull-shared.js';
import { pullObject, humanSummary } from './pull-source.js';
import { runPullTextpool } from './pull-textpool.js';
import { runPullRemote } from './pull-remote.js';
import { runPackagePull } from './pull-package.js';
import { runTransportPull } from './pull-tr.js';
import { normalizeFugrFunctionModule } from './pull-fugr-ff.js';
import { pullRouteFor } from './routing.js';

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

  // Type-specific pull routes come from the explicit routing table: DDIC /
  // HTTP / TRAN (ICF), TTYP / MSAG / DDLS / NROB (channel detection) and the
  // RAP / CDS companion family (ADT). Types without a handler row fall through
  // to the generic ADT source pull below.
  const typeUpper = opts.type?.toUpperCase();
  const route = pullRouteFor(typeUpper);
  if (route?.kind === 'handler') {
    const result = await route.run({ objectName, opts });
    return 'data' in result ? result : wrapPullResult(typeUpper!, result);
  }

  // PR4 (C3): a FUGR/FF (function module) is owned by a parent function
  // group. Rewrite the resolved object to the parent so the fugr pull
  // strategy writes the canonical `<group>/<group>.<fm>.func.abap` layout;
  // `requestedFunctionModule` keeps the original FM identity so the
  // strategy scopes its output to that one module.
  const resolved = await resolveObject(client, objectName, opts.type);
  const versionKind = opts.versionKind ?? 'latest';
  // Warn before writing: the pulled source is the working-area version, which is
  // not what `abap run` executes while an unactivated version exists (F-02).
  if (versionKind === 'latest') {
    await warnIfPendingInactive(client, resolved.objectUrl, resolved.name);
  }
  const { object: pullTarget, requestedFunctionModule } = normalizeFugrFunctionModule(resolved);
  const result = await pullObject(client, pullTarget, { ...opts, requestedFunctionModule });
  return {
    data: normalizePullData({
      object: resolved.name,
      type: resolved.type,
      entries: result.entries,
      written: result.written,
      skipped: result.skipped,
      failed: result.failed,
      versionKind,
    }),
    human:
      humanSummary(resolved, result) +
      (versionKind === 'active' ? ' [active version: matches `abap run`]' : ' [latest/working-area version]'),
  };
}

/**
 * Warn when the object currently holds an unactivated version, i.e. the pulled
 * source is NOT what `abap run` executes.
 *
 * `pull` fetches ADT's working-area (`latest`) version; `run` executes the
 * active version. A failed `push` leaves exactly this split — new source stored
 * inactive, active version unchanged — which is what made `run` look like it was
 * returning stale output (feedback F-02 / F-08).
 */
async function warnIfPendingInactive(
  client: AdtClientWrapper,
  objectUrl: string,
  name: string,
): Promise<void> {
  try {
    const list = (await client.inactiveObjects()) as Array<{
      object?: { 'adtcore:uri'?: string; deleted?: boolean };
    }>;
    const target = objectUrl.replace(/\/+$/, '').toLowerCase();
    const pending = list.some((entry) => {
      const obj = entry?.object;
      if (!obj || obj.deleted === true || typeof obj['adtcore:uri'] !== 'string') return false;
      return obj['adtcore:uri'].replace(/\/+$/, '').toLowerCase() === target;
    });
    if (pending) {
      collectWarning(
        'PENDING_INACTIVE_VERSION',
        `${name} has an unactivated version: the pulled source is not what \`abap run\` executes. ` +
          `Run \`abap activate ${name}\` to activate it, or \`abap pull ${name} --active\` to fetch the active version.`,
        { object: name },
      );
    }
  } catch {
    // The inactive-objects endpoint is unavailable on some releases — skip the
    // hint rather than failing an otherwise successful pull.
  }
}
