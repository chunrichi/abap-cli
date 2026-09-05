import type { AdtClientWrapper } from '../clients/adt-client.js';
import { CliError } from '../output/json.js';
import { objectDirName } from './file-resolver.js';
import type { FuncComponent } from './func-pseudo.js';

/**
 * Shared FUGR sub-object layout — used by both pull and push so that what is
 * pulled (files) maps back to the exact ADT source URIs it came from.
 *
 * File-name conventions (see fugr README):
 *   <group>.fugr.sapl<group>.reps.*   → function-pool main program (FUGR source/main)
 *   <group>.fugr.l<group>....reps.*   → a FUGR/I include (e.g. l<group>top)
 *   <group>.fugr.<fm>.func.*          → a function module (FUGR/FF)
 *
 * Namespaced names keep `/` in SAP and use the AFF parentheses token on disk
 * (`/BMW/FOO` → `(bmw)foo`).
 *
 * As of 0.3.0 (T1.3 migration), FUGR/I includes other than UXX are no longer
 * silently dropped — FXX / OXX / IXX / arbitrary sub-includes all surface in
 * `layout.includes[]` so the pull side can emit one `.reps.{abap,json}` pair
 * for each. Callers (pull-fugr) still skip UXX because it is metadata-only.
 */

/** Disk token for a FUGR object or sub-object name (`/BMW/FOO` → `(bmw)foo`). */
export function fugrFileToken(name: string): string {
  return objectDirName(name);
}

/**
 * Parent function group of a FUGR/FF ADT URI.
 * Accepts both encoded (`.../groups/%2fbmw%2ffoo/fmodules/...`) and raw slash forms.
 */
export function parentFunctionGroupFromUri(
  objectUrl: string,
): { groupName: string; groupUrl: string } | undefined {
  const lower = objectUrl.toLowerCase();
  const marker = '/fmodules/';
  const idx = lower.lastIndexOf(marker);
  if (idx < 0) return undefined;
  const groupUrl = objectUrl.slice(0, idx).replace(/\/$/, '');
  const groupsMarker = '/functions/groups/';
  const gidx = groupUrl.toLowerCase().lastIndexOf(groupsMarker);
  if (gidx < 0) return undefined;
  const encodedGroup = groupUrl.slice(gidx + groupsMarker.length);
  if (!encodedGroup) return undefined;
  try {
    const decoded = decodeURIComponent(encodedGroup).toUpperCase();
    const groupName = decoded.includes('/') && !decoded.startsWith('/') ? `/${decoded}` : decoded;
    return { groupName, groupUrl };
  } catch {
    return undefined;
  }
}

function isFunctionModuleOfGroup(uri: string, group: string): boolean {
  return parentFunctionGroupFromUri(uri)?.groupName === group.toUpperCase();
}

function isFugrFunctionModuleUri(uri: string): boolean {
  return /\/fmodules(?:\/|$)/i.test(uri);
}

/** TOP / UXX / FXX / OXX / IXX includes belonging to a function group, including
 *  namespaced `/NS/LrestTOP`. The match is purely prefix-based — every include
 *  whose name starts with `L<group>` (or the namespaced equivalent) is treated
 *  as a group include; UXX is later singled out via {@link isFugrUxxInclude}. */
function isGroupInclude(name: string, group: string): boolean {
  const upper = name.toUpperCase();
  const g = group.toUpperCase();
  if (upper.startsWith(`L${g}`)) return true;
  if (!g.startsWith('/')) return false;
  const slash = g.indexOf('/', 1);
  if (slash < 0) return false;
  return upper.startsWith(`${g.slice(0, slash + 1)}L${g.slice(slash + 1)}`);
}

/** TOP include of a function group (`L<group>TOP` or `/NS/LrestTOP`). */
export function isFugrTopInclude(name: string, group: string): boolean {
  return isGroupInclude(name, group) && name.toUpperCase().endsWith('TOP');
}

/** UXX include (`L<group>U01..U99` or `L<group>UXX`) — holds the FM→include-number table. */
export function isFugrUxxInclude(name: string, group: string): boolean {
  if (!isGroupInclude(name, group)) return false;
  const upper = name.toUpperCase();
  const lGroup = `L${group.toUpperCase()}`;
  if (!upper.startsWith(lGroup)) return false;
  const suffix = upper.slice(lGroup.length);
  // `U01`, `U02`, … (real SAP numbering) or `UXX` (older naming).
  return /^U(\d+|XX)$/.test(suffix);
}

function namespacedIncludePrefix(group: string): string | undefined {
  if (!group.startsWith('/')) return undefined;
  const slash = group.indexOf('/', 1);
  if (slash < 0) return undefined;
  return `${group.slice(0, slash)}/L${group.slice(slash + 1)}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface FugrSubObject {
  /** Object name, upper case (e.g. LZFG_WECHAT_TABLETOP, TABLEFRAME_ZFG_WECHAT_TABLE). */
  name: string;
  /** ADT object URL — the lock/unlock target (e.g. .../includes/lzfg_wechat_tabletop). */
  objectUrl: string;
  /** Absolute source URI (setObjectSource/getObjectSource target). */
  sourceUrl: string;
  /** Object description from the sub-object structure. */
  description: string;
}

export interface FugrFunc extends FugrSubObject {
  /** Raw fmodule:processingType (e.g. 'normal', 'rfc', 'update'). */
  processingType?: string;
  rfcProperties?: Record<string, unknown>;
  updateProperties?: Record<string, unknown>;
  releaseState?: string;
  releaseDate?: string;
  global?: boolean;
  exceptionClasses?: boolean;
  application?: string;
  client?: string;
  activeFunctionExit?: boolean;
  notExecutable?: boolean;
  editLocked?: boolean;
  /** Parsed IMPORTING / EXPORTING / CHANGING / TABLES components (set during pull). */
  parameters?: FuncComponent[];
  /** Parsed RAISING components (set during pull). */
  exceptions?: FuncComponent[];
}

export interface FugrLayout {
  /** Upper-case group name (e.g. ZFG_WECHAT_TABLE or /BMW/FOO). */
  group: string;
  /** Lower-case group name (e.g. zfg_wechat_table or /bmw/foo). */
  groupLow: string;
  /** Disk prefix for the group (`(bmw)foo` for namespaced names). */
  groupFile: string;
  /** Function-pool main program source URI (= FUGR source/main). */
  saplUrl: string;
  /** FUGR/I includes (UXX included; callers skip it as the spec does). */
  includes: FugrSubObject[];
  /** FUGR/FF function modules. */
  funcs: FugrFunc[];
  /** Include numbers parsed from the UXX include during full enumeration. */
  funcIncludeNumbers?: Map<string, string>;
  /** Requested FM could not be read from the direct FUGR/FF URI. */
  missingFunctionModule?: string;
}

interface SearchHit {
  name: string;
  type: string;
  uri: string;
}

/** Search sub-objects via the untyped quickSearch (real ADT returns them per query). */
async function searchHits(client: AdtClientWrapper, query: string): Promise<SearchHit[]> {
  const results = await client.searchObject(query, '', 200);
  return results.map((r) => ({
    name: r['adtcore:name'],
    type: r['adtcore:type'],
    uri: r['adtcore:uri'],
  }));
}

/**
 * Parse each function module's include number from the group's UXX include
 * source (one `INCLUDE L<group>U01.  "<funcname>` line per module). The number
 * is required by the func metadata schema (fugr/func-v1.json). Returns a map
 * of upper-case FM name → include number ('01', '02', …).
 *
 * Supports both single-line `INCLUDE L<group>U01. "FM_NAME` and the
 * real-SAP CRLF double-line variant (`INCLUDE L<group>U01.\r\n  "FM_NAME`).
 */
export async function readFuncIncludeNumbers(
  client: AdtClientWrapper,
  group: string,
  includes: FugrSubObject[],
): Promise<Map<string, string>> {
  const numbers = new Map<string, string>();
  const includePrefix = namespacedIncludePrefix(group) ?? `L${group}`;
  const includeLineRe = new RegExp(
    `^\\s*INCLUDE\\s+${escapeRegExp(includePrefix)}U(\\d+)\\s*\\.\\s*(?:"\\s*([^\\s"]+))?`,
    'i',
  );
  const commentLineRe = /^\s*"\s*([^\s"]+)/;
  for (const inc of includes) {
    if (!isFugrUxxInclude(inc.name, group)) continue;
    const source = await client.getObjectSource(inc.sourceUrl);
    let pendingNumber: string | undefined;
    for (const line of source.split(/\r?\n/)) {
      const include = includeLineRe.exec(line);
      if (include) {
        const functionName = include[2];
        if (functionName) numbers.set(functionName.toUpperCase(), include[1]!);
        pendingNumber = functionName ? undefined : include[1];
        continue;
      }
      if (!pendingNumber) continue;
      const comment = commentLineRe.exec(line);
      if (comment) {
        numbers.set(comment[1]!.toUpperCase(), pendingNumber);
        pendingNumber = undefined;
      } else if (line.trim() !== '') {
        pendingNumber = undefined;
      }
    }
  }
  return numbers;
}

/** Enumerate a function group's main program, includes and function modules. */
export async function enumerateFugr(
  client: AdtClientWrapper,
  objectUrl: string,
  requestedFunctionModule?: { name: string; objectUrl: string },
): Promise<FugrLayout> {
  const struc = await client.objectStructure(objectUrl);
  const meta = struc.metaData as unknown as Record<string, unknown>;
  const group = String(meta['adtcore:name'] ?? '').toUpperCase();
  const groupLow = group.toLowerCase();
  const groupFile = fugrFileToken(group);

  const includeQueries = [`L${group}*`];
  const nsInclude = namespacedIncludePrefix(group);
  if (nsInclude) includeQueries.push(`${nsInclude}*`);
  const includes: FugrSubObject[] = [];
  const seenIncludes = new Set<string>();
  for (const query of includeQueries) {
    for (const h of (await searchHits(client, query)).filter(
      (x) =>
        x.type.startsWith('FUGR/I') &&
        isGroupInclude(x.name, group) &&
        !isFugrFunctionModuleUri(x.uri),
    )) {
      if (seenIncludes.has(h.uri)) continue;
      seenIncludes.add(h.uri);
      includes.push(await subObject(client, h.uri));
    }
  }

  const funcHits = await searchHits(client, `*${group}*`);
  const funcs: FugrFunc[] = [];
  for (const h of funcHits.filter(
    (x) => x.type.startsWith('FUGR/FF') && isFunctionModuleOfGroup(x.uri, group),
  )) {
    funcs.push(await subObject(client, h.uri));
  }
  let funcIncludeNumbers: Map<string, string> | undefined;
  let missingFunctionModule: string | undefined;
  if (!requestedFunctionModule) {
    funcIncludeNumbers = await readFuncIncludeNumbers(client, group, includes);
    for (const functionName of funcIncludeNumbers.keys()) {
      const requested = requestedFunctionModuleFor(objectUrl, `${fugrFileToken(functionName)}.func`);
      if (!requested || funcs.some((func) => func.objectUrl === requested.objectUrl)) continue;
      try {
        funcs.push(await subObject(client, requested.objectUrl));
      } catch (error: unknown) {
        if (error instanceof CliError && ['AUTH_ERROR', 'TLS_ERROR'].includes(error.code))
          throw error;
      }
    }
  }
  if (requestedFunctionModule && !funcs.some((func) => func.objectUrl === requestedFunctionModule.objectUrl)) {
    try {
      funcs.push(await subObject(client, requestedFunctionModule.objectUrl));
    } catch (error: unknown) {
      if (error instanceof CliError && ['AUTH_ERROR', 'TLS_ERROR'].includes(error.code))
        throw error;
      missingFunctionModule = requestedFunctionModule.name;
    }
  }

  const saplUrl = absolute(meta['abapsource:sourceUri'] as string, objectUrl);
  return { group, groupLow, groupFile, saplUrl, includes, funcs, funcIncludeNumbers, missingFunctionModule };
}

/** Resolve the direct ADT child URI for a local `<fm>.func` subtype. */
export function requestedFunctionModuleFor(
  groupObjectUrl: string,
  subtype: string,
): { name: string; objectUrl: string } | undefined {
  if (!subtype.endsWith('.func')) return undefined;
  // The disk token is the lower-case / # → / / form used by buildFilename.
  // For the (very rare) namespaced FM this round-trips fine because the
  // existing fixtures do not exercise namespaced function modules.
  const name = subtype.slice(0, '.func'.length * -1).toUpperCase();
  const encodedName = encodeURIComponent(name.toLowerCase()).replace(
    /%[0-9A-F]{2}/g,
    (part) => part.toLowerCase(),
  );
  return {
    name,
    objectUrl: `${groupObjectUrl.replace(/\/$/, '')}/fmodules/${encodedName}`,
  };
}

/** Fetch one sub-object's source URI + metadata from its ADT object URL. */
async function subObject(client: AdtClientWrapper, objectUrl: string): Promise<FugrSubObject> {
  const struc = await client.objectStructure(objectUrl);
  const meta = struc.metaData as unknown as Record<string, unknown>;
  const funcProperties = funcPropertiesFromMetadata(meta);
  return {
    name: String(meta['adtcore:name'] ?? '').toUpperCase(),
    objectUrl,
    sourceUrl: absolute(meta['abapsource:sourceUri'] as string, objectUrl),
    description: (meta['adtcore:description'] as string) ?? '',
    ...('fmodule:processingType' in meta
      ? { processingType: meta['fmodule:processingType'] as string }
      : {}),
    ...funcProperties,
  };
}

function funcPropertiesFromMetadata(meta: Record<string, unknown>): Partial<FugrFunc> {
  const rfcScope = enumValue(metaValue(meta, 'rfcScope'), {
    I: 'fromSameClientAndUser',
    C: 'fromSameSystem',
    E: 'fromAnySystem',
    ' ': 'notClassified',
    fromSameClientAndUser: 'fromSameClientAndUser',
    fromSameSystem: 'fromSameSystem',
    fromAnySystem: 'fromAnySystem',
    notClassified: 'notClassified',
  });
  const rfcVersion = enumValue(metaValue(meta, 'rfcVersion'), {
    '1': 'fastSerializationRequired',
    fastSerializationRequired: 'fastSerializationRequired',
    ' ': 'any',
    '': 'any',
    any: 'any',
  });
  const basxmlEnabled = booleanValue(metaValue(meta, 'basxmlEnabled'));
  const rfcProperties =
    basxmlEnabled !== undefined && rfcScope && rfcVersion
      ? {
          basxmlEnabled,
          rfcScope,
          rfcVersion,
          ...optionalBoolean(meta, 'abapFromJava'),
          ...optionalBoolean(meta, 'javaFromAbap'),
          ...optionalBoolean(meta, 'javaRemote'),
        }
      : undefined;
  const updateTaskKind = enumValue(metaValue(meta, 'updateTaskKind'), {
    '1': 'startImmediately',
    '2': 'startDelayed',
    '3': 'startImmediatelyNoRestart',
    '5': 'collectiveRun',
    '6': 'unsupportedKind',
    startImmediately: 'startImmediately',
    startDelayed: 'startDelayed',
    startImmediatelyNoRestart: 'startImmediatelyNoRestart',
    collectiveRun: 'collectiveRun',
    unsupportedKind: 'unsupportedKind',
  });
  const updateProperties = updateTaskKind ? { updateTaskKind } : undefined;
  return {
    ...(rfcProperties ? { rfcProperties } : {}),
    ...(updateProperties ? { updateProperties } : {}),
    ...optionalString(meta, 'releaseState'),
    ...optionalString(meta, 'releaseDate'),
    ...optionalBoolean(meta, 'global'),
    ...optionalBoolean(meta, 'exceptionClasses'),
    ...optionalString(meta, 'application'),
    ...optionalString(meta, 'client'),
    ...optionalBoolean(meta, 'activeFunctionExit'),
    ...optionalBoolean(meta, 'notExecutable'),
    ...optionalBoolean(meta, 'editLocked'),
  };
}

function metaValue(meta: Record<string, unknown>, name: string): unknown {
  return meta[`fmodule:${name}`] ?? meta[name];
}

function enumValue(value: unknown, values: Record<string, string>): string | undefined {
  if (typeof value !== 'string') return undefined;
  return values[value] ?? values[value.trim()] ?? values[value.toLowerCase()];
}

function booleanValue(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

function optionalBoolean(meta: Record<string, unknown>, name: string): Record<string, boolean> {
  const value = booleanValue(metaValue(meta, name));
  return value === undefined ? {} : { [name]: value };
}

function optionalString(meta: Record<string, unknown>, name: string): Record<string, string> {
  const value = metaValue(meta, name);
  return typeof value === 'string' && value.trim() !== '' ? { [name]: value } : {};
}

/**
 * Map a local FUGR file subtype (the dotted suffix after <group>.fugr) to its
 * ADT source URI, or undefined when the file has no source counterpart
 * (e.g. metadata .json files).
 */
export function fugrSourceUrlForSubtype(layout: FugrLayout, subtype: string): string | undefined {
  return fugrPushTargetFor(layout, subtype, '')?.sourceUrl;
}

/** Lock/unlock + write target for a local FUGR file subtype. */
export interface FugrPushTarget {
  /** ADT object URL — the lock/unlock target. */
  objectUrl: string;
  /** Absolute source URI to write. */
  sourceUrl: string;
}

/**
 * Resolve the lock target + source URI for a FUGR file subtype.
 *
 * Supports:
 *   - `sapl<group>.reps` (function-pool main, locks the group object)
 *   - `<l...>.reps` (any FUGR/I include, locks the include child)
 *   - `<fm>.func` (any function module, locks the FM child)
 */
export function fugrPushTargetFor(
  layout: FugrLayout,
  subtype: string,
  groupObjectUrl: string,
): FugrPushTarget | undefined {
  const saplSubtype = `sapl${layout.groupFile}.reps`;
  const saplLegacy = `sapl${layout.groupLow}.reps`;
  if (subtype === saplSubtype || subtype === saplLegacy)
    return { objectUrl: groupObjectUrl, sourceUrl: layout.saplUrl };
  if (subtype.endsWith('.reps')) {
    const token = subtype.slice(0, '.reps'.length * -1).toLowerCase();
    const inc =
      layout.includes.find((i) => fugrFileToken(i.name) === token) ??
      ((token === `l${layout.groupFile}top` || token === `l${layout.groupLow}top`)
        ? layout.includes.find((i) => isFugrTopInclude(i.name, layout.group))
        : undefined);
    return inc ? { objectUrl: inc.objectUrl, sourceUrl: inc.sourceUrl } : undefined;
  }
  if (subtype.endsWith('.func')) {
    const fmName = subtype.slice(0, '.func'.length * -1).toUpperCase();
    const fm = layout.funcs.find((f) => f.name === fmName);
    return fm ? { objectUrl: fm.objectUrl, sourceUrl: fm.sourceUrl } : undefined;
  }
  return undefined;
}

/** ADT source URIs may be relative to the object URL. */
function absolute(sourceUrl: string, objectUrl: string): string {
  if (sourceUrl.startsWith('/')) return sourceUrl;
  return `${objectUrl.replace(/\/$/, '')}/${sourceUrl}`;
}
