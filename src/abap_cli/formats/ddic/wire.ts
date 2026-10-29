/**
 * DDIC local ↔ wire mapping: field-shape conversion plus the per-type
 * `localToWire` / `wireToLocal` pair.
 */
import { CliError } from '../../output/json.js';
import type {
  DdicDomaWire,
  DdicDtelWire,
  DdicFieldLocal,
  DdicFieldWire,
  DdicObject,
  DdicSupportedType,
  DdicTableSettingsWire,
  DdicWirePayload,
  DomaFixedValueLocal,
  DdomaFixedValueWire,
  WireForDdicType,
} from './types.js';

/** 024: extract the canonical three-piece strings from a wire payload. */
export function extractTablArtifactWire(wire: DdicWirePayload): {
  mainJson: string;
  ddicSource: string;
  settingsJson: string | undefined;
  hasSettings: boolean;
} | undefined {
  // T2.1: TABL/STRU three-piece payload lives on the TABL-settings wire
  // variant. Narrow via unknown before reading to keep the union type safe.
  const w = wire as unknown as Partial<DdicTableSettingsWire> & Record<string, unknown>;
  if (typeof w.mainJson !== 'string' || typeof w.ddicSource !== 'string') return undefined;
  return {
    mainJson: w.mainJson,
    ddicSource: w.ddicSource,
    settingsJson: typeof w.settingsJson === 'string' ? w.settingsJson : undefined,
    hasSettings: w.hasSettings === true,
  };
}
/** Names that mean "the client (MANDT) key column" in TABL field lists.
 * The wire format never carries MANDT — the server prepends it when
 * `clientDependent: true` (see zcl_abap_vibe_icf.create_ddic_table). We strip
 * both `CLIENT` (abap-file-format DDL alias) and `MANDT` (legacy name) from
 * the wire payload to keep the two create paths in lockstep.
 *
 * Kept in sync with `tabl-artifact.ts:57` which applies the same filter on
 * the abap-file-format three-piece path.
 */
export const CLIENT_FIELD_NAMES = new Set(['CLIENT', 'MANDT']);
export function isClientFieldName(name: unknown): boolean {
  return typeof name === 'string' && CLIENT_FIELD_NAMES.has(name.toUpperCase());
}
/** Filter out client field entries from a local field list. Pure function. */
export function stripClientFields(fields: DdicFieldLocal[] | undefined): DdicFieldLocal[] {
  if (!Array.isArray(fields)) return [];
  return fields.filter((f) => !isClientFieldName(f.fieldName));
}

/** 014: map abap-file-format field (snake_case, mixed numeric) to wire (camelCase, number). */
export function localFieldToWire(local: DdicFieldLocal): DdicFieldWire {
  const wire: DdicFieldWire = { fieldName: local.fieldName };
  if (local.rollname !== undefined) wire.rollname = local.rollname;
  if (local.dataType !== undefined) wire.dataType = local.dataType;
  if (local.length !== undefined) wire.length = Number(local.length);
  if (local.decimals !== undefined) wire.decimals = Number(local.decimals);
  if (local.keyFlag !== undefined) wire.keyFlag = !!local.keyFlag;
  if (local.notNull !== undefined) wire.notNull = !!local.notNull;
  if (local.ddtext !== undefined) wire.ddtext = local.ddtext;
  if (local.refTable !== undefined) wire.refTable = local.refTable;
  if (local.refField !== undefined) wire.refField = local.refField;
  if (local.checkTable !== undefined) wire.checkTable = local.checkTable;
  if (local.precField !== undefined) wire.precField = local.precField;
  return wire;
}

/** 014: map wire field back to abap-file-format. Used for round-trip assertion. */
export function wireFieldToLocal(wire: DdicFieldWire): DdicFieldLocal {
  const local: DdicFieldLocal = { fieldName: wire.fieldName };
  if (wire.rollname !== undefined) local.rollname = wire.rollname;
  if (wire.dataType !== undefined) local.dataType = wire.dataType;
  if (wire.length !== undefined) local.length = wire.length;
  if (wire.decimals !== undefined) local.decimals = wire.decimals;
  if (wire.keyFlag !== undefined) local.keyFlag = wire.keyFlag;
  if (wire.notNull !== undefined) local.notNull = wire.notNull;
  if (wire.ddtext !== undefined) local.ddtext = wire.ddtext;
  if (wire.refTable !== undefined) local.refTable = wire.refTable;
  if (wire.refField !== undefined) local.refField = wire.refField;
  if (wire.checkTable !== undefined) local.checkTable = wire.checkTable;
  if (wire.precField !== undefined) local.precField = wire.precField;
  return local;
}

/**
 * T2.1: convert a local abap-file-format nested DDIC object to the ICF
 * wire payload. Wire equals the AFF nested shape (no flat fallback).
 * DOMA under `format.*`, DTEL under `dataTypeInformation.*`,
 * TABL/STRU as three-piece (DDL + settings + json).
 *
 * Generic over the type so the return narrows to the matching wire
 * interface (DdicDomaWire / DdicDtelWire / DdicTableSettingsWire).
 */
export function localToWire<T extends DdicSupportedType>(type: T, local: DdicObject): WireForDdicType<T> {
  const l = local as Record<string, unknown>;
  const headerObj = (l.header && typeof l.header === 'object') ? (l.header as Record<string, unknown>) : undefined;
  const description = (headerObj?.description as string | undefined) ?? (l.description as string | undefined);
  const wire: DdicWirePayload = {
    name: String(local.name).toUpperCase(),
    description,
    package: l.package as string | undefined,
    transportRequest: l.transportRequest as string | undefined,
  };
  // AFF canonical — every DDIC object carries `header.{description,
  // originalLanguage, abapLanguageVersion?}`. Forward the nested header
  // when present so wire ↔ local stays lossless.
  if (l.header !== undefined && typeof l.header === 'object') {
    wire.header = l.header as DdicWirePayload['header'];
  }
  switch (type) {
    case 'DOMA': {
      // Wire must mirror AFF: dataType/length/decimals/signFlag/lowercase/convExit
      // all under `format.*`. `outputCharacteristics` and `fixedValues` live at
      // the top level of the local document; the wire carries them too.
      const srcFormat = l.format as Record<string, unknown> | undefined;
      const nested: Record<string, unknown> = {};
      if (srcFormat) {
        if (srcFormat.dataType !== undefined) nested.dataType = srcFormat.dataType;
        if (srcFormat.length !== undefined) nested.length = srcFormat.length;
        if (srcFormat.decimals !== undefined) nested.decimals = srcFormat.decimals;
        if (srcFormat.signFlag !== undefined) nested.signFlag = String(srcFormat.signFlag);
        if (srcFormat.lowercase !== undefined) nested.lowercase = String(srcFormat.lowercase);
        if (srcFormat.convExit !== undefined) nested.convExit = String(srcFormat.convExit);
      }
      if (Object.keys(nested).length > 0) (wire as DdicDomaWire).format = nested as DdicDomaWire['format'];
      // outputCharacteristics is at top level on both local and wire (AFF shape).
      const oc = l.outputCharacteristics as Record<string, unknown> | undefined;
      if (oc) (wire as DdicDomaWire).outputCharacteristics = { ...oc } as DdicDomaWire['outputCharacteristics'];
      // fixedValues: prefer top-level (AFF canonical). Empty array ⇒ omit wire.
      const rawFixed =
        (Array.isArray(l.fixedValues) ? (l.fixedValues as unknown[]) : undefined) ??
        (srcFormat && Array.isArray(srcFormat.fixedValues) ? (srcFormat.fixedValues as unknown[]) : undefined);
      if (Array.isArray(rawFixed) && rawFixed.length > 0) {
        (wire as DdicDomaWire).fixedValues = rawFixed.map((raw) => {
          const r = raw as Record<string, unknown>;
          const out: DdomaFixedValueWire = { fixedValue: String(r.fixedValue ?? '') };
          const descRaw = r.description;
          if (typeof descRaw === 'string') {
            // AFF canonical: plain string description.
            out.description = descRaw;
            return out;
          }
          if (descRaw && typeof descRaw === 'object') {
            const longRaw = descRaw as Record<string, unknown>;
            const li = longRaw.languageIndependent as string | undefined;
            const ldRaw = Array.isArray(longRaw.languageDependent)
              ? (longRaw.languageDependent as Array<Record<string, unknown>>)
              : undefined;
            const long: {
              languageIndependent?: string;
              languageDependent?: Array<{ language: string; description: string }>;
            } = {};
            if (li !== undefined) long.languageIndependent = li;
            if (ldRaw && ldRaw.length > 0) {
              long.languageDependent = ldRaw.map((d) => ({
                language: String(d.language ?? ''),
                description: String(d.description ?? ''),
              }));
            }
            if (long.languageIndependent !== undefined || long.languageDependent !== undefined) {
              out.fixedValueLong = long;
            }
          }
          return out;
        });
      }
      break;
    }
    case 'DTEL': {
      // Wire carries `dataTypeInformation.{category,...}` per AFF dtel-v1.json.
      // Five categories are accepted; `predefinedType` category nests its
      // type info under `predefinedType.{dataType,length,decimals}`. Legacy
      // 032 alias `typeRef` is mapped to `referenceDictionaryType` (TTYP /
      // dictionary reference) on the way out so existing callers keep working.
      const dti = l.dataTypeInformation as Record<string, unknown> | undefined;
      if (dti && typeof dti === 'object') {
        const rawCat = String(dti.category ?? '');
        const aliasedCat = rawCat === 'typeRef' ? 'referenceDictionaryType' : rawCat;
        const wireDti: Record<string, unknown> = { category: aliasedCat };
        if (dti.typeName !== undefined) wireDti.typeName = String(dti.typeName);
        if (dti.referencedTypeName !== undefined) {
          wireDti.referencedTypeName = String(dti.referencedTypeName);
        }
        const ptRaw = dti.predefinedType;
        if (ptRaw && typeof ptRaw === 'object') {
          const pt = ptRaw as Record<string, unknown>;
          wireDti.predefinedType = {
            dataType: String(pt.dataType ?? ''),
            ...(pt.length !== undefined ? { length: Number(pt.length) } : {}),
            ...(pt.decimals !== undefined ? { decimals: Number(pt.decimals) } : {}),
          };
        }
        (wire as DdicDtelWire).dataTypeInformation = wireDti as DdicDtelWire['dataTypeInformation'];
      }
      const w = wire as DdicDtelWire;
      w.shortText = l.shortText as string | undefined;
      w.mediumText = l.mediumText as string | undefined;
      w.longText = l.longText as string | undefined;
      w.headerText = l.headerText as string | undefined;
      break;
    }
    case 'TABL':
    case 'STRU': {
      // Wire carries the three-piece payload; the merge/split happens in
      // tabl-artifact.ts and in the ICF handler. Here we forward the
      // server-required transport envelope + fields-list. The DDL source
      // and settings.json remain external artifact files. Top-level
      // `header` and `generalInformation` are forwarded when present so the
      // ICF handler can persist deliveryClass / dataClass / sizeCategory.
      const w = wire as DdicTableSettingsWire;
      if (Array.isArray(l.fields)) {
        const original = l.fields as DdicFieldLocal[];
        const stripped = stripClientFields(original);
        const dropped = original
          .filter((f) => isClientFieldName(f.fieldName))
          .map((f) => String(f.fieldName).toUpperCase());
        if (dropped.length > 0) {
          const ws = (w.warnings ?? (w.warnings = []));
          ws.push({
            code: 'CLIENT_FIELD_STRIPPED',
            message: `dropped ${dropped.join(', ')} from fields[] — the server prepends MANDT when clientDependent: true`,
          });
        }
        w.fields = stripped.map(localFieldToWire);
      }
      // Forward abap-file-format nested header + generalInformation.
      if (l.header !== undefined) w.header = l.header as DdicTableSettingsWire['header'];
      if (l.generalInformation !== undefined) {
        w.generalInformation = l.generalInformation as DdicTableSettingsWire['generalInformation'];
      }
      break;
    }
  }
  return wire as WireForDdicType<T>;
}

/** 033 US12: convert wire payload back to local abap-file-format shape.
 *  Wire is now nested AFF; local mirrors it.
 *
 *  T2.1: generic over the type so callers get a typed `wire` argument
 *  (DdicDomaWire | DdicDtelWire | DdicTableSettingsWire).
 */
export function wireToLocal<T extends DdicSupportedType>(type: T, wire: WireForDdicType<T>): DdicObject {
  const wAny = wire as unknown as Record<string, unknown>;
  const local: DdicObject = { name: String(wAny.name ?? '') };
  if (wAny.description !== undefined) local.description = wAny.description as string;
  if (wAny.package !== undefined) (local as Record<string, unknown>).package = wAny.package;
  if (wAny.transportRequest !== undefined) (local as Record<string, unknown>).transportRequest = wAny.transportRequest;
  // Forward nested header / generalInformation if the wire carried them.
  if (wAny.header !== undefined) (local as Record<string, unknown>).header = wAny.header;
  if (wAny.generalInformation !== undefined) {
    (local as Record<string, unknown>).generalInformation = wAny.generalInformation;
  }
  switch (type) {
    case 'DOMA': {
      const l = local as Record<string, unknown>;
      const w = wire as DdicDomaWire;
      if (w.format) {
        const nested: Record<string, unknown> = {};
        if (w.format.dataType !== undefined) nested.dataType = w.format.dataType;
        if (w.format.length !== undefined) nested.length = w.format.length;
        if (w.format.decimals !== undefined) nested.decimals = w.format.decimals;
        if (w.format.signFlag !== undefined) nested.signFlag = String(w.format.signFlag);
        if (w.format.lowercase !== undefined) nested.lowercase = String(w.format.lowercase);
        if (w.format.convExit !== undefined) nested.convExit = String(w.format.convExit);
        if (Object.keys(nested).length > 0) l.format = nested;
      }
      if (w.outputCharacteristics) l.outputCharacteristics = { ...w.outputCharacteristics };
      if (w.fixedValues !== undefined && w.fixedValues.length > 0) {
        const fixedValuesLocal: DomaFixedValueLocal[] = w.fixedValues.map((fv) => {
          const out: DomaFixedValueLocal = { fixedValue: fv.fixedValue };
          if (typeof fv.description === 'string') {
            out.description = fv.description;
            return out;
          }
          const li = fv.fixedValueLong?.languageIndependent;
          const ld = fv.fixedValueLong?.languageDependent;
          if (li !== undefined || (ld !== undefined && ld.length > 0)) {
            out.description = {};
            if (li !== undefined) out.description.languageIndependent = li;
            if (ld !== undefined && ld.length > 0) out.description.languageDependent = ld;
          }
          return out;
        });
        l.fixedValues = fixedValuesLocal;
      }
      break;
    }
    case 'DTEL': {
      const l = local as Record<string, unknown>;
      const w = wire as DdicDtelWire;
      if (w.dataTypeInformation && typeof w.dataTypeInformation === 'object') {
        const cat = w.dataTypeInformation.category;
        // Legacy 032 alias `typeRef` is mapped back to itself on read so
        // 032 callers that wrote `typeRef` get the same shape back.
        const allowed = [
          'domain',
          'predefinedType',
          'referenceToPredefinedType',
          'referenceDictionaryType',
          'referenceClasIntType',
          'typeRef', // 032 legacy alias
        ] as const;
        if (!(allowed as readonly string[]).includes(cat)) {
          throw new CliError(
            'DTEL_CATEGORY_UNSUPPORTED',
            `Unsupported DTEL dataTypeInformation.category: "${String(cat)}" (expected one of ${allowed.join(', ')})`,
            { details: { category: String(cat), dataTypeInformation: w.dataTypeInformation } },
          );
        }
        l.dataTypeInformation = { ...w.dataTypeInformation };
      }
      if (w.shortText !== undefined) local.shortText = w.shortText;
      if (w.mediumText !== undefined) local.mediumText = w.mediumText;
      if (w.longText !== undefined) local.longText = w.longText;
      if (w.headerText !== undefined) local.headerText = w.headerText;
      break;
    }
    case 'TABL':
    case 'STRU': {
      const w = wire as DdicTableSettingsWire;
      if (w.fields !== undefined) local.fields = w.fields.map(wireFieldToLocal);
      break;
    }
  }
  return local;
}
