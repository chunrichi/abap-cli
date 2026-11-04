/**
 * Shared helpers for the generic AFF object flows.
 *
 * The registry marks the six AFF types with `affChannel`, which selects the
 * transport: `'adt-blue'` for the four types whose `source/main` *is* the AFF
 * document (APLO / CHDO / EVTB / SMBC) and `'icf'` for the read-only ICF
 * `/aff` types (ENHO / ENHS). `create` / `pull` / `push` / `delete` share the
 * local-bundle plumbing here and dispatch to the channel implementation in
 * `*-aff.ts` flows.
 *
 * The transport rule is the same on both channels: local (`$`-prefixed)
 * packages are transport-free; anything else must carry an explicit request.
 */
import type { IcfClient, IcfResponse } from '../../clients/icf-client.js';
import { isAdtBlueSourceType, type AdtBlueSourceType } from '../../clients/adt-blue-source.js';
import { CliError } from '../../output/json.js';
import type { ErrorCode } from '../../output/error-codes.js';
import { isLocalPackageName } from '../../core/transport.js';
import {
  affBundleTypeFor,
  affChannelFor,
  affSchemaFileFor,
  type AffBundleType,
  type AffChannel,
} from '../../types/registry.js';
import * as path from 'node:path';
import { toRelativeOutputPath } from '../../core/path-output.js';
import {
  affLocalPrefix,
  assertAffBundlePayload,
  discoverAffBundleFiles,
  readValidatedAffBundle,
  type AffBundle,
  type AffBundleFile,
} from '../../formats/aff/bundle.js';

/** Normalized AFF object name (TADIR names are uppercase; namespaces keep slashes). */
export function normalizeAffObjectName(name: string): string {
  return name.trim().toUpperCase();
}

/**
 * Narrow a user/route type code to the generic AFF channel.
 * Unknown or non-AFF types are a usage error (the routing table should have
 * prevented them, so this is the defensive single point).
 */
export function requireAffBundleType(type: string | undefined): AffBundleType {
  const resolved = affBundleTypeFor(type);
  if (!resolved) {
    throw new CliError('TYPE_NOT_SUPPORTED', `Type ${type ?? '<missing>'} is not served by the generic AFF channel`, {
      details: { type },
      nextSteps: ['Supported AFF bundle types: APLO, CHDO, EVTB, SMBC, ENHO, ENHS.'],
    });
  }
  return resolved;
}

/**
 * Enforce the transport rule for an AFF write/delete.
 *
 * `$`-prefixed packages are transport-free, so a stray `--tr` is dropped
 * instead of reaching SAP. Every other package needs an explicit request; the
 * CLI rejects locally (exit 7) and the endpoint re-checks (`AFF_TRANSPORT_REQUIRED`).
 */
export function affTransportFor(
  object: { type: string; name: string; packageName?: string },
  tr: string | undefined,
  action: 'create' | 'update' | 'delete',
): string | undefined {
  if (isLocalPackageName(object.packageName)) return undefined;
  const request = (tr ?? '').trim().toUpperCase();
  if (!request) {
    const verb = action === 'create' ? 'create' : action === 'delete' ? 'delete' : 'push';
    throw new CliError(
      'AFF_TRANSPORT_REQUIRED',
      `AFF ${action} of ${object.type} ${object.name} in package ${object.packageName ?? '<unknown>'} requires --tr <request>`,
      {
        details: { object: object.name, type: object.type, packageName: object.packageName },
        nextSteps: [
          'Pass --tr <request> to record the change in a transportable request.',
          `Or move the object to a local package ($TMP) for scratch work.`,
        ],
        example: `abap ${verb} ${object.type} ${object.name} --tr NDK900123`,
      },
    );
  }
  return request;
}

/** Response code from a normalized ICF envelope, falling back for transport-less errors. */
export function affResponseCode(resp: IcfResponse<unknown> | undefined, fallback: ErrorCode): ErrorCode {
  return (resp?.error?.code as ErrorCode | undefined) ?? fallback;
}

/**
 * GET `/aff/<TYPE>/<NAME>` and normalize the response into a bundle.
 *
 * One read path serves pull (write the files), push and delete (both need the
 * package that decides the transport rule). A missing object maps to the
 * generic `OBJECT_NOT_FOUND` contract (exit 8) so agents see the same shape as
 * every other object type; every other endpoint code passes through.
 */
export async function fetchAffBundle(
  icf: IcfClient,
  type: AffBundleType,
  name: string,
  opts: { action: 'pull' | 'update' | 'delete'; file?: string },
): Promise<AffBundle> {
  let resp: IcfResponse<unknown>;
  try {
    resp = await icf.getAff<unknown>(type, name);
  } catch (error: unknown) {
    // Transport-normalized errors already carry the endpoint code (e.g. an
    // HTTP 404 answer).
    if (error instanceof CliError && error.code === 'AFF_NOT_FOUND') {
      throw affNotFound(type, name, opts);
    }
    throw error;
  }
  if (resp.status !== 'success' || !resp.data) {
    if (resp.error?.code === 'AFF_NOT_FOUND') throw affNotFound(type, name, opts);
    throw new CliError(
      affResponseCode(resp, 'AFF_READ_FAILED'),
      resp.error?.message ?? `Failed to read ${type} ${name}`,
      {
        details: { object: name, type, ...(resp.error?.details ? { endpointDetails: resp.error.details } : {}) },
        nextSteps: ['Verify the deployed ICF service version (run `abap doctor`).'],
      },
    );
  }
  const bundle = assertAffBundlePayload(resp.data);
  return { ...bundle, type: bundle.type || type, name: bundle.name || name };
}

/** Generic not-found error for the AFF channel (exit 8). */
function affNotFound(
  type: string,
  name: string,
  opts: { action: 'pull' | 'update' | 'delete'; file?: string },
): CliError {
  if (opts.action === 'update') {
    return new CliError('OBJECT_NOT_FOUND', `${type} ${name} does not exist; push updates existing objects only`, {
      object: name,
      type,
      ...(opts.file ? { file: opts.file } : {}),
      nextSteps: [
        `Create it first: abap create ${type} ${name} --file <main AFF document> --package <package> --yes`,
        'Then push again to update the object.',
      ],
      example: `abap push <main AFF document>`,
    });
  }
  return new CliError('OBJECT_NOT_FOUND', `${type} ${name} does not exist`, {
    object: name,
    type,
    nextSteps: [
      'Verify the object exists in the target system and that the type matches.',
      `Run \`abap types ${type}\` to check the type code and its TADIR mapping.`,
    ],
  });
}


/** Transport channel of an AFF object type (the registry is the single source). */
export function affChannelForType(type: AffBundleType): AffChannel {
  return affChannelFor(type)!;
}

/** Local, validated AFF bundle context shared by the create/push flows. */
export interface LocalAffBundleContext {
  type: AffBundleType;
  name: string;
  /** cwd-relative POSIX path of the document the user addressed. */
  file: string;
  /** Bundle files (main document first) ready to ship. */
  files: AffBundleFile[];
}

/**
 * Resolve + validate the local AFF bundle that `file` belongs to.
 *
 * One file of the object is enough: the group is discovered flat in the same
 * directory by the `<object-token>.<type-lower>.` prefix. The main document is
 * validated against the vendored AFF schema; companions only have to be
 * readable (they may be non-JSON content files).
 */
export async function readLocalAffBundle(
  file: string,
  typeArg: string,
  objectArg: string,
): Promise<LocalAffBundleContext> {
  const type = requireAffBundleType(typeArg);
  const name = normalizeAffObjectName(objectArg);
  const abs = path.resolve(process.cwd(), file);
  const outFile = toRelativeOutputPath(abs);
  const prefix = affLocalPrefix(name, type);
  if (!path.basename(abs).toLowerCase().startsWith(prefix)) {
    throw new CliError(
      'AFF_FILE_INVALID',
      `${path.basename(abs)} is not part of the ${type} ${name} AFF bundle; expected a file starting with ${prefix}`,
      {
        type,
        object: name,
        file: outFile,
        nextSteps: [
          `The local AFF file is flat and lowercase: <object-token>.${type.toLowerCase()}.json.`,
          `Run \`abap pull ${name} --type ${type} --overwrite\` to regenerate the canonical file.`,
        ],
      },
    );
  }
  const discovered = await discoverAffBundleFiles(path.dirname(abs), name, type);
  const bundle = await readValidatedAffBundle(discovered, name, type, affSchemaFileFor(type));
  return { type, name, file: outFile, files: bundle.files };
}


/**
 * Narrow an AFF type to the ADT blueSource channel. The flows call this after
 * the channel check; reaching it for an ICF-only type is a routing bug.
 */
export function requireAdtAffType(type: AffBundleType): AdtBlueSourceType {
  if (!isAdtBlueSourceType(type)) {
    throw new CliError('TYPE_NOT_SUPPORTED', `${type} is not transported over an ADT blueSource resource`, {
      type,
      nextSteps: ['This is an internal routing error; report the command invocation.'],
    });
  }
  return type;
}
