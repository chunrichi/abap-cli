/**
 * Package + transport resolution for AFF artifact pushes.
 *
 * `abap pull` writes abap-file-format documents, and the AFF schema has no
 * `package` property, so an update push starts without a package even though
 * the SAP-side object has one. When the file carries no package the existing
 * object's package is authoritative: resolve it from ADT repository search and
 * apply the same rule as the source-object path (`push.ts`) —
 * `$`-prefixed local packages are transport-free; everything else needs a
 * request (`--tr` > project config > the user's first modifiable request).
 *
 * Reusing the target's package also keeps the wire payload honest: the ICF
 * handlers persist `package` (TADIR / DDIF / GOX class), so a pulled file must
 * not fall back to the server-side `$TMP` default.
 */
import type { AdtClientWrapper } from '../../clients/adt-client.js';
import { resolveObject } from '../../core/resolve.js';
import { isLocalPackageName, resolveTransport } from '../../core/transport.js';

export interface ArtifactPushTransport {
  /** Package to stamp on the wire payload: the file value when present, else the target object's. */
  packageName?: string;
  /** Request to stamp on the wire payload; empty for local-package targets. */
  transport: string;
}

/**
 * Resolve the package + transport for one artifact push target.
 *
 * Explicit package in the local file wins (hand-authored / legacy files keep
 * their value). A pulled AFF file has none, so the target object's package is
 * read back with the same ADT search the source push uses. The search is an
 * enrichment step, not a gate: if the object is not discoverable (e.g. a type
 * whose search endpoint is unavailable), keep the pre-existing rule so an
 * explicit `--tr` still works and the ICF write path reports the authoritative
 * not-found error.
 *
 * Precedence for a transportable target: `--tr` > project config > the file's
 * recorded request > the user's first modifiable request.
 */
export async function resolveArtifactPushTransport(
  client: AdtClientWrapper,
  target: { objectName: string; objectType: string; filePackage?: string; fileTransport?: string },
  tr?: string,
): Promise<ArtifactPushTransport> {
  const declared = target.filePackage?.trim().toUpperCase();
  const packageName = declared !== undefined && declared !== ''
    ? declared
    : await resolveTargetPackage(client, target.objectName, target.objectType);

  let transport = '';
  if (!isLocalPackageName(packageName)) {
    transport = tr || client.getConfig().transport || target.fileTransport?.trim() || '';
    if (!transport) transport = await resolveTransport(client, tr, client.getConfig().transport);
  }
  return { packageName, transport };
}

/** Package of an existing object, from ADT repository search (best-effort). */
async function resolveTargetPackage(
  client: AdtClientWrapper,
  objectName: string,
  objectType: string,
): Promise<string | undefined> {
  try {
    const object = await resolveObject(client, objectName, objectType);
    const packageName = object.packageName?.trim();
    return packageName ? packageName.toUpperCase() : undefined;
  } catch {
    return undefined;
  }
}
