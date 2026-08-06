import type { AdtClientWrapper } from '../clients/adt-client.js';
import { CliError } from '../output/json.js';
import { getObjectPartsWithMeta, type ObjectPart } from '../formats/object-parts.js';
import { SEARCH_RESULT_LIMIT } from './limits.js';

export interface ResolvedObject {
  name: string;
  type: string;
  objectUrl: string;
  parts: ObjectPart[];
}

/**
 * Locate an object by name (optionally filtered by type) and normalize its name.
 * Throws OBJECT_NOT_FOUND / AMBIGUOUS_OBJECT per contracts/cli-commands.md.
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
      nextSteps: ["Verify the name: 'abap search <query>'.", "Confirm the active system: 'abap connection test <name>'."],
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
  return { name: hit['adtcore:name'], type: hit['adtcore:type'], objectUrl: hit['adtcore:uri'], parts: [] };
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
 *  Q2 scope: keep TTYP rejected (deferred to a later phase). */
const DDIC_ICF_SUPPORTED = new Set(['DOMA', 'DTEL', 'TABL', 'STRU']);

/**
 * 014: validate a local file before push. Source files are passed through;
 * DDIC files for the four supported types (DOMA/DTEL/TABL/STRU) are allowed
 * through to the ICF POST /ddic/<type> endpoint. Unknown DDIC types
 * (notably TTYP) still raise DDIC_NOT_SUPPORTED.
 */
export function validateLocalFile(resolved: { objectName: string; objectType: string; route: string }): void {
  if (resolved.route === 'icf') {
    if (!DDIC_ICF_SUPPORTED.has(resolved.objectType)) {
      throw new CliError(
        'DDIC_NOT_SUPPORTED',
        `Object ${resolved.objectName} (${resolved.objectType}) is a DDIC object; not supported in this phase`,
        { object: resolved.objectName, type: resolved.objectType },
      );
    }
    // Supported DDIC type — allowed through (ICF route handles the rest).
  }
}
