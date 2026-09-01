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
import type { DdicSupportedType } from '../../formats/ddic/json.js';
import type { PullOptions, PullResult } from './pull-shared.js';
import { pullObject, humanSummary } from './pull-source.js';
import { runPullDdic, isDdicSupportedType } from './pull-ddic.js';
import { runPullHttp } from './pull-http.js';
import { runPullTran } from './pull-transport.js';
import { runPullTextpool } from './pull-textpool.js';
import { runPullRemote } from './pull-remote.js';
import { runPackagePull } from './pull-package.js';
import { runTransportPull } from './pull-tr.js';

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
  if (typeUpper && DDIC_SUPPORTED_TYPES.indexOf(typeUpper as DdicSupportedType) === -1) {
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