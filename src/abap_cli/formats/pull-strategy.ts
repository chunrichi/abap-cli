import type { AdtClientWrapper } from '../clients/adt-client.js';
import { CliError } from '../output/json.js';
import type { ServiceBinding } from 'abap-adt-api/build/api/tablecontents.js';
import { getObjectPartsWithMeta, type ObjectMetadata } from './object-parts.js';
import { buildFilename, sourceExtensionForObjectType } from './file-resolver.js';
import { renderObjectMetadataJson } from './object-metadata.js';
import { fugrStrategy } from './pull-fugr.js';
import { assertAffMetadata } from '../aff/assert-metadata.js';
import { enumOrDefault, DDLS_SOURCE_ORIGINS, DDLS_SOURCE_TYPES } from './ddls/json.js';

/** A file to write for an object; content is lazy to avoid fetching unused parts. */
export interface OutputFile {
  filename: string;
  content: () => Promise<string>;
}

export interface PullContext {
  client: AdtClientWrapper;
  object: { name: string; type: string; objectUrl: string };
  opts: { includeTests?: boolean; includeAllParts?: boolean };
}

/**
 * Per-object pull strategy: turns one SAP object into the local files that
 * abap-file-format expects for its type.
 *
 * To add a new object type (e.g. FUGR):
 *   1. Implement a strategy returning OutputFile[] — filenames follow
 *      abap-file-format, content is fetched lazily so unused parts are skipped.
 *   2. Register it in strategyFor() below (FUGR needs a multi-file layout:
 *      sapl<name>.reps.*, l<name>top.reps.*, one .func.* per function module).
 *   3. The shared write/conflict handling in pullObject() applies unchanged.
 */
export interface PullStrategy {
  /** Generate the files (metadata + source parts) for one object. */
  files(ctx: PullContext): Promise<OutputFile[]>;
}

/**
 * CLAS / PROG / INTF / DDLS / SRVD / BDEF / DCLS / DDLX / DDLA share the
 * objectStructure + source-parts layout: one <name>.<type>.json metadata
 * file plus one source per include part.
 *
 * 032 US13: PROG/I (include program) sub-route. The single source part on
 * a PROG/I is a top-level include (no `main`), so its subtype is renamed
 * `main → include` to land at `<name>.prog.include.abap` (abap-file-format
 * PROG subtype). The `metadata.programType` (`'I'` raw / `'include'` enum)
 * already maps to `generalInformation.programType: 'include'` via
 * `renderObjectMetadataJson` — that's the JSON marker for INCLUDE.
 *
 * T3.1 / T3.3 / T3.4: source-bearing types use a non-`.abap` extension
 * (DDLS / DCLS / DDLX / DDLA / SRVD → `.acds`, BDEF → `.abdl`). The
 * extension is looked up via `sourceExtensionForObjectType(object.type)`
 * rather than hard-coded.
 *
 * The metadata payload is rendered through `renderSourceMetadata` so
 * per-type schemas (DDLS sourceType, SRVD generalInformation) get their
 * project-specific shape before the AFF validator sees them.
 */
function sourceObjectStrategy(): PullStrategy {
  return {
    async files({ client, object, opts }) {
      const { parts: allParts, metadata } = await getObjectPartsWithMeta(client, object);
      const parts = opts.includeAllParts
        ? allParts
        : allParts.filter((p) => (opts.includeTests ? true : p.subtype !== 'testclasses'));
      // 032 US13: PROG/I — remap `main` subtype to `include` so the file
      // lands at `<name>.prog.include.abap`. Object-detection reuses the
      // primary-type split from `object.type` (PROG/I splits to PROG).
      const isProgInclude = object.type.split('/')[0]!.toUpperCase() === 'PROG'
        && (metadata.programType === 'I'
          || object.type.toUpperCase().endsWith('/I'));
      const remapped = isProgInclude
        ? parts.map((p) => ({ ...p, subtype: p.subtype === 'main' ? 'include' : p.subtype }))
        : parts;
      const primary = object.type.split('/')[0]!.toUpperCase();
      const sourceExt = sourceExtensionForObjectType(object.type);
      return [
        {
          filename: buildFilename(object.name, object.type, undefined, '.json'),
          content: async () => {
            // Phase 3: route metadata through `renderSourceMetadata` so
            // SRVD nests sourceOrigin/sourceType under generalInformation
            // (per srvd-v1.json) instead of leaking them as top-level keys.
            const enriched = renderSourceMetadata(primary, metadata, object.type);
            const content = JSON.stringify(enriched, null, 2) + '\n';
            assertAffMetadata(primary, JSON.parse(content));
            return content;
          },
        },
        ...remapped.map((p) => ({
          filename: buildFilename(object.name, object.type, p.subtype, sourceExt),
          content: async () => client.getObjectSource(p.sourceUrl),
        })),
      ];
    },
  };
}

/**
 * T3.2: pull strategy for objects that have no source code (SRVB).
 * Issues one objectStructure call to get header metadata, then a
 * second call (`client.serviceBinding`) to fetch the binding payload
 * (services / binding type / category / version) that is *not* in
 * objectStructure's `metaData`. Writes a single `<name>.srvb.json`
 * that matches `srvb-v1.json`.
 */
function metadataOnlyStrategy(): PullStrategy {
  return {
    async files({ client, object }) {
      const structure = await client.objectStructure(object.objectUrl);
      const structureMeta = (structure as unknown as { metaData?: Record<string, unknown> }).metaData ?? {};
      const binding = await client.serviceBinding(object.objectUrl);
      return [{
        filename: buildFilename(object.name, object.type, undefined, '.json'),
        content: async () => {
          const content = JSON.stringify(renderServiceBindingMetadata(binding, structureMeta), null, 2) + '\n';
          assertAffMetadata('SRVB', JSON.parse(content));
          return content;
        },
      }];
    },
  };
}

const SOURCE_OBJECT_TYPES = new Set([
  'CLAS', 'PROG', 'INTF',
  // T3.1 / T3.3 / T3.4: CDS-source-bearing types (acds) + BDEF (.abdl).
  'DDLS', 'DCLS', 'DDLX', 'DDLA', 'BDEF', 'SRVD',
]);
const METADATA_ONLY_OBJECT_TYPES = new Set([
  // T3.2: service bindings are managed in SAP GUI, not pushed via CLI.
  'SRVB',
]);

/**
 * Pick the pull strategy for an object type.
 * Types sharing the objectStructure + source-parts layout stay in
 * sourceObjectStrategy(); metadata-only types (e.g. SRVB) go through
 * metadataOnlyStrategy(); multi-file layouts (FUGR) get their own
 * strategy. Unknown types throw `TYPE_NOT_SUPPORTED`.
 */
export function strategyFor(type: string): PullStrategy {
  const primary = type.split('/')[0]!.toUpperCase();
  if (SOURCE_OBJECT_TYPES.has(primary)) return sourceObjectStrategy();
  if (METADATA_ONLY_OBJECT_TYPES.has(primary)) return metadataOnlyStrategy();
  if (primary === 'FUGR') return fugrStrategy();
  throw new CliError('TYPE_NOT_SUPPORTED', `Pull not supported for object type ${primary}`, { type: primary });
}

// ---------------------------------------------------------------------------
// Per-type metadata rendering
// ---------------------------------------------------------------------------

/**
 * SRVD source-origin enum (10 values per srvd-v1.json). The set is the same
 * as the DDLS source-origin set; we still declare an independent Set here so
 * future divergence (e.g. SRVD adds or drops a value) does not silently
 * affect the DDLS renderer.
 */
const SRVD_SOURCE_ORIGINS: ReadonlySet<string> = new Set([
  'abapDevelopmentTools',
  'customCdsViews',
  'customAnalyticalQueries',
  'customBusinessObject',
  'customCodeList',
  'customCdsViewsVariantConfg',
  'customFields',
  'extensionsForDataSources',
  'customSearchModeler',
  'serviceConsumptionModel',
]);

/** SRVD source-type enum (2 values per srvd-v1.json). */
const SRVD_SOURCE_TYPES: ReadonlySet<string> = new Set(['definition', 'extension']);

/**
 * Render metadata for source-bearing object types. CLAS / PROG / INTF
 * fall through to `renderObjectMetadataJson` (which already handles
 * their branched shapes). DDLS and SRVD get extra enrichment:
 *   - DDLS: top-level `sourceOrigin` + `sourceType` (per ddls-v1.json)
 *   - SRVD: nested `generalInformation.sourceOrigin` + `sourceType`
 *           (per srvd-v1.json — the SRVD shape puts these under
 *           `generalInformation`, not at the top level)
 */
export function renderSourceMetadata(
  primaryType: string,
  metadata: ObjectMetadata,
  fullType: string,
): Record<string, unknown> {
  const result = JSON.parse(
    renderObjectMetadataJson({ ...metadata, objectType: metadata.objectType ?? fullType }),
  ) as Record<string, unknown>;
  if (primaryType === 'DDLS') {
    result.sourceOrigin = enumOrDefault(metadata.sourceOrigin, DDLS_SOURCE_ORIGINS, 'abapDevelopmentTools');
    result.sourceType = enumOrDefault(metadata.sourceType, DDLS_SOURCE_TYPES, 'unknown');
  } else if (primaryType === 'SRVD') {
    result.generalInformation = {
      sourceOrigin: enumOrDefault(metadata.sourceOrigin, SRVD_SOURCE_ORIGINS, 'abapDevelopmentTools'),
      sourceType: enumOrDefault(metadata.sourceType, SRVD_SOURCE_TYPES, 'definition'),
    };
  }
  return result;
}

/**
 * T3.2: project the abap-adt-api `ServiceBinding` payload into the
 * AFF `<name>.srvb.json` shape (matches srvb-v1.json):
 *   - `bindingType` / `bindingTypeCategory` / `services[]`
 *   - `formatVersion` + `header` (description / originalLanguage)
 *
 * Numeric-string `category` is decoded to the enum:
 *   - 0 → 'ui'      (SAP UI5 / Fiori)
 *   - 1 → 'webApi'  (OData web API)
 * Zero-padded numeric-string `version` (e.g. "0001") is preserved
 * verbatim — SAP already encodes the leading zeros on the wire and
 * the AFF schema only requires the field to be a string ≤24 chars.
 */
export function renderServiceBindingMetadata(
  binding: ServiceBinding,
  structureMeta: Record<string, unknown>,
): Record<string, unknown> {
  // `ServiceBindingBinding.category` is declared `number` in
  // abap-adt-api/build/api/tablecontents.d.ts. The translation to the
  // AFF enum is direct: 0 → 'ui', 1 → 'webApi', anything else → unknown
  // (caller throws).
  const categoryValue = binding.binding?.category;
  const category = categoryValue === 0 ? 'ui' : categoryValue === 1 ? 'webApi' : undefined;
  const bindingType = [binding.binding?.type, binding.binding?.version].filter(Boolean).join(' ');
  const services = new Map<string, Array<Record<string, string>>>();
  for (const service of binding.services ?? []) {
    const name = service.name?.trim();
    const serviceDefinition = service.serviceDefinition?.name?.trim();
    if (!name || !serviceDefinition) {
      throw new CliError('SAP_ERROR', `Service binding ${binding.name} contains an incomplete service entry`, {
        object: binding.name,
        nextSteps: ['Inspect the service binding response and ensure each service has a name and service definition.'],
      });
    }
    // `ServiceBindingService.version` is declared `number` in
    // abap-adt-api, but real-SAP wire payloads sometimes emit it as a
    // zero-padded numeric string (e.g. "0001") — accept either form.
    const rawVersion: unknown = service.version;
    const serviceVersion = typeof rawVersion === 'number' && Number.isFinite(rawVersion)
      ? String(rawVersion)
      : typeof rawVersion === 'string' && /^\d+$/.test(rawVersion.trim())
        ? rawVersion.trim()
        : undefined;
    if (!serviceVersion) {
      throw new CliError('SAP_ERROR', `Service binding ${binding.name} contains an invalid service version`, {
        object: binding.name,
        nextSteps: ['Inspect the service binding response and ensure each service has a numeric version.'],
      });
    }
    const versions = services.get(name) ?? [];
    versions.push({ serviceVersion, serviceDefinition });
    services.set(name, versions);
  }
  if (!bindingType || !category || services.size === 0) {
    throw new CliError('SAP_ERROR', `Service binding ${binding.name} did not return complete binding metadata`, {
      object: binding.name,
      nextSteps: ['Use a SAP release that exposes service binding details through the ADT endpoint.'],
    });
  }
  return {
    formatVersion: '1',
    header: {
      description: binding.description || stringMeta(structureMeta, 'adtcore:description') || '',
      originalLanguage: (binding.masterLanguage || stringMeta(structureMeta, 'adtcore:masterLanguage') || 'EN').toLowerCase(),
    },
    bindingType,
    bindingTypeCategory: category,
    services: [...services.entries()].map(([name, versions]) => ({ name, versions })),
  };
}

function stringMeta(meta: Record<string, unknown>, key: string): string | undefined {
  const value = meta[key];
  return typeof value === 'string' ? value : undefined;
}
