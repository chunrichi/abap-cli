/**
 * Spec 036 US4: DDLS `.ddls.acds` companion file parser.
 *
 * Recognises 5 top-level CDS shapes (per spec 036 T036-031):
 *   1. `define view entity ...`              → "viewEntity"
 *   2. `define projection view ...`          → "projectionView"
 *   3. `define table function ...`           → "tableFunction"
 *   4. `define view entity ... extend [...]` → "viewEntityExtend" (with parentName)
 *   5. `define view ... extend [...]`        → "viewExtend"      (with parentName)
 *
 * Each form may include `with [parent=...]`; we capture the parent name
 * via a single regex pass over the first 200 chars of the file (CDS
 * extensions always carry their target on the same line as `extend`).
 */

const DEFINE_FALLBACK = /^\s*define\s+(table|abstract|custom|hierarchy|external)\s+(entity|view)\s+(\w+)\s*(.*)$/im;
const DEFINE_DDIC = /^\s*define\s+(view)\s+(\w+)\s+as\s+select\b/im;
const EXTEND_PARENT_RE = /extend\s+(?:view\s+(?:entity\s+)?)?\[?\s*([^\s;\]]+)/i;

/** Parse the .acds body and return both the sourceType enum + parentName (if any). */
export interface AcdsShape {
  sourceType:
    | 'viewEntity'
    | 'projectionView'
    | 'tableFunction'
    | 'viewEntityExtend'
    | 'viewExtend'
    | 'ddicBasedView'
    | 'tableEntity'
    | 'abstractEntity'
    | 'customEntity'
    | 'hierarchy'
    | 'externalEntity'
    | 'unknown';
  parentName?: string;
  objectName?: string;
}

export function parseAcds(source: string): AcdsShape {
  const leading = source.slice(0, 240);
  // Define view entity ... | Define view ... (legacy DDIC view, no entity keyword).
  const m1 = leading.match(/^\s*define\s+(view|projection\s+view|table\s+function)\s+(entity|view)?\s*(\w+)?\s*(.*)$/im);
  if (m1) {
    const kind = m1[1]!.toLowerCase().trim();
    const entityRaw = (m1[2] ?? '').toLowerCase();
    const name = m1[3] ?? '';
    const rest = m1[4] ?? '';
    const isExtend = /\bextend\b/i.test(rest);

    if (isExtend) {
      const parent = source.match(EXTEND_PARENT_RE)?.[1]?.replace(/[\s;\]]+$/, '');
      // `define view entity X extend` → viewEntityExtend; `define view X extend` (no entity) → viewExtend.
      const variant = entityRaw === 'entity' ? 'viewEntityExtend' : 'viewExtend';
      return { sourceType: variant as AcdsShape['sourceType'], ...(parent ? { parentName: parent } : {}), objectName: name };
    }
    if (kind === 'projection view' || (entityRaw === 'projection view')) {
      return { sourceType: 'projectionView', objectName: name };
    }
    if (kind === 'table function') {
      return { sourceType: 'tableFunction', objectName: name };
    }
    if (kind === 'view' && entityRaw === 'entity') {
      return { sourceType: 'viewEntity', objectName: name };
    }
    // `define view <name> as select` → DDIC-based view (legacy).
    if (kind === 'view' && /\bas\s+select\b/i.test(rest)) {
      return { sourceType: 'ddicBasedView', objectName: name };
    }
    // `define view <name>` (no further qualifier) — treat as viewEntity.
    if (kind === 'view' && name) {
      return { sourceType: 'viewEntity', objectName: name };
    }
  }
  // Fallback shapes (table entity, abstract entity, etc.)
  const m2 = leading.match(DEFINE_FALLBACK);
  if (m2) {
    const kind = m2[1]!.toLowerCase();
    const entity = m2[2]!.toLowerCase();
    const variant = `${kind}${entity}` as AcdsShape['sourceType'];
    return { sourceType: variant, objectName: m2[3] };
  }
  // Legacy DDIC view: `define view <name> as select from ...`
  const m3 = leading.match(DEFINE_DDIC);
  if (m3) {
    return { sourceType: 'ddicBasedView', objectName: m3[2] };
  }
  return { sourceType: 'unknown' };
}

/** Best-effort sourceType detection for the wire-body case (XML without a top-level DDL match). */
export function detectSourceTypeFromDdl(xml: string): AcdsShape['sourceType'] {
  return parseAcds(xml).sourceType;
}