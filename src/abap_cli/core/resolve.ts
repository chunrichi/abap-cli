import type { AdtClientWrapper } from '../clients/adt-client.js';
import { CliError } from '../output/json.js';
import { getObjectPartsWithMeta, type ObjectPart } from '../formats/object-parts.js';
import { SEARCH_RESULT_LIMIT } from './limits.js';

export interface ResolvedObject {
  name: string;
  type: string;
  objectUrl: string;
  /** Package from the search hit — used to detect $TMP (transport-free) objects. */
  packageName?: string;
  parts: ObjectPart[];
}

/**
 * Locate an object by name (optionally filtered by type) and normalize its name.
 * Throws OBJECT_NOT_FOUND / AMBIGUOUS_OBJECT.
 *
 * Real-ADT quirk: the quickSearch endpoint requires `*` wildcards — a bare
 * exact name returns zero hits (verified against vhcala4hci 2026-08-04). We
 * retry with `*NAME*` when the exact-name search finds nothing, then filter
 * for the exact match (mock's substring matching stays compatible).
 */
export async function resolveObject(
  client: AdtClientWrapper,
  name: string,
  type?: string,
): Promise<ResolvedObject> {
  const normalized = name.trim().toUpperCase();
  let results = await client.searchObject(normalized, type, SEARCH_RESULT_LIMIT);
  if (results.length === 0) {
    // Real ADT needs wildcards; fall back to *NAME* so exact objects resolve.
    results = await client.searchObject(`*${normalized}*`, type, SEARCH_RESULT_LIMIT);
  }
  const matches = results.filter((r) => r['adtcore:name'] === normalized);
  if (matches.length === 0) {
    throw new CliError('OBJECT_NOT_FOUND', `Object ${normalized} not found in system`, {
      details: { object: normalized },
      nextSteps: ["Verify the name: 'abap search <query>'.", "Confirm the active system: 'abap profile test <name>'."],
      example: `abap search ${normalized}`,
    });
  }
  if (matches.length > 1 && !type) {
    throw new CliError('AMBIGUOUS_OBJECT', `Object ${normalized} matches multiple types; specify --type`, {
      object: normalized,
      types: matches.map((m) => m['adtcore:type']),
    });
  }
  // matches.length > 0 guaranteed by the checks above
  const hit = matches[0]!;
  return { name: hit['adtcore:name'], type: hit['adtcore:type'], objectUrl: hit['adtcore:uri'], packageName: hit['adtcore:packageName'], parts: [] };
}

/** Fetch all source parts (class includes or the single main part) of an object. */
export async function getObjectParts(
  client: AdtClientWrapper,
  object: { name: string; objectUrl: string },
  retries = 0,
  delayMs = 400,
): Promise<ObjectPart[]> {
  const result = await getObjectPartsWithMeta(client, object, retries, delayMs);
  return result.parts;
}

/** 014: DDIC types the CLI can create/pull via the ICF service.
 *  036-ttyp-msag-ddls: TTYP/MSAG reach ICF only via the channel-detect
 *  fallback (not via this set — they default to ADT). Keep this set
 *  exclusively the four "ICF-only" DDIC types. */
const DDIC_ICF_SUPPORTED = new Set(['DOMA', 'DTEL', 'TABL', 'STRU']);

/** 036-ttyp-msag-ddls: types routed through channel-detect.
 *  These types prefer ADT but allow ICF fallback when the system profile
 *  reports an ECC release. Distinct from `DDIC_ICF_SUPPORTED` (which is
 *  ICF-only) — `ADT_ROUTED_TYPES` is "ICF optional". */
const ADT_ROUTED_TYPES = new Set(['TTYP', 'MSAG', 'DDLS']);

/** 022: object types the CLI can create/pull/push via the self-built ICF service. */
const ICF_ROUTED_TYPES = new Set<string>([...DDIC_ICF_SUPPORTED, 'HTTP', 'TRAN']);

/** 037 US3: union of all types the push validator should let through.
 *  Derived from `types/registry.ts` (the single source of truth) — every
 *  registered type, regardless of source. ADT-routed types (TTYP/MSAG/DDLS)
 *  reach the SAP via channel-detect rather than the legacy /ddic/<type>
 *  ICF route, but they are still valid push targets from the perspective
 *  of `validateLocalFile`. */
import { allSupportedTypes, sourceFor } from '../types/registry.js';
const VALIDATED_ROUTE_TYPES = new Set<string>(
  allSupportedTypes().filter((t) => sourceFor(t) !== undefined),
);

/**
 * 014/022: validate a local file before push. Source files are passed through;
 * DDIC files for the four supported types (DOMA/DTEL/TABL/STRU), HTTP service
 * (.http.json), and Transaction code (.tran.json) are allowed through to the
 * matching ICF endpoint. TTYP/MSAG/DDLS share the .json extension but route
 * through channel-detect in `pushChannelRoutedFile`, so they are also accepted
 * here. Unknown DDIC-looking types still raise DDIC_NOT_SUPPORTED.
 */
export function validateLocalFile(resolved: { objectName: string; objectType: string; route: string }): void {
  if (resolved.route === 'icf') {
    if (!VALIDATED_ROUTE_TYPES.has(resolved.objectType)) {
      throw new CliError(
        'DDIC_NOT_SUPPORTED',
        `Object ${resolved.objectName} (${resolved.objectType}) is a DDIC object; not supported in this phase`,
        { object: resolved.objectName, type: resolved.objectType },
      );
    }
    // Supported route — allowed through (handler picks the endpoint).
  }
}
