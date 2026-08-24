/**
 * BTP / Steampunk-safe CLAS / INTF / PROG / FUGR create-object wrapper.
 *
 * Background
 * ----------
 * `abap-adt-api@8.4.1` (build/api/objectcreator.js) hard-codes
 * `Content-Type: application/*` on the create POST. That wildcard works on
 * classic on-prem ECC, but BTP ABAP trial rejects the create body with:
 *
 *   "An error occurred when deserializing in the simple transformation
 *    program CLASS_TRANSFORMATION"
 *
 * Reference: `fr0ster/mcp-abap-adt-clients@12.1.0` ships a body shape that
 * BTP accepts. Three extra elements vs upstream `createBodySimple`:
 *   - `xmlns:abapsource="http://www.sap.com/adt/abapsource"` namespace
 *   - `<class:include class:includeType="testclasses"/>` (empty test include)
 *   - `<class:superClassRef/>` (empty super-class ref)
 * Without these, BTP's ST halts deserialization at the `<adtcore:packageRef>`
 * offset (~370) with `CLASS_TRANSFORMATION`. We can't patch the library
 * without forking (per project policy), so this wrapper issues the same
 * request shape with v4 Media-Type + the extra BTP-mandatory elements.
 * Covers CLAS / INTF / PROG / FUGR; other types fall through to the library.
 */
import type { AdtHTTP, ClientOptions } from 'abap-adt-api/build/AdtHTTP.js';
import { CliError } from '../output/json.js';

export interface CreateObjectOptions {
  objtype: string;
  name: string;
  parentName: string;
  description: string;
  parentPath: string;
  transport?: string;
  /** Optional: language override. Defaults to "EN". */
  language?: string;
  /** Optional: master language override. Defaults to language. */
  masterLanguage?: string;
}

interface CreatableType {
  creationPath: string;
  nameSpace: string;
  rootName: string;
  typeId: string;
  /** XML namespace prefix the body uses for the package-ref element. */
  packageNs?: string;
  /** Optional XML fragment inserted after `<adtcore:packageRef>`. Used for
   *  BTP trial-mandatory elements (e.g. CLAS testclasses include). */
  extras?: string;
}

const CLAS: CreatableType = {
  creationPath: 'oo/classes',
  nameSpace: 'xmlns:class="http://www.sap.com/adt/oo/classes"',
  rootName: 'class:abapClass',
  typeId: 'CLAS/OC',
  packageNs: 'adtcore',
  // BTP trial ST rejects create-body without a testclasses include + an
  // empty superClassRef. fr0ster/mcp-abap-adt-clients ships these; we mirror.
  extras: `<class:include adtcore:name="CLAS/OC" adtcore:type="CLAS/OC" class:includeType="testclasses"/>
          <class:superClassRef/>`,
};

const INTF: CreatableType = {
  creationPath: 'oo/interfaces',
  nameSpace: 'xmlns:intf="http://www.sap.com/adt/oo/interfaces"',
  rootName: 'intf:abapInterface',
  typeId: 'INTF/OI',
  packageNs: 'adtcore',
};

const PROG: CreatableType = {
  creationPath: 'programs/programs',
  nameSpace: 'xmlns:program="http://www.sap.com/adt/programs/programs"',
  rootName: 'program:abapProgram',
  typeId: 'PROG/P',
  packageNs: 'adtcore',
};

const FUGR: CreatableType = {
  creationPath: 'functions/groups',
  nameSpace: 'xmlns:group="http://www.sap.com/adt/functions/groups"',
  rootName: 'group:abapFunctionGroup',
  typeId: 'FUGR/F',
  packageNs: 'adtcore',
};

const TYPES: Record<string, CreatableType> = {
  CLAS,
  INTF,
  PROG,
  FUGR,
};

/** Returns the supported type entry, or undefined if the library must handle it. */
export function getCreatableType(objtype: string): CreatableType | undefined {
  // `objtype` may be the user-facing type (e.g. "CLAS") or the abap-adt-api
  // internal typeId (e.g. "CLAS/OC"). Normalise on the user-facing side first,
  // then fall through to typeId mapping.
  const byName = TYPES[objtype.toUpperCase()];
  if (byName) return byName;
  const byId = Object.entries(TYPES).find(([, t]) => t.typeId === objtype);
  return byId ? byId[1] : undefined;
}

/** XML-attribute safe encoding. Mirrors `utilities.encodeEntity` upstream. */
function encodeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * POST a create-object request with the same body shape as the upstream
 * library's `createBodySimple`, but with an explicit
 * `Content-Type: application/xml` (or `application/vnd.sap-adt.oo.classes+xml`
 * if the caller wants BTP-specific MIME). The library hard-codes
 * `application/*` which works on classic on-prem ECC but triggers
 * `CLASS_TRANSFORMATION` deserialization errors on BTP ABAP trial / Cloud
 * tenants with stricter ST validation.
 *
 * Throws whatever `AdtHTTP.request` throws on a non-2xx response.
 */
export async function createObjectXml(
  http: AdtHTTP,
  options: CreateObjectOptions,
  ctx: { responsible: string },
  opts: { contentType?: string } = {},
): Promise<void> {
  const type = getCreatableType(options.objtype);
  if (!type) {
    throw new CliError(
      'TYPE_NOT_SUPPORTED',
      `createObjectXml: unsupported objtype '${options.objtype}'. Supported: ${Object.keys(TYPES).join(', ')}`,
    );
  }
  const language = options.language ?? 'EN';
  const masterLanguage = options.masterLanguage ?? language;
  // For most types (CLAS, INTF, PROG, FUGR) the URL is just '/sap/bc/adt/<creationPath>'.
  // Sub-types like FUGR/FF (function module) or FUGR/I (include) carry '%s' in their
  // creationPath; we splice the parent (function group) name into the URL for those.
  // Package is supplied in the body via <adtcore:packageRef>, NOT in the URL.
  const url = '/sap/bc/adt/' +
    type.creationPath.replace(/%s/g, encodeURIComponent(options.parentName.toLowerCase()));
  // Body shape follows `fr0ster/mcp-abap-adt-clients` trial-safe envelope:
  //   - xmlns:abapsource namespace
  //   - <class:include class:includeType="testclasses"/> mandatory on BTP
  //   - <class:superClassRef/> (empty) mandatory on BTP
  //   - NO adtcore:responsible attribute — BTP trial ST (CLASS_TRANSFORMATION)
  //     rejects bodies that carry it (verified against the live trial on
  //     2026-08-24: removing it moves the request past deserialization to
  //     the authorization check). Upstream `createBodySimple` also only adds
  //     responsible when explicitly requested, and object creation does not
  //     need it.
  const pkgRefAttrs = `adtcore:name="${encodeAttr(options.parentName)}"${options.parentPath ? ` adtcore:uri="${encodeAttr(options.parentPath)}"` : ''}`;
  const body = `<?xml version="1.0" encoding="UTF-8"?>
        <${type.rootName} ${type.nameSpace}
          xmlns:adtcore="http://www.sap.com/adt/core"
          xmlns:abapsource="http://www.sap.com/adt/abapsource"
          adtcore:description="${encodeAttr(options.description)}"
          adtcore:name="${encodeAttr(options.name)}" adtcore:type="${encodeAttr(options.objtype)}"
          adtcore:language="${encodeAttr(language)}" adtcore:masterLanguage="${encodeAttr(masterLanguage)}">
          <adtcore:packageRef ${pkgRefAttrs}/>
          ${type.extras ?? ''}
        </${type.rootName}>`;
  const qs: Record<string, string> = {};
  if (options.transport) qs.corrNr = options.transport;
  // BTP accepts the v4 vendor media-type; on-prem tolerates it too. v2/v3
  // would also work but v4 matches fr0ster (proven on BTP trial).
  const contentType = opts.contentType ?? 'application/vnd.sap.adt.oo.classes.v4+xml';
  await http.request(url, {
    method: 'POST',
    body,
    headers: { 'Content-Type': contentType, Accept: 'application/xml' },
    qs,
  });
}

/**
 * Convenience wrapper used by `AdtClientWrapper.createObject`. Picks the
 * BTP-friendly path when supported, otherwise delegates to the library. Used
 * by `abap create` and `abap extension deploy`.
 */
export async function createObjectSafe(
  http: AdtHTTP,
  options: CreateObjectOptions,
  ctx: { responsible: string },
  fallback: () => Promise<void>,
): Promise<void> {
  if (getCreatableType(options.objtype)) {
    return createObjectXml(http, options, ctx);
  }
  return fallback();
}