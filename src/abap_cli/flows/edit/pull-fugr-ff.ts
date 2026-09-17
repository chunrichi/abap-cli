import { CliError } from '../../output/json.js';
import { parentFunctionGroupFromUri } from '../../formats/fugr-layout.js';

interface PullResolvedObject {
  name: string;
  type: string;
  objectUrl: string;
}

/**
 * PR4 (C3): when the user pulls a FUGR/FF (a function module), the
 * `resolveObject` result points at the FM's own ADT URL. Without
 * normalization, downstream `fugrStrategy` would call `objectStructure` on
 * the FM URL and search `*<fm>*` — neither of which yields the parent
 * function group, so the pull produces an empty/broken layout.
 *
 * Rewrite the resolved object so it points at the parent function group
 * (the FUGR/F URL). The fugr pull strategy already iterates every FM in the
 * group, so rewriting the URL alone is enough to get the canonical
 * `src/<group>/<group>.<fm>.func.abap` layout that matches SAP's
 * abap-file-format convention.
 *
 * Reuses `parentFunctionGroupFromUri` from `formats/fugr-layout.ts` so the
 * URL parsing is identical to the push side and any future FF-type routing
 * only has one parser to maintain.
 */
export function normalizeFugrFunctionModule(
  object: PullResolvedObject,
  original?: PullResolvedObject,
): { object: PullResolvedObject; requestedFunctionModule?: { name: string; objectUrl: string } } {
  if (object.type.toUpperCase() !== 'FUGR/FF') return { object };

  const parent = parentFunctionGroupFromUri(object.objectUrl);
  if (!parent) {
    throw new CliError(
      'SAP_ERROR',
      `Cannot determine the parent function group for ${object.name}`,
      {
        object: object.name,
        type: object.type,
        details: { uri: object.objectUrl },
      },
    );
  }

  // Keep the original FM identity so the fugr strategy can scope its
  // output to just this FM (otherwise a pull of one FM would dump the
  // entire function group). The shape matches what fugrStrategy already
  // threads via `opts.requestedFunctionModule` — see pull-fugr.ts:150-154.
  const requestedFunctionModule = original ?? {
    name: object.name,
    objectUrl: object.objectUrl,
  };
  return {
    object: { name: parent.groupName, type: 'FUGR/F', objectUrl: parent.groupUrl },
    requestedFunctionModule,
  };
}
