import { resolveFile } from '../../formats/file-resolver.js';
import { isTablArtifactFile } from '../../formats/ddic/tabl-artifact.js';

// Push priority per object type. Numbers encode DDIC → sources → HTTP so
// prerequisites push before the objects that reference them.
// (DOMA → DTEL → TABL → ... → HTTP); a new type without an entry sorts
// last (100). Update CHANGELOG / wiki if this order ever drifts.
const OBJECT_PUSH_ORDER: Record<string, number> = {
  DOMA: 10,
  DTEL: 20,
  TABL: 30,
  STRU: 30,
  ENQU: 40,
  MSAG: 45,
  NROB: 45,
  INTF: 50,
  CLAS: 60,
  FUGR: 70,
  PROG: 80,
  HTTP: 90,
};

function getObjectPushPriority(file: string): number {
  try {
    if (isTablArtifactFile(file)) return 30;
    const resolved = resolveFile(file);
    return OBJECT_PUSH_ORDER[resolved.objectType] ?? 100;
  } catch {
    return 100;
  }
}

/**
 * Sort push targets by SAP object dependency order (DOMA → DTEL → TABL →
 * ... → HTTP). Files of the same priority keep their original relative
 * order (stable sort). Unresolvable files sink to priority 100 — they
 * still push, just after the known-good ones.
 */
export function orderTargetsByDependency(files: string[]): string[] {
  return [...files].sort((a, b) => getObjectPushPriority(a) - getObjectPushPriority(b));
}
