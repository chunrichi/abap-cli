#!/usr/bin/env node
/**
 * Mock ADT server for offline verification of `abap pull` / `abap push` / `abap check`.
 *
 * Implements the subset of /sap/bc/adt endpoints consumed by abap-adt-api:
 *   compatibility/graph (login), repository search, object structure, source
 *   GET/PUT, lock/unlock, checkruns (content-based syntax check), activation,
 *   cts/transportrequests.
 *
 * Usage:  node test/integration/mock-adt/server.js [port]
 * Env:    MOCK_NO_TRANSPORTS=1  →  userTransports returns no requests (NO_TRANSPORT path)
 *
 * Validator rule: a source line containing "syntax_error" yields severity E at
 * that line; "syntax_warning" yields severity W. Deterministic for quickstart.
 */
import http from 'node:http';
import { URL } from 'node:url';

const PORT = Number(process.argv[2] || process.env.PORT || 8080);
const NO_TRANSPORTS = process.env.MOCK_NO_TRANSPORTS === '1';
// MOCK_ATOMIC_FAIL=1 → fail the 2nd setObjectSource (mid-batch write failure for push --atomic).
const ATOMIC_FAIL = process.env.MOCK_ATOMIC_FAIL === '1';
// MOCK_AUTH_FAIL=1 → compatibility graph returns 401 (auth layer failure for `profile test`).
const AUTH_FAIL = process.env.MOCK_AUTH_FAIL === '1';
// MOCK_ICF_FAIL=1 → /sap/abap_cli/ returns 500 (icf layer failure for `profile test`).
const ICF_FAIL = process.env.MOCK_ICF_FAIL === '1';
// MOCK_SETUP_FAIL=1 → classrun of the ICF setup class returns a failure envelope.
const SETUP_FAIL = process.env.MOCK_SETUP_FAIL === '1';
// MOCK_DDIC_FAIL=1 → /sap/abap_cli/ddic/<type> POST returns 500 (created objects still
// occupy the fixture store but the wire response is the failure envelope).
// MOCK_TEXTPOOL_WRITE_UNSUPPORTED=1 → /textpool/<category> POST reports write unsupported
// (simulates ECC where the ADT text-elements write endpoint is absent).
const TEXTPOOL_WRITE_UNSUPPORTED = process.env.MOCK_TEXTPOOL_WRITE_UNSUPPORTED === '1';
const DDIC_FAIL = process.env.MOCK_DDIC_FAIL === '1';
// MOCK_REMOTE_MISSING=1 → /version-source reports no transported versions (empty source),
// mirroring the real backend's SVRS_GET_VERSIONS empty case.
const REMOTE_MISSING = process.env.MOCK_REMOTE_MISSING === '1';
// Deployed abap_cli version served by the mock root (mirrors CLI ICF_SERVICE_VERSION).
const ICF_SERVICE_VERSION = process.env.MOCK_ICF_VERSION || '0.4.0';
// MOCK_ICF_OLD=1 → simulate a deployed service from before /whoami existed:
// the identity route answers the old handler's 404 NOT_FOUND envelope.
const ICF_OLD = process.env.MOCK_ICF_OLD === '1';
const NOW = '2026-08-01T00:00:00Z';
const CURRENT_USER = 'MOCKUSER';
let putCount = 0; // global PUT counter (MOCK_ATOMIC_FAIL fails on the 2nd write)

// ---------- fixture store ----------
const objects = new Map();
// 014: temporary in-memory store for DDIC create/overwrite payloads (round-trip tests).
const ddicStore = new Map();
// DOMA/DTEL long-text companion store — key = `<TYPE>:<OBJ>`, value = AFF
// docu document `{ formatVersion, lines: [{ format, line }] }`.
// Served by GET/POST /sap/abap_cli/ddic/<doma|dtel>/<name>/docu.
const docuStore = new Map();
// VIEW (database view) store — key = view name, value = view-v1 wire document.
const viewStore = new Map();
// JOBD application job definitions: /sap/abap_cli/jobd/<name> (local-extension jobd-v1).
const jobdStore = new Map();
// SHLP (search help) store — key = shlp name, value = shlp-v1 wire document.
const shlpStore = new Map();
// Generic AFF bundle store — key = `<TYPE>:<NAME>`, value = { type, name,
// package, masterLanguage, files: [{ name, content }] }. SAP's AFF framework
// owns the file set, so the mock keeps names/contents verbatim: what the CLI
// posts is exactly what GET serves back (round-trip contract).
const affStore = new Map();
// AFF types served by the generic /aff endpoint on the mock release.
const AFF_TYPES = new Set(['APLO', 'CHDO', 'EVTB', 'SMBC', 'ENHO', 'ENHS']);
// 014: textpool store — key = `<TYPE>:<OBJ>:<CATEGORY>`, value = array of { id, text }.
const textpoolStore = new Map();
// 015: remote source store — key = `<TYPE>:<OBJ>`, value = source string served by /version-source.
const remoteSourceStore = new Map();
// 014: TRAN (SE93 transaction code) store — key = TCODE, value = wire document.
const tranStore = new Map();
// HTTP (SICF node) store — key = node name (upper), value = AFF wire document.
const httpStore = new Map();
// SM59 (RFC destination) store — key = destination name (upper), value = the
// wire document posted by the CLI (target host / port / protocol / path prefix /
// description). Only RFCTYPE='G' (HTTP connection to external server) is
// manageable; other types are seeded in a separate map so the type gate can be
// exercised without pretending to support them.
const sm59Store = new Map();
const sm59OtherTypeStore = new Map();
// UCON RFC service (SRFC) and OAuth 2.0 client profile (OA2P) stores — key =
// object name (upper), value = the wire document. Both are TADIR objects: the
// stored document carries the read-only `package` the CLI sends on create.
const srfcStore = new Map();
const oa2pStore = new Map();
// XSLT (transformation program) store — key = NAME, value = { name, description,
// originalLanguage, source, package }. `source` is stored in the canonical
// (LF, no trailing break) form; GET adds the CRLF read-back the real
// CL_O2_API_XSLTDESC->get_source_string() produces.
const xsltStore = new Map();
// 016: read-only table data store — key = <TABLE>, value = { tabclass, fields, rows }.
// Seeded below with ZTAB_FIXTURE (150 rows, clientDependent, mixed types).
const tableStore = new Map();
// DEVC: package store — key = package name (upper), value = package metadata.
// Served by GET/POST/DELETE /sap/bc/adt/packages and the search endpoint.
const packages = new Map();
// ATC configuration objects — key = `<TYPE>:<NAME>`, value = { xml, packageName }.
// The XML body posted by the CLI is stored verbatim and served back on GET, so
// the AFF projection is exercised on the CLI side (same contract as real ADT).
const atcObjects = new Map();
// Service bindings (SRVB) — name → { description, packageName, serviceName,
// serviceVersion, bindingVersion, published }.
const srvbStore = new Map();

/** Metadata envelope the CLI's publish flow reads. */
function srvbMetadataXml(stored) {
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    `<srvb:serviceBinding srvb:published="${stored.published}" srvb:bindingCreated="true"` +
    ` adtcore:name="${stored.name}" adtcore:type="SRVB/SVB" adtcore:version="active"` +
    ` adtcore:description="${stored.description}"` +
    ' xmlns:srvb="http://www.sap.com/adt/ddic/ServiceBindings" xmlns:adtcore="http://www.sap.com/adt/core">' +
    `<adtcore:packageRef adtcore:name="${stored.packageName}"/>` +
    `<srvb:services srvb:name="${stored.serviceName}">` +
    `<srvb:content srvb:version="${stored.serviceVersion}">` +
    '<srvb:serviceDefinition adtcore:name="ZCLI_MOCK_SRVD"/>' +
    '</srvb:content></srvb:services>' +
    `<srvb:binding srvb:type="ODATA" srvb:version="${stored.bindingVersion}" srvb:category="0">` +
    `<srvb:implementation adtcore:name="${stored.name}"/>` +
    '</srvb:binding></srvb:serviceBinding>'
  );
}

// Type pools (TYPE-POOL / TYPE) — name → { metaXml, source, packageName }.
const typegroupStore = new Map();
// CDS technical objects — key = `<TYPE>:<NAME>`, value = { metaXml, source, packageName }.
// DTDC/DTEB/DSFD store an XML metadata envelope + `.acds` source text; DSFI
// stores a blueSource envelope + the AFF JSON document as its source.
const cdsTechStore = new Map();
// Application jobs (SAJC catalog entries / SAJT templates) — key = `<TYPE>:<NAME>`,
// value = { metaXml, source, packageName }. `source` is the ADT JSON document
// served on `source/main`; its shape follows MOCK_APPJOB_MODEL.
const appjobStore = new Map();
// Authorization-object family (AUTH / SUSC / SUCU / SUSH / SUSO): hand-written
// ICF routes under `/sap/abap_cli/auth/<sub>/<name>`. One in-memory map per
// sub-route: key = canonical object name (upper case), value =
// { document, package, whereUsed }. GET answers the document plus the read-side
// `name` / `package` metadata the CLI strips before writing the local
// `<token>.<sub>.json` file; writes answer the shared
// `{name,type,action,package,activated:false}` envelope.
const authStores = { auth: new Map(), susc: new Map(), sucu: new Map(), sush: new Map(), suso: new Map() };
// `/auth/<sub>` route segment → CLI type code (the sub-route names are frozen).
const AUTH_TYPE_BY_SUB = { auth: 'AUTH', susc: 'SUSC', sucu: 'SUCU', sush: 'SUSH', suso: 'SUSO' };
// Which application-job JSON model the mock system serves: 'legacy' (flat
// className/reportName documents, the SAP_BASIS 757 reference release) or
// 'nested' (the AFF v1 generalInformation model).
const APPJOB_MODEL = process.env.MOCK_APPJOB_MODEL === 'nested' ? 'nested' : 'legacy';
const APPJOB_COLLECTIONS = {
  '/sap/bc/adt/applicationjob/catalogs': 'SAJC',
  '/sap/bc/adt/applicationjob/templates': 'SAJT',
};
// Generic AFF objects over ADT blueSource resources — collection → CLI type.
// `source/main` of each resource *is* the object's official AFF JSON document.
const ADT_AFF_COLLECTIONS = {
  '/sap/bc/adt/applicationlog/objects': 'APLO',
  '/sap/bc/adt/changedocuments/objects': 'CHDO',
  '/sap/bc/adt/businessservices/evtbevb': 'EVTB',
  '/sap/bc/adt/bct/smbctyp': 'SMBC',
};
// ADT AFF store — key = `<TYPE>:<NAME>`, value = { metaXml, source, packageName }.
const adtAffStore = new Map();
const APPJOB_SCHEMAS = {
  legacy: {
    SAJC: { formatVersion: {}, header: {}, className: {}, reportName: {}, checkExitClass: {}, valueHelpExitClass: {} },
    SAJT: { formatVersion: {}, header: {}, catalogName: {}, parameters: {} },
  },
  nested: {
    SAJC: { formatVersion: {}, header: {}, generalInformation: {}, exitClasses: {}, sections: {}, groups: {}, parameters: {} },
    SAJT: { formatVersion: {}, header: {}, generalInformation: {}, parameters: {} },
  },
};
// ADT collection path → CLI type code for the ATC configuration resources.
const ATC_COLLECTIONS = {
  '/sap/bc/adt/atc/checkcategories': 'CHKC',
  '/sap/bc/adt/atc/checks': 'CHKO',
  '/sap/bc/adt/atc/checkvariants': 'CHKV',
};
// ICF write rules mirror the ABAP handler: only `$`-prefixed packages are
// LOCAL (transport-free); an empty package means "use $TMP", hence local.
function isLocalPackage(pkg) {
  const name = String(pkg || '').trim();
  return name === '' || name.startsWith('$');
}

// ---------- authorization-object family (AUTH / SUSC / SUCU / SUSH / SUSO) ----------
// Name, document and transport rules mirror the per-type ICF handlers:
// canonical names are upper case (SUCU keeps its 40-character padded TADIR
// composite as the canonical form), writes validate the document shape and the
// package / transport rule, errors use the shared `<TYPE>_*` code family with
// the handler's HTTP status mapping.
// Authorization objects the SUCU handler checks against TOBJ (check table).
const AUTH_TOBJ_FIXTURES = new Set(['S_TABU_DIS', 'S_RFC', 'S_TCODE', 'S_DEVELOP', 'S_PROGRAM']);

/**
 * Canonicalize one family object name (the CLI sends the canonical form).
 *
 * SUCU: the canonical CLI/route name is the compact `<GROUP>~<OBJECT>` form;
 * the raw 40-character padded TADIR name (`BRGRU` padded to 30 + `OBJECT`
 * padded to 10) is accepted as an alias and normalized back to the compact
 * form. A single `/` is not a separator (OBJECT may itself be namespaced).
 */
function canonicalAuthName(type, rawName) {
  if (type !== 'SUCU') return rawName.trim().toUpperCase();
  const raw = String(rawName || '').trim();
  if (!raw) return '';
  if (raw.includes('~')) {
    const parts = raw.split('~');
    if (parts.length !== 2) return raw.toUpperCase();
    return `${parts[0].trim()}~${parts[1].trim()}`.toUpperCase();
  }
  if (raw.length === 40) {
    return `${raw.slice(0, 30).trimEnd()}~${raw.slice(30).trimEnd()}`.toUpperCase();
  }
  return raw.toUpperCase();
}

/** Validate one canonical family object name against the SAP-side rules. */
function authNameValid(type, name) {
  switch (type) {
    case 'AUTH':
      return name.length <= 30 && /^\/?[A-Z0-9_]+(\/[A-Z0-9_]+)*$/.test(name);
    case 'SUSC':
      // TOBC-OCLSS is CHAR 4: plain 1-4 chars or the `/XXX` namespace form.
      return /^(?:[A-Z0-9][A-Z0-9_-]{0,3}|\/[A-Z0-9_-]{3})$/.test(name);
    case 'SUCU': {
      // Compact `<GROUP>~<OBJECT>`: group 1-30, object 1-10, A-Z 0-9 _ /.
      const parts = name.split('~');
      if (parts.length !== 2) return false;
      const [group, object] = parts;
      return (
        /^[A-Z0-9_/]+$/.test(group) &&
        group.length >= 1 &&
        group.length <= 30 &&
        /^[A-Z0-9_/]+$/.test(object) &&
        object.length >= 1 &&
        object.length <= 10
      );
    }
    case 'SUSH': {
      // Canonical `<NAME>.<TYPE>` (NAME CHAR 30, TYPE in RF/TR/HT/HS).
      const dot = name.lastIndexOf('.');
      if (dot < 1) return false;
      const application = name.slice(0, dot);
      const keyType = name.slice(dot + 1);
      return ['RF', 'TR', 'HT', 'HS'].includes(keyType) && application.length <= 30 && /^[A-Z0-9_/]+$/.test(application);
    }
    case 'SUSO':
      // XUOBJECT is CHAR 10; customer objects start with Z/Y or a namespace.
      return name.length <= 10 && /^(?:Z|Y|\/)[A-Z0-9_/]*$/.test(name);
    default:
      return false;
  }
}

/** SUCU document → canonical compact name (URL/document agreement check). */
function sucuNameFromDocument(document) {
  const general = (document && document.generalInformation) || {};
  const group = String(general.authorizationGroup || '').trim().toUpperCase();
  const object = String(general.authorizationObject || '').trim().toUpperCase();
  if (!group || !object) return undefined;
  return `${group}~${object}`;
}

/**
 * Minimal server-side document validation per type. The CLI validates against
 * the same JSON schema before sending, so this is defense in depth: malformed
 * bodies and name/document disagreements still map to `<TYPE>_INVALID_PAYLOAD`.
 */
function authPayloadError(type, document) {
  switch (type) {
    case 'AUTH': {
      const general = (document && document.generalInformation) || {};
      if (typeof general.dataElement !== 'string' || !general.dataElement.trim()) {
        return 'generalInformation.dataElement is required';
      }
      if (!document || document.formatVersion !== '1') return 'formatVersion must be "1"';
      return undefined;
    }
    case 'SUSC': {
      const header = (document && document.header) || {};
      if (typeof header.description !== 'string') return 'header.description is required';
      if (typeof header.originalLanguage !== 'string' || !/^[A-Za-z]{2}$/.test(header.originalLanguage)) {
        return 'header.originalLanguage must be a two-letter ISO language code';
      }
      if (!document || document.formatVersion !== '1') return 'formatVersion must be "1"';
      return undefined;
    }
    case 'SUCU': {
      const header = (document && document.header) || {};
      if (!document || document.formatVersion !== '1') return 'formatVersion must be "1"';
      if (typeof header.description !== 'string') return 'header.description is required';
      if (typeof header.originalLanguage !== 'string' || !/^[A-Z]{2}$/i.test(header.originalLanguage)) {
        return 'header.originalLanguage must be a two-letter ISO language code';
      }
      const padded = sucuNameFromDocument(document);
      if (!padded) return 'generalInformation.authorizationGroup/authorizationObject are required';
      const general = document.generalInformation || {};
      if (!AUTH_TOBJ_FIXTURES.has(String(general.authorizationObject).trim().toUpperCase())) {
        return `authorization object ${general.authorizationObject} does not exist (TOBJ check table)`;
      }
      return undefined;
    }
    case 'SUSH': {
      const general = (document && document.generalInformation) || {};
      if (typeof general.applicationName !== 'string' || !general.applicationName.trim()) {
        return 'generalInformation.applicationName is required';
      }
      if (typeof general.applicationType !== 'string' || !general.applicationType.trim()) {
        return 'generalInformation.applicationType is required';
      }
      if (typeof general.maintenanceMode !== 'string' || !general.maintenanceMode.trim()) {
        return 'generalInformation.maintenanceMode is required';
      }
      if (document.authorizationObjects !== undefined && !Array.isArray(document.authorizationObjects)) {
        return 'authorizationObjects must be an array';
      }
      return undefined;
    }
    case 'SUSO': {
      if (!document || document.formatVersion !== '1') return 'formatVersion must be "1"';
      const header = (document && document.header) || {};
      if (typeof header.description !== 'string') return 'header.description is required';
      const general = (document && document.generalInformation) || {};
      if (typeof general.objectClass !== 'string' || !general.objectClass.trim()) {
        return 'generalInformation.objectClass is required';
      }
      if (!Array.isArray(document.authorizationFields) || document.authorizationFields.length === 0) {
        return 'authorizationFields must contain at least one field';
      }
      return undefined;
    }
    default:
      return 'unknown authorization-family type';
  }
}

/**
 * Package / transport rule of the family writes.
 *
 * `$`-prefixed packages are transport-free (a stray request is dropped);
 * everything else needs an explicit request, mirroring the shared
 * `transport_rule` helper on the SAP side.
 */
function authTransportError(type, packageName, transport, verb) {
  if (isLocalPackage(packageName)) return undefined;
  if (!transport) {
    return {
      code: `${type}_TRANSPORT_REQUIRED`,
      message: `transportRequest is required for ${type} ${verb} in package ${packageName}`,
    };
  }
  if (!/^[A-Z0-9][A-Z0-9_]{2,19}$/.test(transport)) {
    return {
      code: `${type}_TRANSPORT_INVALID`,
      message: `transportRequest ${transport} is not a valid request number`,
    };
  }
  return undefined;
}

/** Read one JSON request body; undefined when it is not a JSON object. */
function authParseJson(body) {
  try {
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined;
  } catch (_e) {
    return undefined;
  }
}

/** Error envelope with the real handler's HTTP status mapping. */
function authError(res, status, code, message) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'error', error: { code, message } }));
}

/** GET envelope: stored document + the read-side `name` / `package` metadata. */
function authGetData(stored, name) {
  return { ...stored.document, name, package: stored.package };
}

/** Write envelope shared by POST / PUT / DELETE. */
function authWriteData(type, name, action, packageName, regenerate) {
  return {
    name,
    type,
    action,
    package: packageName,
    activated: false,
    // SUSO only, and only when the explicit opt-in asked for it (default: skipped).
    ...(type === 'SUSO' && regenerate ? { profilesRegenerated: true } : {}),
  };
}

// Standard objects seeded read-only: they exercise the read path and the
// where-used / delivered-object delete refusal without a prior create. The
// real handlers refuse these deletes with `<TYPE>_DELETE_REFUSED` (AUTH / SUSC /
// SUSO) or `SUCU_DELETE_UNSUPPORTED` (non-local package).
(function seedAuthFixtures() {
  const seed = (sub, name, packageName, document, options = {}) =>
    authStores[sub].set(name, { document, package: packageName, whereUsed: options.whereUsed === true });
  seed(
    'auth',
    'VKORG',
    'VA',
    {
      formatVersion: '1',
      generalInformation: { dataElement: 'VKORG', searchHelpExit: '', activityField: false },
      alternativeSearchHelp: { checkTable: 'TVKO' },
    },
    { whereUsed: true },
  );
  seed(
    'susc',
    'CV',
    'S_BASIS',
    { formatVersion: '1', header: { description: 'Authorization objects for document management', originalLanguage: 'en' } },
    { whereUsed: true },
  );
  seed(
    'sucu',
    'CMMFDOR~S_TABU_DIS',
    'FS_CMM_CDOTE_ORDER_REQUEST',
    {
      formatVersion: '1',
      header: { description: 'Commodity order authorization group', originalLanguage: 'EN' },
      generalInformation: { authorizationGroup: 'CMMFDOR', authorizationObject: 'S_TABU_DIS' },
      texts: [{ language: 'DE', description: 'Berechtigungsgruppe Commodity' }],
    },
  );
  seed('sush', 'OCS_GET_INSTALLED_COMPS.RF', 'SPAM', {
    formatVersion: '1',
    header: { description: 'R3TR FUNC OCS_GET_INSTALLED_COMPS', originalLanguage: 'en', abapLanguageVersion: 'standard' },
    generalInformation: {
      applicationName: 'OCS_GET_INSTALLED_COMPS',
      applicationType: 'FUNC',
      maintenanceMode: 'noDefaultValues',
      defaultValuesRequired: 'yes',
    },
    authorizationObjects: [
      {
        authObjectName: 'S_RFC',
        maintenanceStatus: 'defaultWithValues',
        authObjectFieldValues: [{ authFieldName: 'RFC_TYPE', authFieldLowValue: 'FUGR' }],
      },
    ],
  });
  seed(
    'suso',
    '/AIF/CDLOG',
    '/AIF/ERROR_CHANGE',
    {
      formatVersion: '1',
      header: { description: 'AIF application log', originalLanguage: 'EN', abapLanguageVersion: 'standard' },
      generalInformation: { objectClass: 'AAAT', fieldBlock: '', conversion: false },
      authorizationFields: [{ authorizationField: 'ACTVT' }],
      permittedActivities: [{ activity: '70' }],
      objectAttributes: { criticality: 'notCritical', classCopyToDefaultData: 'withoutRestriction' },
      sapNewRelevance: { isRelevantToSapNew: false, values: [] },
      classificationForCdsBdef: { usageInOwnAuthContext: 'notSpecified', usageInPrivilegedBdefMode: 'notSpecified' },
    },
    { whereUsed: true },
  );
})();
// Tracks whether the DDIC POST handler saw a pre-existing entry (used to derive
// data.action = 'updated' vs 'created'). Local to the request handler.
let ddicStore_existed_before = false;

// 016: ZTAB_FIXTURE seed — 150 rows, 75 STATUS='X' / 75 STATUS='Y', AMOUNT 1..150.00.
// tabsclass TRANSP, clientDependent=true; fields match the data-model.NOTE column is STRG
// (large object) and is auto-excluded in the no-`fields` path.
(function seedTableFixture() {
  const fields = [
    { name: 'MANDT', dataType: 'CLNT', length: 3, decimals: 0, keyFlag: true },
    { name: 'ID', dataType: 'NUMC', length: 10, decimals: 0, keyFlag: true },
    { name: 'STATUS', dataType: 'CHAR', length: 2, decimals: 0, keyFlag: false },
    { name: 'AMOUNT', dataType: 'DEC', length: 10, decimals: 2, keyFlag: false },
    { name: 'NAME', dataType: 'CHAR', length: 40, decimals: 0, keyFlag: false },
    { name: 'CREATED', dataType: 'DATS', length: 8, decimals: 0, keyFlag: false },
    { name: 'NOTE', dataType: 'STRG', length: 0, decimals: 0, keyFlag: false },
  ];
  const rows = [];
  for (let i = 1; i <= 150; i++) {
    const id = String(i).padStart(10, '0');
    const status = i % 2 === 0 ? 'X' : 'Y';
    const amount = (i).toFixed(2);
    const name = `Item ${id}`;
    const created = `2026${String(Math.floor((i % 12) + 1)).padStart(2, '0')}${String(((i - 1) % 28) + 1).padStart(2, '0')}`;
    // NOTE contains single quotes and a semicolon to exercise injection payloads.
    const note = `Note ${id}; contains 'apostrophe' and \"quotes\"`;
    rows.push({ MANDT: '001', ID: id, STATUS: status, AMOUNT: amount, NAME: name, CREATED: created, NOTE: note });
  }
  tableStore.set('ZTAB_FIXTURE', { tabclass: 'TRANSP', clientDependent: true, fields, rows });
  // Pool table — exercises TABLE_TYPE_NOT_SUPPORTED.
  tableStore.set('ZPOOL_FIXTURE', { tabclass: 'POOL', clientDependent: false, fields: [], rows: [] });
})();

// 016: large-object datatype set — excluded from output when --fields is not specified.
const LARGE_OBJECT_TYPES = new Set(['STRG', 'RSTR', 'LCHR', 'LRAW']);

/**
 * 016: filter table rows by a simple `field op value` predicate set composed with AND.
 * `predicates` is an array of { field, op, value, valueKind } objects.
 * `valueKind` is `'string'` or `'number'`. `op` is one of =, <>, >, >=, <, <=, LIKE.
 *
 * Used by the /data/query endpoint. The CLI never sends raw predicates — it sends
 * a single where string that the SAP handler parses. The mock reuses the same
 * parsing rules (see `parseWhereClause` below) so behaviour matches the real ICF
 * service for the grammar documented in the spec.
 */
function applyWhere(rows, predicates) {
  if (!predicates || predicates.length === 0) return rows;
  return rows.filter((row) => predicates.every((p) => matchPredicate(row, p)));
}

function matchPredicate(row, p) {
  const raw = row[p.field];
  if (raw === undefined) return false;
  const left = p.valueKind === 'number' ? Number(raw) : String(raw);
  const right = p.valueKind === 'number' ? Number(p.value) : String(p.value);
  switch (p.op) {
    case '=':
      return left === right;
    case '<>':
      return left !== right;
    case '>':
      return left > right;
    case '>=':
      return left >= right;
    case '<':
      return left < right;
    case '<=':
      return left <= right;
    case 'LIKE':
      // Translate SQL LIKE (% and _) to regex.
      const re = new RegExp(
        '^' +
          String(p.value)
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')
            .replace(/%/g, '.*')
            .replace(/_/g, '.') +
          '$',
      );
      return re.test(String(raw));
    default:
      return false;
  }
}

function applyOrderBy(rows, orderBy) {
  if (!orderBy || orderBy.length === 0) return rows;
  const sorted = rows.slice();
  sorted.sort((a, b) => {
    for (const ob of orderBy) {
      const av = a[ob.field];
      const bv = b[ob.field];
      if (av === bv) continue;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return ob.direction === 'DESC' ? -cmp : cmp;
    }
    return 0;
  });
  return sorted;
}

function paginate(rows, offset, limit) {
  const safeOffset = Math.max(0, Math.floor(offset || 0));
  const safeLimit = Math.min(10000, Math.max(1, Math.floor(limit || 100)));
  return rows.slice(safeOffset, safeOffset + safeLimit);
}

// 017 Q1 B: native typed row values mirroring /ui2/cl_json serialization
// (NUMC/DEC → JSON number, DATS → YYYY-MM-DD, TIMS → HH:MM:SS, CHAR/CLNT → string).
function nativeValue(raw, def) {
  const t = def ? def.dataType : 'CHAR';
  const s = String(raw ?? '').trim();
  if (t === 'NUMC' || t === 'DEC' || t === 'QUAN' || t === 'CURR' || t === 'INT1' || t === 'INT2' || t === 'INT4' || t === 'INT8' || t === 'FLTP') {
    const n = Number(s);
    return Number.isNaN(n) ? s : n;
  }
  if (t === 'DATS' && /^\d{8}$/.test(s)) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }
  if (t === 'TIMS' && /^\d{6}$/.test(s)) {
    return `${s.slice(0, 2)}:${s.slice(2, 4)}:${s.slice(4, 6)}`;
  }
  return String(raw ?? '');
}

function projectFields(rows, fields, fieldDefs) {
  const defByName = new Map((fieldDefs || []).map((f) => [f.name, f]));
  return rows.map((row) => {
    const projected = {};
    for (const f of fields) projected[f] = nativeValue(row[f], defByName.get(f));
    return projected;
  });
}

function addObject(name, type, objectUrl, description, parts, opts = {}) {
  const obj = {
    name,
    type,
    objectUrl,
    description,
    packageName: opts.packageName ?? '$TMP',
    active: true,
    // Tracks whether the object is awaiting activation (mirrors real SAP
    // post-createObject semantics). Newly-created objects default to
    // inactive:false so the existing create happy-path tests continue to
    // pass; the createObject POST handler flips this to true on create.
    inactive: false,
    lockedBy: opts.lockedBy ?? null, // { user, lockHandle }
    programType: opts.programType ?? '1', // ADT program:programType
    parts,
  };
  objects.set(name, obj);
  return obj;
}

// Search pagination fixtures (US1/SC-001): 25 ZPAGE_* objects + exact "ZPAGE".
// Inserted FIRST so bounded search windows reach the package members early
// (search returns insertion order in this mock).
for (let i = 1; i <= 25; i++) {
  const name = `ZPAGE_${String(i).padStart(2, '0')}`;
  addObject(name, 'PROG', `/sap/bc/adt/programs/programs/${name.toLowerCase()}`, `Paged object ${i}`, [
    {
      subtype: 'main',
      sourceUrl: `/sap/bc/adt/programs/programs/${name.toLowerCase()}/source/main`,
      content: `REPORT ${name.toLowerCase()}.\n`,
    },
  ], { packageName: i <= 5 ? 'ZPKG' : '$TMP' });
}
addObject('ZPAGE', 'PROG', '/sap/bc/adt/programs/programs/zpage', 'Exact match for ZPAGE', [
  {
    subtype: 'main',
    sourceUrl: '/sap/bc/adt/programs/programs/zpage/source/main',
    content: 'REPORT zpage.\n',
  },
], { packageName: 'ZPKG' });

// Remote-only object (US4/SC-004): exists on the mock SAP side, no local counterpart.
addObject('ZREMOTE_ONLY', 'PROG', '/sap/bc/adt/programs/programs/zremote_only', 'Remote-only object', [
  {
    subtype: 'main',
    sourceUrl: '/sap/bc/adt/programs/programs/zremote_only/source/main',
    content: 'REPORT zremote_only.\n',
  },
]);

addObject('ZCL_DEMO', 'CLAS', '/sap/bc/adt/oo/classes/zcl_demo', 'Demo class for mock testing', [
  {
    subtype: 'main',
    sourceUrl: '/sap/bc/adt/oo/classes/zcl_demo/source/main',
    content:
      'CLASS zcl_demo DEFINITION PUBLIC.\n' +
      '  PUBLIC SECTION.\n' +
      '    METHODS hello.\n' +
      'ENDCLASS.\n' +
      'CLASS zcl_demo IMPLEMENTATION.\n' +
      '  METHOD hello.\n' +
      '  ENDMETHOD.\n' +
      'ENDCLASS.\n',
  },
  {
    subtype: 'implementations',
    sourceUrl: '/sap/bc/adt/oo/classes/zcl_demo/source/locals_imp',
    content: '',
  },
]);

addObject('ZCL_SYNTAX_ERROR', 'CLAS', '/sap/bc/adt/oo/classes/zcl_syntax_error', 'Class with a syntax error', [
  {
    subtype: 'main',
    sourceUrl: '/sap/bc/adt/oo/classes/zcl_syntax_error/source/main',
    content:
      'CLASS zcl_syntax_error DEFINITION PUBLIC.\n' +
      '  PUBLIC SECTION.\n' +
      '    DATA bad TYPE syntax_error.\n' +
      'ENDCLASS.\n',
  },
  {
    subtype: 'implementations',
    sourceUrl: '/sap/bc/adt/oo/classes/zcl_syntax_error/source/locals_imp',
    content: '',
  },
]);

// Multi-include class (T002/SC-004): main + definitions + implementations with distinct
// content, so `inspect --includes` / `diff` per-part scenarios have fixtures.
addObject('ZCL_MULTI', 'CLAS', '/sap/bc/adt/oo/classes/zcl_multi', 'Class with multiple includes', [
  {
    subtype: 'main',
    sourceUrl: '/sap/bc/adt/oo/classes/zcl_multi/source/main',
    content:
      'CLASS zcl_multi DEFINITION PUBLIC.\n' +
      '  PUBLIC SECTION.\n' +
      '    METHODS run.\n' +
      'ENDCLASS.\n',
  },
  {
    subtype: 'definitions',
    sourceUrl: '/sap/bc/adt/oo/classes/zcl_multi/source/locals_def',
    content: 'DATA: gv_multi TYPE i.\n',
  },
  {
    subtype: 'implementations',
    sourceUrl: '/sap/bc/adt/oo/classes/zcl_multi/source/locals_imp',
    content: 'CLASS zcl_multi IMPLEMENTATION.\n  METHOD run.\n  ENDMETHOD.\nENDCLASS.\n',
  },
]);

addObject('ZCL_LOCKED', 'CLAS', '/sap/bc/adt/oo/classes/zcl_locked', 'Class locked by another user', [
  {
    subtype: 'main',
    sourceUrl: '/sap/bc/adt/oo/classes/zcl_locked/source/main',
    content: 'CLASS zcl_locked DEFINITION PUBLIC.\nENDCLASS.\n',
  },
  {
    subtype: 'implementations',
    sourceUrl: '/sap/bc/adt/oo/classes/zcl_locked/source/locals_imp',
    content: '',
  },
], { lockedBy: { user: 'OTHER', lockHandle: 'lock-other' } });

addObject('ZPROG', 'PROG/P', '/sap/bc/adt/programs/programs/zprog', 'Demo report', [
  {
    subtype: 'main',
    sourceUrl: '/sap/bc/adt/programs/programs/zprog/source/main',
    content: "REPORT zprog.\nWRITE: / 'hello mock'.\n",
  },
], { programType: 'executableProgram' });

addObject('ZPROG_TOP', 'PROG/I', '/sap/bc/adt/programs/includes/zprog_top', 'Demo include', [
  {
    subtype: 'main',
    sourceUrl: '/sap/bc/adt/programs/includes/zprog_top/source/main',
    content: "TABLES: t001.\n",
  },
], { programType: 'I' });

// 032 US12: 4 fixture objects (INTF/FUGR/TABL/STRU) for textpool multi-language
// pulls. CLAS already exists above (ZCL_DEMO).
addObject('ZIF_DEMO', 'INTF', '/sap/bc/adt/oo/interfaces/zif_demo', 'Demo interface', [
  {
    subtype: 'main',
    sourceUrl: '/sap/bc/adt/oo/interfaces/zif_demo/source/main',
    content: 'INTERFACE zif_demo PUBLIC.\nENDINTERFACE.\n',
  },
]);
addObject('ZFG_DEMO', 'FUGR', '/sap/bc/adt/functiongroups/zfg_demo', 'Demo function group', [
  {
    subtype: 'main',
    sourceUrl: '/sap/bc/adt/functiongroups/zfg_demo/source/main',
    content: 'FUNCTION-POOL zfg_demo.\n',
  },
]);
addObject('ZTB_DEMO', 'TABL', '/sap/bc/adt/ddic/tables/ztb_demo', 'Demo table', [
  {
    subtype: 'main',
    sourceUrl: '/sap/bc/adt/ddic/tables/ztb_demo/source/main',
    content: '',
  },
]);
addObject('ZST_DEMO', 'STRU', '/sap/bc/adt/ddic/structures/zst_demo', 'Demo structure', [
  {
    subtype: 'main',
    sourceUrl: '/sap/bc/adt/ddic/structures/zst_demo/source/main',
    content: '',
  },
]);

// 015: remote (Version Management) sources served by /version-source — keyed TYPE:NAME.
remoteSourceStore.set('REPS:ZPROG', "REPORT zprog.\nWRITE: / 'production version'.\n");
remoteSourceStore.set('INTF:ZIF_DEMO', 'INTERFACE zif_demo.\n  METHODS run.\nENDINTERFACE.\n');
remoteSourceStore.set('CLSD:ZCL_DEMO', 'CLASS zcl_demo DEFINITION PUBLIC.\n  PUBLIC SECTION.\n    METHODS run.\nENDCLASS.\n');

// 032 US12: textpool fixtures for the 5 supported types — multi-language symbols
// (texts). Each object has at least one category populated; categories that are
// intentionally empty for that type exercise the TEXTPOOL_OBJECT_NOT_FOUND soft
// warning path. Keys are TYPE:NAME:category.
textpoolStore.set('CLAS:ZCL_DEMO:symbols', [
  { id: '001', text: 'Hello from ZCL_DEMO (en)' },
]);
textpoolStore.set('CLAS:ZCL_DEMO:headings', [
  { id: 'COLUMNHEADER_1', text: 'Column 1 (en)' },
]);
// CLAS intentionally has no selections — exercises TEXTPOOL_CATEGORY_MISSING warning.

textpoolStore.set('INTF:ZIF_DEMO:symbols', [
  { id: '001', text: 'Interface demo (en)' },
]);
textpoolStore.set('INTF:ZIF_DEMO:headings', [
  { id: 'LISTHEADER', text: 'Interface list header (en)' },
]);

textpoolStore.set('FUGR:ZFG_DEMO:symbols', [
  { id: '001', text: 'Function group demo (en)' },
]);
// FUGR typically has no headings — exercises TEXTPOOL_CATEGORY_MISSING warning.

textpoolStore.set('TABL:ZTB_DEMO:symbols', [
  { id: '001', text: 'Table demo (en)' },
]);
textpoolStore.set('TABL:ZTB_DEMO:headings', [
  { id: 'COLUMNHEADER_1', text: 'Field 1 (en)' },
  { id: 'COLUMNHEADER_2', text: 'Field 2 (en)' },
]);
textpoolStore.set('TABL:ZTB_DEMO:selections', [
  { id: 'P_LANG', text: 'Language (en)' },
]);

textpoolStore.set('STRU:ZST_DEMO:symbols', [
  { id: '001', text: 'Structure demo (en)' },
]);
// STRU has no selections/headings — exercises TEXTPOOL_CATEGORY_MISSING warning.

// SM59: one non-HTTP destination fixture (RFCTYPE='3' = R/3 connection). The
// bundled /sm59 route only manages RFCTYPE='G' destinations, so pull / push /
// delete of this name must answer SM59_TYPE_NOT_SUPPORTED instead of touching it.
sm59OtherTypeStore.set('ZCLI_MOCK_SM59_RFC', {
  name: 'ZCLI_MOCK_SM59_RFC',
  type: '3',
  description: 'R/3 connection fixture (not an HTTP destination)',
});

// ICF service classes (013): handler + setup, targets for deploy enumeration / classrun.
addObject('ZCL_ABAP_VIBE_ICF', 'CLAS', '/sap/bc/adt/oo/classes/zcl_abap_vibe_icf', 'ICF handler for abap_cli', [
  {
    subtype: 'main',
    sourceUrl: '/sap/bc/adt/oo/classes/zcl_abap_vibe_icf/source/main',
    content:
      'CLASS zcl_abap_vibe_icf DEFINITION PUBLIC.\n' +
      '  PUBLIC SECTION.\n' +
      '    INTERFACES if_http_extension.\n' +
      'ENDCLASS.\n' +
      'CLASS zcl_abap_vibe_icf IMPLEMENTATION.\n' +
      'ENDCLASS.\n',
  },
  {
    subtype: 'implementations',
    sourceUrl: '/sap/bc/adt/oo/classes/zcl_abap_vibe_icf/source/locals_imp',
    content: '',
  },
]);

addObject('ZCL_ABAP_VIBE_ICF_SETUP', 'CLAS', '/sap/bc/adt/oo/classes/zcl_abap_vibe_icf_setup', 'ICF setup class', [
  {
    subtype: 'main',
    sourceUrl: '/sap/bc/adt/oo/classes/zcl_abap_vibe_icf_setup/source/main',
    content:
      'CLASS zcl_abap_vibe_icf_setup DEFINITION PUBLIC.\n' +
      '  PUBLIC SECTION.\n' +
      '    INTERFACES if_oo_adt_classrun.\n' +
      'ENDCLASS.\n' +
      'CLASS zcl_abap_vibe_icf_setup IMPLEMENTATION.\n' +
      'ENDCLASS.\n',
  },
  {
    subtype: 'implementations',
    sourceUrl: '/sap/bc/adt/oo/classes/zcl_abap_vibe_icf_setup/source/locals_imp',
    content: '',
  },
]);

const byObjectUrl = (path) => [...objects.values()].find((o) => o.objectUrl === path);
// Match either the object's own objectUrl or any of its source URLs. Used
// by the activation handler, which receives the sourceUri of the
// method/OSI part (not the root objectUrl) in the request body.
const byAnyUrl = (path) => {
  const norm = path.split('?')[0];
  return [...objects.values()].find(
    (o) => o.objectUrl === norm || o.parts.some((p) => p.sourceUrl === norm),
  );
};
const bySourceUrl = (path) => {
  for (const o of objects.values()) {
    const part = o.parts.find((p) => p.sourceUrl === path);
    if (part) return { owner: o, part };
  }
  return undefined;
};

// ---------- object creation (ADT createObject) ----------
// abap-adt-api POSTs to the creation path (e.g. /sap/bc/adt/oo/classes) with the
// object name inside the XML body; only group types use a %s parent placeholder.
const CREATE_ROUTES = [
  { path: '/sap/bc/adt/oo/classes', type: 'CLAS', urlBase: '/sap/bc/adt/oo/classes/' },
  { path: '/sap/bc/adt/oo/interfaces', type: 'INTF', urlBase: '/sap/bc/adt/oo/interfaces/' },
  { path: '/sap/bc/adt/programs/programs', type: 'PROG', urlBase: '/sap/bc/adt/programs/programs/' },
  { path: '/sap/bc/adt/functions/groups', type: 'FUGR', urlBase: '/sap/bc/adt/functions/groups/' },
];

// Minimal activatable skeleton matching what the CLI writes (see create.ts).
function skeletonContent(type, name) {
  if (type === 'CLAS') {
    return `CLASS ${name} DEFINITION PUBLIC.\n  PUBLIC SECTION.\nENDCLASS.\nCLASS ${name} IMPLEMENTATION.\nENDCLASS.\n`;
  }
  if (type === 'INTF') return `INTERFACE ${name} PUBLIC.\nENDINTERFACE.\n`;
  if (type === 'FUGR') return `FUNCTION-POOL ${name}.\n`;
  return `REPORT ${name}.\n`;
}

// Classes need a second (empty) include part to avoid the single-include
// fast-xml-parser crash (see repo memory abap-adt-api-quirks).
function skeletonParts(type, name) {
  const base = CREATE_ROUTES.find((r) => r.type === type).urlBase + name.toLowerCase();
  const main = {
    subtype: 'main',
    sourceUrl: `${base}/source/main`,
    content: skeletonContent(type, name),
  };
  const parts = [main];
  if (type === 'CLAS') {
    parts.push({ subtype: 'implementations', sourceUrl: `${base}/source/locals_imp`, content: '' });
  }
  return parts;
}

// Object name is carried in the XML body (adtcore:name), not the POST URL.
function creationName(body, route) {
  const nameMatch = /adtcore:name="([^"]+)"/.exec(body);
  return (nameMatch?.[1] || '').toUpperCase();
}

// ---------- helpers ----------
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function ok(res, body, type = 'application/xml') {
  // ADT lock/PUT/activate require a stateful session; real SAP hands one out at
  // login via the SAP_SESSIONID cookie. Emit it on every response so the CLI
  // keeps the client in stateful mode (it only turns stateful when the login
  // response carries that cookie).
  res.writeHead(200, {
    'Content-Type': type,
    'Set-Cookie': [
      'SAP_SESSIONID_S4H_100=mocksession; Path=/',
      'sap-contextid=mockcontext; Path=/sap/bc/adt',
    ],
  });
  res.end(body);
}

function adtError(res, status, message) {
  const body =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<exc:exception xmlns:exc="http://www.sap.com/adt/exceptions">\n' +
    `  <type id="mockError"/>\n` +
    `  <message id="1">${esc(message)}</message>\n` +
    '</exc:exception>';
  res.writeHead(status, { 'Content-Type': 'application/xml' });
  res.end(body);
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------- response builders ----------
// Mock-internal subtype names equal ADT includeType names (abap-file-format style).
const SUBTYPE_TO_INCLUDE_TYPE = {
  main: 'main',
  definitions: 'definitions',
  implementations: 'implementations',
  macros: 'macros',
  testclasses: 'testclasses',
};

function structureXml(obj) {
  const abapLanguageVersion = process.env.MOCK_CLOUD === '1' ? 'cloudDevelopment' : 'standard';
  if (obj.type === 'CLAS') {
    const includes = obj.parts
      .map(
        (p) =>
          `    <class:include class:includeType="${SUBTYPE_TO_INCLUDE_TYPE[p.subtype]}" abapsource:sourceUri="${p.sourceUrl}" ` +
          `adtcore:name="${obj.name}" adtcore:type="${obj.type}/MA" adtcore:version="active" ` +
          `adtcore:createdAt="${NOW}" adtcore:changedAt="${NOW}" adtcore:changedBy="${CURRENT_USER}" adtcore:createdBy="${CURRENT_USER}">\n` +
          `      <atom:link href="${p.sourceUrl}" rel="self" type="text/plain"/>\n` +
          `      <atom:link href="${p.sourceUrl}" rel="edit" type="text/plain"/>\n` +
          '    </class:include>',
      )
      .join('\n');
    return (
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      `<clas:class xmlns:clas="http://www.sap.com/adt/oo/classes" xmlns:abapsource="http://www.sap.com/adt/abapsource" ` +
      `xmlns:atom="http://www.w3.org/2005/Atom" xmlns:adtcore="http://www.sap.com/adt/core" ` +
      `adtcore:name="${obj.name}" adtcore:type="${obj.type}" adtcore:uri="${obj.objectUrl}" adtcore:description="${obj.description}" ` +
      `adtcore:masterLanguage="EN" adtcore:language="EN" adtcore:masterSystem="MOCK" adtcore:version="active" adtcore:responsible="${CURRENT_USER}" ` +
      `adtcore:changedBy="${CURRENT_USER}" adtcore:createdBy="${CURRENT_USER}" adtcore:changedAt="${NOW}" adtcore:createdAt="${NOW}" ` +
      `adtcore:descriptionTextLimit="60" abapsource:activeUnicodeCheck="true" abapsource:fixPointArithmetic="true" ` +
      `abapsource:abapLanguageVersion="${abapLanguageVersion}" ` +
      `class:visibility="public" class:category="00" class:final="false" class:abstract="false" class:sharedMemoryEnabled="false">\n` +
      includes +
      '\n</clas:class>'
    );
  }
  const main = obj.parts.find((p) => p.subtype === 'main') ?? obj.parts[0];
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<prog:program xmlns:prog="http://www.sap.com/adt/programs/programs" xmlns:abapsource="http://www.sap.com/adt/abapsource" ` +
    `xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="${obj.name}" adtcore:type="${obj.type}" adtcore:uri="${obj.objectUrl}" ` +
    `adtcore:description="${obj.description}" adtcore:masterLanguage="EN" adtcore:language="EN" adtcore:masterSystem="MOCK" ` +
    `adtcore:version="active" adtcore:responsible="${CURRENT_USER}" adtcore:changedBy="${CURRENT_USER}" adtcore:createdBy="${CURRENT_USER}" ` +
    `adtcore:changedAt="${NOW}" adtcore:createdAt="${NOW}" adtcore:descriptionTextLimit="60" ` +
    `abapsource:sourceUri="${main.sourceUrl}" abapsource:abapLanguageVersion="${abapLanguageVersion}" ` +
    `program:programType="${obj.programType}" program:lockedByEditor="false"/>`
  );
}

function lockXml(lockHandle) {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<asx:abap xmlns:asx="http://www.sap.com/abapxml/types/asx">\n' +
    '  <asx:values>\n' +
    '    <DATA>\n' +
    `      <LOCK_HANDLE>${lockHandle}</LOCK_HANDLE>\n` +
    '      <CORRNR></CORRNR>\n' +
    `      <CORRUSER>${CURRENT_USER}</CORRUSER>\n` +
    '      <CORRTEXT></CORRTEXT>\n' +
    '      <IS_LOCAL>X</IS_LOCAL>\n' +
    '      <IS_LINK_UP></IS_LINK_UP>\n' +
    '      <MODIFICATION_SUPPORT></MODIFICATION_SUPPORT>\n' +
    '    </DATA>\n' +
    '  </asx:values>\n' +
    '</asx:abap>'
  );
}

// Created transports are appended to the workbench modifiable list so the CLI
// can see them after `abap transport create` (and use them via --tr).
const createdTransports = [];
let transportSeq = 1;

// ---------- ATC (check atc, US2/US3) ----------
const ATC_VARIANTS = new Map([['Z_ATC_VAR', 'Mock ATC variant']]);
const atcRuns = new Map(); // runId -> { variant, timestamp }
let atcSeq = 0;

// ---------- transport detail / assign fixtures (US5) ----------
// `transport show <req>` / `transport resolve <obj>` / `transport assign <obj> --tr <req>`.
const DETAIL_TRANSPORTS = new Map([
  ['NDK123456', { number: 'NDK123456', owner: 'MOCKUSER', desc: 'Mock request 1', status: 'D', uri: '/sap/bc/adt/cts/transportrequests/NDK123456' }],
]);
// Object → transport number as assigned via `transport assign` (or pre-seeded for resolve).
const objectTransports = new Map([['ZPROG', 'NDK123456']]);

const BASE_TRANSPORTS = NO_TRANSPORTS
  ? { workbench: { modifiable: [], released: [] }, customizing: [] }
  : {
      workbench: {
        modifiable: [
          {
            number: 'TRN001',
            owner: 'MOCKUSER',
            desc: 'Mock request 1',
            status: 'D',
            uri: '/sap/bc/adt/cts/transportrequests/TRN001',
          },
        ],
        released: [
          {
            number: 'TRN099',
            owner: 'MOCKUSER',
            desc: 'Mock released request',
            status: 'R',
            uri: '/sap/bc/adt/cts/transportrequests/TRN099',
          },
        ],
      },
      customizing: [
        {
          name: 'CUSTOMIZING',
          desc: 'Customizing requests',
          modifiable: [
            {
              number: 'TRN501',
              owner: 'MOCKUSER',
              desc: 'Mock customizing request',
              status: 'D',
              uri: '/sap/bc/adt/cts/transportrequests/TRN501',
            },
          ],
          released: [],
        },
      ],
    };

function requestXml(r) {
  return (
    `      <tm:request tm:number="${r.number}" tm:owner="${r.owner}" tm:desc="${r.desc}" ` +
    `tm:status="${r.status}" tm:uri="${r.uri}"/>\n`
  );
}

function targetXml(name, desc, modifiable, released) {
  return (
    `    <tm:target tm:name="${name}" tm:desc="${desc}">\n` +
    `      <tm:modifiable>${modifiable.map(requestXml).join('')}</tm:modifiable>\n` +
    `      <tm:released>${released.map(requestXml).join('')}</tm:released>\n` +
    '    </tm:target>\n'
  );
}

function transportXml() {
  const wb = BASE_TRANSPORTS.workbench;
  const workbench = targetXml('WORKBENCH', 'Workbench requests', [...wb.modifiable, ...createdTransports], wb.released);
  const customizing = BASE_TRANSPORTS.customizing
    .map((t) => targetXml(t.name, t.desc, t.modifiable, t.released))
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<tm:root xmlns:tm="http://www.sap.com/adt/transport">\n' +
    `  <tm:workbench>${workbench}  </tm:workbench>\n` +
    `  <tm:customizing>${customizing}  </tm:customizing>\n` +
    '</tm:root>'
  );
}

// Deterministic validator: standalone identifier "syntax_error" → E, "syntax_warning" → W
// (identifier boundaries exclude longer names such as zcl_syntax_error)
function validateSource(content) {
  const issues = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const isError = /(^|[^a-z0-9_])syntax_error([^a-z0-9_]|$)/i.test(lines[i]);
    const isWarning = /(^|[^a-z0-9_])syntax_warning([^a-z0-9_]|$)/i.test(lines[i]);
    if (isError) {
      issues.push({ line: i + 1, type: 'E', shortText: 'Unknown identifier "syntax_error"' });
    } else if (isWarning) {
      issues.push({ line: i + 1, type: 'W', shortText: 'Suspicious statement' });
    }
  }
  return issues;
}

function checkXml(sourceUrl, inclUrl, issues) {
  const messages = issues
    .map(
      (m) =>
        `      <chkrun:checkMessage chkrun:uri="${inclUrl}#start=${m.line},1" chkrun:type="${m.type}" ` +
        `chkrun:shortText="${esc(m.shortText)}"/>`,
    )
    .join('\n');
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<chkrun:checkRunReports xmlns:chkrun="http://www.sap.com/adt/checkrun">\n' +
    `  <chkrun:checkReport chkrun:uri="${sourceUrl}">\n` +
    '    <chkrun:checkMessageList>\n' +
    (messages ? `${messages}\n` : '') +
    '    </chkrun:checkMessageList>\n' +
    '  </chkrun:checkReport>\n' +
    '</chkrun:checkRunReports>'
  );
}

// createAtcRun response: worklistRun with worklistId / worklistTimestamp / infos.
function atcRunXml(runId, variant) {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<atc:worklistRun xmlns:atc="http://www.sap.com/adt/atc">\n' +
    `  <atc:worklistId>${runId}</atc:worklistId>\n` +
    `  <atc:worklistTimestamp>${NOW}</atc:worklistTimestamp>\n` +
    '  <atc:infos>\n' +
    `    <atc:info atc:type="INFO" atc:description="Mock run for ${esc(variant)}"/>\n` +
    '  </atc:infos>\n' +
    '</atc:worklistRun>\n'
  );
}

// atcWorklists response: worklist with objects/findings (deterministic per fixture).
function atcWorklistXml(run) {
  const findings = [
    {
      uri: '/sap/bc/adt/oo/classes/zcl_ok/source/main',
      location: '/sap/bc/adt/oo/classes/zcl_ok/source/main#start=3,1;end=3,10',
      priority: '2',
      checkId: 'check_style',
      checkTitle: 'Style check',
      messageId: 'MSG001',
      messageTitle: 'Method is too long',
      exemptionApproval: '',
      exemptionKind: '',
      checksum: '123456',
      quickfixInfo: '',
      linkHref: '/sap/bc/adt/atc/findings/1',
    },
  ];
  const findingXml = findings
    .map(
      (f) =>
        `        <atc:finding atc:uri="${f.uri}" atc:location="${f.location}" atc:priority="${f.priority}" ` +
        `atc:checkId="${f.checkId}" atc:checkTitle="${f.checkTitle}" atc:messageId="${f.messageId}" ` +
        `atc:messageTitle="${esc(f.messageTitle)}" atc:exemptionApproval="${f.exemptionApproval}" ` +
        `atc:exemptionKind="${f.exemptionKind}" atc:checksum="${f.checksum}" atc:quickfixInfo="${f.quickfixInfo}">\n` +
        `          <atom:link href="${f.linkHref}" rel="self" type="application/xml"/>\n` +
        '        </atc:finding>\n',
    )
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<atc:worklist xmlns:atc="http://www.sap.com/adt/atc" xmlns:atom="http://www.w3.org/2005/Atom" ' +
    `atc:id="WL001" atc:timestamp="${NOW}" atc:usedObjectSet="${run.variant}" atc:objectSetIsComplete="true">\n` +
    '  <atc:objectSets>\n' +
    `    <atc:objectSet atc:name="${run.variant}" atc:title="Mock ATC variant" atc:kind="inclusive"/>\n` +
    '  </atc:objectSets>\n' +
    '  <atc:objects>\n' +
    '    <atc:object atc:uri="/sap/bc/adt/oo/classes/zcl_ok" atc:type="CLAS/OC" atc:name="ZCL_OK" ' +
    'atc:packageName="$TMP" atc:author="MOCKUSER" atc:objectTypeId="CLAS/OC">\n' +
    '      <atc:findings>\n' +
    findingXml +
    '      </atc:findings>\n' +
    '    </atc:object>\n' +
    '  </atc:objects>\n' +
    '</atc:worklist>\n'
  );
}

// transportDetails response (GET /sap/bc/adt/cts/transportrequests/<number>).
// parseRequest reads tm:abap_object children of the tm:request element itself.
function transportDetailsXml(req) {
  const task = {
    number: `${req.number}T1`,
    owner: req.owner,
    desc: req.desc,
    status: req.status,
    uri: `${req.uri}/tasks/${req.number}T1`,
  };
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<tm:root xmlns:tm="http://www.sap.com/adt/transport" xmlns:atom="http://www.w3.org/2005/Atom">\n' +
    `  <tm:request tm:number="${req.number}" tm:owner="${req.owner}" tm:desc="${esc(req.desc)}" ` +
    `tm:status="${req.status}" tm:uri="${req.uri}">\n` +
    '      <tm:abap_object tm:name="ZCL_DEMO" tm:type="CLAS/OC" tm:obj_info="Active"/>\n' +
    '      <tm:abap_object tm:name="ZPROG" tm:type="PROG/P" tm:obj_info="Active"/>\n' +
    `    <tm:task tm:number="${task.number}" tm:owner="${task.owner}" tm:desc="${esc(task.desc)}" ` +
    `tm:status="${task.status}" tm:uri="${task.uri}">\n` +
    `      <atom:link href="${task.uri}" rel="self" type="application/xml"/>\n` +
    '    </tm:task>\n' +
    '  </tm:request>\n' +
    '</tm:root>\n'
  );
}

// transportInfo response (POST /sap/bc/adt/cts/transportchecks).
function transportInfoXml(transports) {
  const reqs = transports
    .map(
      (t) =>
        `      <CTS_REQUEST>\n        <REQ_HEADER>\n` +
        `          <TRKORR>${t.number}</TRKORR>\n` +
        `          <TRSTATUS>${t.status}</TRSTATUS>\n` +
        `          <AS4USER>${t.owner}</AS4USER>\n` +
        `          <AS4TEXT>${esc(t.desc)}</AS4TEXT>\n` +
        `        </REQ_HEADER>\n      </CTS_REQUEST>\n`,
    )
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">\n' +
    '  <asx:values>\n' +
    '    <DATA>\n' +
    '      <REQUESTS>\n' +
    reqs +
    '      </REQUESTS>\n' +
    '    </DATA>\n' +
    '  </asx:values>\n' +
    '</asx:abap>\n'
  );
}

// validateNewObject response (POST /sap/bc/adt/oo/validation/objectname).
function validateXml(severity, shortText, checkResult) {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">\n' +
    '  <asx:values>\n' +
    '    <DATA>\n' +
    `      <SEVERITY>${severity}</SEVERITY>\n` +
    `      <SHORT_TEXT>${esc(shortText)}</SHORT_TEXT>\n` +
    `      <CHECK_RESULT>${checkResult}</CHECK_RESULT>\n` +
    '    </DATA>\n' +
    '  </asx:values>\n' +
    '</asx:abap>\n'
  );
}

// ---------- DEVC (package) fixtures ----------

/**
 * Seed the fixture package tree. Mirrors the real S/4HANA shapes captured from
 * `/sap/bc/adt/packages/<name>`:
 *   $TMP   → LOCAL software component, development, no super package
 *   ZLOCAL → ZLOCAL software component, cloud ABAP language version (5)
 *   ZDEV   → sub package of ZLOCAL (superPackage + inherited software component)
 *   /MOCK/SWITCHED → namespaced, switch assignment, application component and
 *                    two use accesses
 */
function addPackage(pkg) {
  const name = pkg.name.toUpperCase();
  packages.set(name, {
    name,
    description: pkg.description,
    packageType: pkg.packageType ?? 'development',
    superPackage: pkg.superPackage ?? '',
    switchName: pkg.switchName ?? '',
    applicationComponent: pkg.applicationComponent ?? '',
    softwareComponent: pkg.softwareComponent ?? 'LOCAL',
    transportLayer: pkg.transportLayer ?? '',
    languageVersion: pkg.languageVersion ?? '',
    recordChanges: pkg.recordChanges ?? true,
    addingObjectsAllowed: pkg.addingObjectsAllowed ?? true,
    encapsulated: pkg.encapsulated ?? false,
    masterLanguage: pkg.masterLanguage ?? 'EN',
    useAccesses: pkg.useAccesses ?? [],
  });
  return packages.get(name);
}

addPackage({
  name: '$TMP',
  description: 'Temporary Objects (never transported!)',
  packageType: 'development',
  softwareComponent: 'LOCAL',
  recordChanges: false,
  addingObjectsAllowed: false,
  masterLanguage: 'ZH',
});
addPackage({
  name: 'ZLOCAL',
  description: 'local mock package',
  packageType: 'development',
  softwareComponent: 'ZLOCAL',
  languageVersion: '5',
  encapsulated: true,
});
addPackage({
  name: 'ZDEV',
  description: 'mock dev package',
  packageType: 'development',
  superPackage: 'ZLOCAL',
  softwareComponent: 'ZLOCAL',
  languageVersion: '5',
  encapsulated: true,
});
addPackage({
  name: '/MOCK/SWITCHED',
  description: 'mock switched package',
  packageType: 'main',
  superPackage: '/MOCK/MAIN',
  switchName: '/MOCK/SWITCH_ECC',
  applicationComponent: 'BC-SRV',
  softwareComponent: 'HOME',
  transportLayer: 'SAP',
  useAccesses: [
    { packageInterface: 'SABP_MAIN_PUBLIC', severity: 'none' },
    { packageInterface: 'SABP_UNIT_PUBLIC', severity: 'warning' },
  ],
});
addPackage({
  name: '/MOCK/MAIN',
  description: 'mock main package',
  packageType: 'main',
  softwareComponent: 'HOME',
  transportLayer: 'SAP',
});

/** Render the `pak:package` wire XML for one fixture package. */
function packageXml(pkg) {
  const useAccesses = pkg.useAccesses.length
    ? `<pak:useAccesses pak:isVisible="true">` +
      pkg.useAccesses
        .map(
          (u) =>
            `<pak:useAccess pak:severity="${esc(u.severity)}">` +
            `<pak:packageInterfaceRef adtcore:type="PINF/KI" adtcore:name="${esc(u.packageInterface)}"/>` +
            `</pak:useAccess>`,
        )
        .join('') +
      '</pak:useAccesses>'
    : '<pak:useAccesses pak:isVisible="false"/>';
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    `<pak:package xmlns:pak="http://www.sap.com/adt/packages" xmlns:adtcore="http://www.sap.com/adt/core" ` +
    `adtcore:responsible="${CURRENT_USER}" adtcore:masterLanguage="${pkg.masterLanguage}" ` +
    `adtcore:name="${esc(pkg.name)}" adtcore:type="DEVC/K" adtcore:version="active" ` +
    `adtcore:description="${esc(pkg.description)}" adtcore:descriptionTextLimit="60" adtcore:language="${pkg.masterLanguage}" ` +
    `adtcore:createdAt="${NOW}" adtcore:changedAt="${NOW}" adtcore:createdBy="${CURRENT_USER}" adtcore:changedBy="${CURRENT_USER}">` +
    `<adtcore:packageRef adtcore:uri="/sap/bc/adt/packages/${encodeURIComponent(pkg.name.toLowerCase())}" adtcore:type="DEVC/K" adtcore:name="${esc(pkg.name)}" adtcore:description="${esc(pkg.description)}"/>` +
    `<pak:attributes pak:packageType="${pkg.packageType}" pak:isAddingObjectsAllowed="${pkg.addingObjectsAllowed ? 'true' : 'false'}" ` +
    `pak:isEncapsulated="${pkg.encapsulated ? 'true' : 'false'}" pak:recordChanges="${pkg.recordChanges ? 'true' : 'false'}" ` +
    `pak:isSwitchVisible="${pkg.switchName ? 'true' : 'false'}" pak:languageVersion="${pkg.languageVersion}"/>` +
    (pkg.superPackage
      ? `<pak:superPackage adtcore:type="DEVC/K" adtcore:name="${esc(pkg.superPackage)}"/>`
      : '<pak:superPackage/>') +
    (pkg.switchName
      ? `<pak:switch adtcore:type="SFSW/6S" adtcore:name="${esc(pkg.switchName)}" adtcore:description="mock switch"/>`
      : '') +
    (pkg.applicationComponent
      ? `<pak:applicationComponent pak:name="${esc(pkg.applicationComponent)}" pak:description="Mock component"/>`
      : '<pak:applicationComponent pak:name=""/>') +
    `<pak:transport>` +
    `<pak:softwareComponent pak:name="${esc(pkg.softwareComponent)}"/>` +
    `<pak:transportLayer pak:name="${esc(pkg.transportLayer)}"/>` +
    `</pak:transport>` +
    '<pak:translation/>' +
    useAccesses +
    '<pak:packageInterfaces pak:isVisible="false"/>' +
    '<pak:subPackages/>' +
    '</pak:package>'
  );
}

/** Real-SAP package validation rules (verified against S/4HANA). */
function packageValidationError(name, softwareComponent) {
  if (!name) return 'No package name specified';
  if (!softwareComponent) return 'No software component specified';
  if (softwareComponent.toUpperCase() === 'LOCAL' && !/^(\$|TEST)/.test(name.toUpperCase())) {
    return "Names of LOCAL packages must start with '$' or 'TEST'";
  }
  if (packages.has(name.toUpperCase())) return `Package ${name.toUpperCase()} already exists`;
  return undefined;
}


// ---------- server ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  const q = url.searchParams;

  try {
    // login / compatibility
    if (path === '/sap/bc/adt/compatibility/graph') {
      if (AUTH_FAIL) return adtError(res, 401, 'Simulated auth failure (MOCK_AUTH_FAIL=1)');
      return ok(res, '{}', 'application/json');
    }

    // Stateful session teardown: modern SAP closes the context through this
    // resource; a real close resets sap-contextid to 0.
    if (path === '/sap/bc/adt/core/http/sessions' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/plain',
        'Set-Cookie': 'sap-contextid=0; Path=/sap/bc/adt',
      });
      res.end('');
      return;
    }

    // Legacy ICF logoff stays available for the fallback path.
    if (path === '/sap/public/bc/icf/logoff') {
      res.writeHead(200, {
        'Content-Type': 'text/plain',
        'Set-Cookie': 'sap-contextid=0; Path=/sap/bc/adt',
      });
      res.end('');
      return;
    }

    // ADT service document / discovery — used by `abap doctor` and the
    // runtime probe (`probeAdtRuntime`) as a lightweight reachability +
    // capability check. Real SAP returns an Atom service document with
    // workspace/collection children; we mirror the minimal subset the CLI
    // actually parses (href + title per collection) so the doctor check
    // reports conn.mock=ok instead of SAP_ERROR.
    if (path === '/sap/bc/adt/discovery' && req.method === 'GET') {
      const xml =
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<app:service xmlns:app="http://www.w3.org/2007/app" ' +
        'xmlns:atom="http://www.w3.org/2005/Atom" ' +
        'xmlns:sap="http://www.sap.com/adt/xmlns/sap">\n' +
        '  <app:workspace>\n' +
        '    <atom:title>ADT Workspace</atom:title>\n' +
        '    <app:collection href="/sap/bc/adt/oo/classes"><atom:title>ABAP Classes</atom:title></app:collection>\n' +
        '    <app:collection href="/sap/bc/adt/oo/interfaces"><atom:title>ABAP Interfaces</atom:title></app:collection>\n' +
        '    <app:collection href="/sap/bc/adt/programs/programs"><atom:title>ABAP Programs</atom:title></app:collection>\n' +
        '    <app:collection href="/sap/bc/adt/functions/groups"><atom:title>Function Groups</atom:title></app:collection>\n' +
        '    <app:collection href="/sap/bc/adt/icf/sicf"><atom:title>ICF (SICF)</atom:title></app:collection>\n' +
        '    <app:collection href="/sap/bc/adt/ddic/tables"><atom:title>DDIC Tables</atom:title></app:collection>\n' +
        '    <app:collection href="/sap/bc/adt/cts/transportrequests"><atom:title>Transport Organizer</atom:title></app:collection>\n' +
        '  </app:workspace>\n' +
        '</app:service>';
      return ok(res, xml, 'application/atomsvc+xml');
    }

    // ---------- DEVC (package) endpoints ----------
    // Shapes mirror the real S/4HANA package resource: GET returns
    // `pak:package`, create is POST /sap/bc/adt/packages, the name preflight is
    // POST /sap/bc/adt/packages/validation, delete is a bare DELETE (no lock),
    // and PUT is rejected by the resource controller.
    if (path === '/sap/bc/adt/packages/validation' && req.method === 'POST') {
      const name = (q.get('objname') || '').toUpperCase();
      const softwareComponent = q.get('swcomp') || '';
      const error = packageValidationError(name, softwareComponent);
      return ok(res, validateXml(error ? 'ERROR' : 'OK', error ?? '', ''), 'application/xml');
    }

    if (path === '/sap/bc/adt/packages' && req.method === 'POST') {
      const body = await readBody(req);
      const attrOf = (tag, attribute) => {
        const tagMatch = new RegExp(`<(?:pak|adtcore):${tag}\\b([^>]*)`).exec(body);
        const value = tagMatch ? new RegExp(`${attribute}="([^"]*)"`).exec(tagMatch[1]) : null;
        return value ? value[1] : '';
      };
      const name = attrOf('package', 'adtcore:name').toUpperCase();
      const description = attrOf('package', 'adtcore:description');
      const superPackage = (attrOf('packageRef', 'adtcore:name') || '').toUpperCase();
      const softwareComponent = attrOf('softwareComponent', 'pak:name').toUpperCase();
      const transportLayer = attrOf('transportLayer', 'pak:name').toUpperCase();
      const packageType = (attrOf('attributes', 'pak:packageType') || 'development').toLowerCase();
      const error = packageValidationError(name, softwareComponent);
      if (error) return adtError(res, 400, error);
      const created = addPackage({
        name,
        description,
        packageType,
        superPackage,
        softwareComponent,
        transportLayer,
        masterLanguage: 'EN',
        addingObjectsAllowed: false,
      });
      res.writeHead(201, { 'Content-Type': 'application/vnd.sap.adt.packages.v2+xml; charset=utf-8' });
      return res.end(packageXml(created));
    }

    if (path.startsWith('/sap/bc/adt/packages/') && req.method !== 'POST') {
      const rawName = decodeURIComponent(path.slice('/sap/bc/adt/packages/'.length));
      const pkg = packages.get(rawName.toUpperCase());
      if (req.method === 'GET') {
        if (!pkg) return adtError(res, 404, `从数据库导入对象 ${rawName} 时出错`);
        return ok(res, packageXml(pkg), 'application/vnd.sap.adt.packages.v2+xml');
      }
      if (req.method === 'PUT') {
        // Real SAP: resource controller rejects PUT for packages outright.
        return adtError(res, 405, 'Resource controller does not support method PUT');
      }
      if (req.method === 'DELETE') {
        if (!pkg) return adtError(res, 404, `包 ${rawName} 不存在`);
        const hasChildren = [...packages.values()].some((p) => p.superPackage === pkg.name);
        if (hasChildren) return adtError(res, 400, `包 ${pkg.name} 含有子包，无法删除`);
        packages.delete(pkg.name);
        return ok(res, '', 'application/xml');
      }
    }

    // self-built ICF service root (probeIcf target for `profile test` / `doctor`)
    if (path === '/sap/abap_cli/') {
      if (ICF_FAIL) return adtError(res, 500, 'Simulated ICF failure (MOCK_ICF_FAIL=1)');
      return ok(res, JSON.stringify({ status: 'success', data: { service: 'abap_cli', version: ICF_SERVICE_VERSION } }), 'application/json');
    }

    // /sap/abap_cli/whoami — system-side identity of the authenticated session
    // (`abap whoami`). Mirrors the ABAP handler's sy-* projection.
    if (path === '/sap/abap_cli/whoami' && req.method === 'GET') {
      if (ICF_OLD) {
        const body = JSON.stringify({
          status: 'error',
          error: { code: 'NOT_FOUND', message: 'unknown path: /sap/abap_cli/whoami' },
        });
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(body);
      }
      const identity = {
        user: CURRENT_USER,
        systemId: 'S4H',
        client: '100',
        applicationServer: 'mockhost',
        database: 'HDB',
        os: 'Linux',
        abapRelease: '757',
      };
      return ok(res, JSON.stringify({ status: 'success', data: identity }), 'application/json');
    }

    // ADT classrun (runClass) — simulates the remote ICF setup execution (013)
    // and the runner wrapper execution (015).
    const classrun = /^\/sap\/bc\/adt\/oo\/classrun\/([^/?]+)/.exec(path);
    if (classrun && req.method === 'POST') {
      const className = classrun[1].toUpperCase();
      if (className === 'ZCL_ABAP_VIBE_ICF_SETUP') {
        if (SETUP_FAIL) return ok(res, JSON.stringify({ status: 'error', error: { code: 'ICF_ADMIN_REQUIRED', message: 'Simulated setup failure (MOCK_SETUP_FAIL=1)' } }), 'application/json');
        return ok(res, JSON.stringify({ status: 'success', action: 'already_active', node: { vhost: 'default_host', url: '/sap/abap_cli', handler: 'ZCL_ABAP_VIBE_ICF', active: true } }), 'application/json');
      }
      // 015: ZCL_ABAP_VIBE_RUNNER — read body params (IV_TARGET_CLASS /
      // IV_METHOD_NAME / IV_ARGS_JSON / IV_TIMEOUT_MS), dispatch fixtures.
      if (className === 'ZCL_ABAP_VIBE_RUNNER') {
        if (process.env.MOCK_WRAPPER_NOT_DEPLOYED === '1') {
          return adtError(res, 404, 'ZCL_ABAP_VIBE_RUNNER does not exist (MOCK_WRAPPER_NOT_DEPLOYED=1)');
        }
        const rawBody = await readBody(req);
        let params = [];
        try { params = JSON.parse(rawBody); } catch (_e) { params = []; }
        const kv = Object.fromEntries(
          (Array.isArray(params) ? params : []).map((p) => [p.name, p.value]),
        );
        const target = (kv.IV_TARGET_CLASS || '').toUpperCase();
        const method = kv.IV_METHOD_NAME || '';

        // No --method branch: heartbeat.
        if (!method) {
          return ok(res, JSON.stringify({ status: 'ok', exitCode: 0, message: 'classrun heartbeat' }), 'application/json');
        }

        // Sleep fixture for timeout tests.
        if (target === 'ZCL_FAKE_SLEEP' || method === 'sleep') {
          await new Promise((r) => setTimeout(r, 60000));
          return ok(res, JSON.stringify({ status: 'ok', method, exitCode: 0 }), 'application/json');
        }

        // Lock fixture (HTTP 423).
        if (method === 'lock') {
          res.statusCode = 423;
          res.setHeader('Content-Type', 'text/plain');
          return res.end('locked');
        }

        // Error fixtures keyed by method name.
        if (method === 'unsupported') {
          return ok(res, JSON.stringify({
            status: 'error', code: 'METHOD_NOT_SUPPORTED',
            class: target || 'ZCL_ABAP_VIBE_MOCK', method,
            message: 'method signature contains CHANGING/TABLES',
          }), 'application/json');
        }
        if (method === 'fail') {
          return ok(res, JSON.stringify({
            status: 'error', code: 'METHOD_FAILED',
            class: target || 'ZCL_ABAP_VIBE_MOCK', method,
            message: 'CX_SY_ARITHMETIC_ERROR: division by zero',
          }), 'application/json');
        }
        if (method === 'inactive') {
          return ok(res, JSON.stringify({
            status: 'error', code: 'OBJECT_NOT_ACTIVE',
            class: target || 'ZCL_ABAP_VIBE_INACTIVE', method,
            message: 'class is inactive',
          }), 'application/json');
        }
        if (method === 'private') {
          return ok(res, JSON.stringify({
            status: 'error', code: 'ACCESS_DENIED',
            class: target, method,
            message: 'method is PRIVATE',
          }), 'application/json');
        }
        if (method === 'instance') {
          return ok(res, JSON.stringify({
            status: 'error', code: 'INSTANCE_METHOD_NOT_SUPPORTED',
            class: target, method,
            message: 'runner requires STATIC methods',
          }), 'application/json');
        }

        // Success fixtures — minimal add(a,b).
        if (method === 'add') {
          let args = {};
          try { args = JSON.parse(kv.IV_ARGS_JSON || '{}'); } catch (_e) { args = {}; }
          const a = Number(args.a ?? 0);
          const b = Number(args.b ?? 0);
          return ok(res, JSON.stringify({
            status: 'ok', method, exitCode: 0, result: a + b,
          }), 'application/json');
        }

        // Unknown method → fall through as a generic success (still routed
        // to wrapper path; real SAP would surface METHOD_NOT_FOUND).
        return ok(res, JSON.stringify({
          status: 'ok', method, exitCode: 0, result: null,
        }), 'application/json');
      }
      return ok(res, JSON.stringify({ status: 'success' }), 'application/json');
    }

    // DOMA/DTEL long text: GET/POST /sap/abap_cli/ddic/<type>/<name>/docu.
    // Mirrors the ABAP handler contract: an object without a long text answers
    // `DOCU_NOT_FOUND` in a 200 envelope; POST with `lines: []` deletes it.
    // Like SAPscript, over-long lines are truncated to CHAR72 silently (the
    // CLI validates before POST so this must never be the mechanism relied on).
    const ddicDocu = /^\/sap\/abap_cli\/ddic\/(doma|dtel)\/([^/]+)\/docu$/.exec(path);
    if (ddicDocu) {
      const docuType = ddicDocu[1].toUpperCase();
      const docuName = decodeURIComponent(ddicDocu[2]).toUpperCase();
      const objectKey = `${docuType}:${docuName}`;
      if (!ddicStore.has(objectKey)) {
        return ok(res, JSON.stringify({ status: 'error', error: { code: 'DDIC_OBJECT_NOT_FOUND', message: `${docuType} ${docuName} not found in mock store` } }), 'application/json');
      }
      if (req.method === 'GET') {
        if (!docuStore.has(objectKey)) {
          return ok(res, JSON.stringify({ status: 'error', error: { code: 'DOCU_NOT_FOUND', message: `${docuType} ${docuName} has no documentation` } }), 'application/json');
        }
        return ok(res, JSON.stringify({ status: 'success', data: docuStore.get(objectKey) }), 'application/json');
      }
      if (req.method === 'POST') {
        const body = await readBody(req);
        let payload = {};
        try { payload = JSON.parse(body); } catch (_e) { payload = {}; }
        const lines = Array.isArray(payload.lines)
          ? payload.lines.map((line) => ({
              format: String(line.format ?? '').slice(0, 2),
              line: String(line.line ?? '').slice(0, 72),
            }))
          : [];
        if (lines.length === 0) {
          docuStore.delete(objectKey);
          return ok(res, JSON.stringify({ status: 'success', data: { name: docuName, type: 'DOCU', action: 'deleted' } }), 'application/json');
        }
        const stored = { formatVersion: String(payload.formatVersion || '1'), lines };
        docuStore.set(objectKey, stored);
        return ok(res, JSON.stringify({ status: 'success', data: { name: docuName, type: 'DOCU', action: 'saved' } }), 'application/json');
      }
      return ok(res, JSON.stringify({ status: 'error', error: { code: 'METHOD_NOT_ALLOWED', message: `${req.method} not supported on /ddic/${docuType}/${docuName}/docu` } }), 'application/json');
    }

    // VIEW (database view) — local-extension view-v1 document via ICF.
    // Mirrors the ABAP handler contract for GET / POST|PUT / DELETE
    // (/ddic/view/<name>), including the 16-character name limit and the
    // local-package-only delete rule.
    const viewRoute = /^\/sap\/abap_cli\/ddic\/view(?:\/(.+))?$/.exec(path);
    if (viewRoute) {
      const viewName = viewRoute[1] ? decodeURIComponent(viewRoute[1]).toUpperCase() : '';
      if (req.method === 'POST' || req.method === 'PUT') {
        const body = await readBody(req);
        let payload = {};
        try { payload = JSON.parse(body); } catch (_e) { payload = {}; }
        const objName = (payload.name || '').toUpperCase();
        if (!objName) {
          return ok(res, JSON.stringify({ status: 'error', error: { code: 'VIEW_NAME_INVALID', message: 'name is required' } }), 'application/json');
        }
        if (objName.length > 16) {
          return ok(res, JSON.stringify({ status: 'error', error: { code: 'VIEW_NAME_INVALID', message: `name must not exceed 16 characters (got ${objName.length})` } }), 'application/json');
        }
        if (!payload.header || !payload.header.description) {
          return ok(res, JSON.stringify({ status: 'error', error: { code: 'VIEW_REQUIRED_FIELD', message: 'header.description is required' } }), 'application/json');
        }
        if (!Array.isArray(payload.tables) || payload.tables.length === 0) {
          return ok(res, JSON.stringify({ status: 'error', error: { code: 'VIEW_REQUIRED_FIELD', message: 'tables[] must contain at least the root table' } }), 'application/json');
        }
        if (!Array.isArray(payload.fields) || payload.fields.length === 0) {
          return ok(res, JSON.stringify({ status: 'error', error: { code: 'VIEW_REQUIRED_FIELD', message: 'fields[] must contain at least one view field' } }), 'application/json');
        }
        const pkg = (payload.package || '').toUpperCase();
        if (!isLocalPackage(pkg) && !payload.transportRequest) {
          return ok(res, JSON.stringify({ status: 'error', error: { code: 'VIEW_TRANSPORT_REQUIRED', message: 'transportRequest is required for non-local packages' } }), 'application/json');
        }
        const existed = viewStore.has(objName);
        viewStore.set(objName, Object.assign({}, payload, { name: objName, type: 'VIEW', package: pkg || '$TMP' }));
        return ok(res, JSON.stringify({ status: 'success', data: { name: objName, type: 'VIEW', action: existed ? 'updated' : 'created' } }), 'application/json');
      }
      if (req.method === 'GET') {
        if (!viewName) {
          return ok(res, JSON.stringify({ status: 'error', error: { code: 'NOT_FOUND', message: 'object name is required' } }), 'application/json');
        }
        if (!viewStore.has(viewName)) {
          return ok(res, JSON.stringify({ status: 'error', error: { code: 'DDIC_OBJECT_NOT_FOUND', message: `VIEW ${viewName} not found in mock store` } }), 'application/json');
        }
        return ok(res, JSON.stringify({ status: 'success', data: viewStore.get(viewName) }), 'application/json');
      }
      if (req.method === 'DELETE') {
        if (!viewStore.has(viewName)) {
          return ok(res, JSON.stringify({ status: 'error', error: { code: 'DDIC_OBJECT_NOT_FOUND', message: `VIEW ${viewName} not found in mock store` } }), 'application/json');
        }
        const stored = viewStore.get(viewName);
        if (!isLocalPackage(stored.package)) {
          return ok(res, JSON.stringify({ status: 'error', error: { code: 'VIEW_DELETE_UNSUPPORTED', message: `VIEW ${viewName} is in package ${stored.package}; delete it in SE11` } }), 'application/json');
        }
        viewStore.delete(viewName);
        return ok(res, JSON.stringify({ status: 'success', data: { name: viewName, type: 'VIEW', action: 'deleted' } }), 'application/json');
      }
      return ok(res, JSON.stringify({ status: 'error', error: { code: 'METHOD_NOT_ALLOWED', message: `${req.method} not supported on /ddic/view` } }), 'application/json');    }

    // JOBD (application job definition) — local-extension jobd-v1 document via
    // ICF. Mirrors the ABAP handler contract for GET/POST/PUT/DELETE
    // (/jobd/<name>): 32-character names, create on POST, update on PUT,
    // transport required for non-local packages, delete only for local ones.
    const jobdRoute = /^\/sap\/abap_cli\/jobd\/(.+)$/.exec(path);
    if (jobdRoute) {
      const jobdName = decodeURIComponent(jobdRoute[1]).toUpperCase();
      const query = new URLSearchParams(String(req.url || '').split('?')[1] || '');
      const queryPackage = String(query.get('package') || '').toUpperCase();
      const queryTransport = String(query.get('transportRequest') || query.get('tr') || '').toUpperCase();
      const jsonError = (code, message) => ok(res, JSON.stringify({ status: 'error', error: { code, message } }), 'application/json');

      if (!jobdName || jobdName.length > 32 || /\s/.test(jobdName)) {
        return jsonError('JOBD_NAME_INVALID', `job definition name must be 1-32 characters without whitespace (got '${jobdName}')`);
      }

      if (req.method === 'GET') {
        if (!jobdStore.has(jobdName)) {
          return jsonError('JOBD_NOT_FOUND', `job definition ${jobdName} does not exist`);
        }
        return ok(res, JSON.stringify({ status: 'success', data: jobdStore.get(jobdName) }), 'application/json');
      }

      if (req.method === 'POST' || req.method === 'PUT') {
        const body = await readBody(req);
        let payload = {};
        try { payload = JSON.parse(body); } catch (_e) { payload = {}; }
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
          return jsonError('JOBD_INVALID_PAYLOAD', 'request body is not a valid job definition document');
        }
        const existed = jobdStore.has(jobdName);
        if (req.method === 'POST' && existed) {
          return jsonError('JOBD_ALREADY_EXISTS', `job definition ${jobdName} already exists; update it instead`);
        }
        if (req.method === 'PUT' && !existed) {
          return jsonError('JOBD_NOT_FOUND', `job definition ${jobdName} does not exist; create it first`);
        }
        const stored = existed ? jobdStore.get(jobdName) : {};
        const pkg = queryPackage || String(stored.package || payload.package || '').toUpperCase() || '$TMP';
        if (!isLocalPackage(pkg) && !queryTransport) {
          return jsonError('JOBD_TRANSPORT_REQUIRED', `write of a job definition requires transportRequest for package ${pkg}`);
        }
        jobdStore.set(jobdName, Object.assign({}, stored, payload, {
          formatVersion: '1',
          name: jobdName,
          package: pkg,
          passClient: payload.passClient === true,
          sysTimezoneIndicator: payload.sysTimezoneIndicator === true,
          localDeact: payload.localDeact === true,
          localCust: payload.localCust === true,
        }));
        return ok(res, JSON.stringify({
          status: 'success',
          data: { name: jobdName, type: 'JOBD', action: existed ? 'updated' : 'created', package: pkg, activated: true },
        }), 'application/json');
      }

      if (req.method === 'DELETE') {
        if (!jobdStore.has(jobdName)) {
          return jsonError('JOBD_NOT_FOUND', `job definition ${jobdName} does not exist`);
        }
        const stored = jobdStore.get(jobdName);
        if (!isLocalPackage(stored.package) && !queryTransport) {
          return jsonError('JOBD_TRANSPORT_REQUIRED', `delete of a job definition requires transportRequest for package ${stored.package}`);
        }
        jobdStore.delete(jobdName);
        return ok(res, JSON.stringify({
          status: 'success',
          data: { name: jobdName, type: 'JOBD', action: 'deleted', package: stored.package, activated: false },
        }), 'application/json');
      }

      return jsonError('METHOD_NOT_ALLOWED', `${req.method} not supported on /jobd/<name>`);
    }

    // SHLP (search help) — local-extension shlp-v1 document via ICF.
    // Mirrors the ABAP handler contract for GET / POST|PUT / DELETE
    // (/ddic/shlp/<name>): elementary needs selectionMethod, collective needs
    // includedSearchHelps + parameterMappings, and the included search helps
    // must exist (as in DD30L).
    const shlpRoute = /^\/sap\/abap_cli\/ddic\/shlp(?:\/(.+))?$/.exec(path);
    if (shlpRoute) {
      const shlpName = shlpRoute[1] ? decodeURIComponent(shlpRoute[1]).toUpperCase() : '';
      if (req.method === 'POST' || req.method === 'PUT') {
        const body = await readBody(req);
        let payload = {};
        try { payload = JSON.parse(body); } catch (_e) { payload = {}; }
        const objName = (payload.name || '').toUpperCase();
        if (!objName) {
          return ok(res, JSON.stringify({ status: 'error', error: { code: 'SHLP_NAME_INVALID', message: 'name is required' } }), 'application/json');
        }
        if (objName.length > 30) {
          return ok(res, JSON.stringify({ status: 'error', error: { code: 'SHLP_NAME_INVALID', message: `name must not exceed 30 characters (got ${objName.length})` } }), 'application/json');
        }
        if (!payload.header || !payload.header.description) {
          return ok(res, JSON.stringify({ status: 'error', error: { code: 'SHLP_REQUIRED_FIELD', message: 'header.description is required' } }), 'application/json');
        }
        const kind = String(payload.kind || '').toLowerCase();
        if (kind !== 'elementary' && kind !== 'collective') {
          return ok(res, JSON.stringify({ status: 'error', error: { code: 'SHLP_KIND_INVALID', message: `unsupported kind '${payload.kind}'` } }), 'application/json');
        }
        if (!Array.isArray(payload.parameters) || payload.parameters.length === 0) {
          return ok(res, JSON.stringify({ status: 'error', error: { code: 'SHLP_REQUIRED_FIELD', message: 'parameters[] must contain at least one interface parameter' } }), 'application/json');
        }
        if (kind === 'elementary') {
          if (!payload.selectionMethod) {
            return ok(res, JSON.stringify({ status: 'error', error: { code: 'SHLP_REQUIRED_FIELD', message: 'selectionMethod is required for an elementary search help' } }), 'application/json');
          }
          if (Array.isArray(payload.includedSearchHelps) && payload.includedSearchHelps.length > 0) {
            return ok(res, JSON.stringify({ status: 'error', error: { code: 'SHLP_FIELD_INVALID', message: 'includedSearchHelps[] only applies to a collective search help' } }), 'application/json');
          }
        } else {
          if (!Array.isArray(payload.includedSearchHelps) || payload.includedSearchHelps.length === 0) {
            return ok(res, JSON.stringify({ status: 'error', error: { code: 'SHLP_REQUIRED_FIELD', message: 'includedSearchHelps[] must contain at least one included search help' } }), 'application/json');
          }
          if (!Array.isArray(payload.parameterMappings) || payload.parameterMappings.length === 0) {
            return ok(res, JSON.stringify({ status: 'error', error: { code: 'SHLP_REQUIRED_FIELD', message: 'parameterMappings[] must map the interface parameters' } }), 'application/json');
          }
          for (const included of payload.includedSearchHelps) {
            const sub = String(included.searchHelp || '').toUpperCase();
            if (sub && !shlpStore.has(sub)) {
              return ok(res, JSON.stringify({ status: 'error', error: { code: 'SHLP_INCLUDED_NOT_FOUND', message: `included search help ${sub} does not exist` } }), 'application/json');
            }
          }
        }
        const pkg = (payload.package || '').toUpperCase();
        if (!isLocalPackage(pkg) && !payload.transportRequest) {
          return ok(res, JSON.stringify({ status: 'error', error: { code: 'SHLP_TRANSPORT_REQUIRED', message: 'transportRequest is required for non-local packages' } }), 'application/json');
        }
        const existed = shlpStore.has(objName);
        shlpStore.set(objName, Object.assign({}, payload, { name: objName, type: 'SHLP', package: pkg || '$TMP' }));
        return ok(res, JSON.stringify({ status: 'success', data: { name: objName, type: 'SHLP', action: existed ? 'updated' : 'created' } }), 'application/json');
      }
      if (req.method === 'GET') {
        if (!shlpName) {
          return ok(res, JSON.stringify({ status: 'error', error: { code: 'NOT_FOUND', message: 'object name is required' } }), 'application/json');
        }
        if (!shlpStore.has(shlpName)) {
          return ok(res, JSON.stringify({ status: 'error', error: { code: 'DDIC_OBJECT_NOT_FOUND', message: `SHLP ${shlpName} not found in mock store` } }), 'application/json');
        }
        return ok(res, JSON.stringify({ status: 'success', data: shlpStore.get(shlpName) }), 'application/json');
      }
      if (req.method === 'DELETE') {
        if (!shlpStore.has(shlpName)) {
          return ok(res, JSON.stringify({ status: 'error', error: { code: 'DDIC_OBJECT_NOT_FOUND', message: `SHLP ${shlpName} not found in mock store` } }), 'application/json');
        }
        const stored = shlpStore.get(shlpName);
        if (!isLocalPackage(stored.package)) {
          return ok(res, JSON.stringify({ status: 'error', error: { code: 'SHLP_DELETE_UNSUPPORTED', message: `SHLP ${shlpName} is in package ${stored.package}; delete it in SE11` } }), 'application/json');
        }
        shlpStore.delete(shlpName);
        return ok(res, JSON.stringify({ status: 'success', data: { name: shlpName, type: 'SHLP', action: 'deleted' } }), 'application/json');
      }
      return ok(res, JSON.stringify({ status: 'error', error: { code: 'METHOD_NOT_ALLOWED', message: `${req.method} not supported on /ddic/shlp` } }), 'application/json');
    }

    // 014: /sap/abap_cli/ddic/<type> POST (create/overwrite) and GET /<name> (pull).
    const ddic = /^\/sap\/abap_cli\/ddic\/(doma|dtel|tabl|stru)(?:\/(.+))?$/.exec(path);
    if (ddic) {
      const ddicType = ddic[1].toUpperCase();
      const name = ddic[2];
      if (req.method === 'POST') {
        if (DDIC_FAIL) {
          return ok(res, JSON.stringify({ status: 'error', error: { code: 'DDIC_CREATE_FAILED', message: 'Simulated DDIC failure (MOCK_DDIC_FAIL=1)' } }), 'application/json');
        }
        const body = await readBody(req);
        let payload = {};
        try { payload = JSON.parse(body); } catch (_e) { payload = {}; }
        const objName = (payload.name || '').toUpperCase();
        if (!objName) {
          return ok(res, JSON.stringify({ status: 'error', error: { code: 'DDIC_REQUIRED_FIELD', message: 'name is required' } }), 'application/json');
        }
        const firstChar = objName[0] || '';
        if (firstChar !== 'Z' && firstChar !== 'Y' && firstChar !== '/') {
          return ok(res, JSON.stringify({ status: 'error', error: { code: 'DDIC_INVALID_NAME', message: `Invalid namespace: name must start with Z, Y, or / (got "${objName}")` } }), 'application/json');
        }
        if (!isLocalPackage(payload.package) && !payload.transportRequest) {
          return ok(res, JSON.stringify({ status: 'error', error: { code: 'DDIC_TRANSPORT_REQUIRED', message: 'transportRequest is required for non-local packages' } }), 'application/json');
        }
        if (ddicType === 'TABL' || ddicType === 'STRU') {
          if (!Array.isArray(payload.fields) || payload.fields.length === 0) {
            return ok(res, JSON.stringify({ status: 'error', error: { code: 'DDIC_REQUIRED_FIELD', message: 'fields list is required and must be non-empty' } }), 'application/json');
          }
        }
        if (ddicType === 'DOMA') {
          // AFF wire carries dataType/length under `format.*`.
          const format = payload.format || {};
          if (!format.dataType || format.length === undefined) {
            return ok(res, JSON.stringify({ status: 'error', error: { code: 'DDIC_REQUIRED_FIELD', message: 'format.dataType and format.length are required' } }), 'application/json');
          }
        }
        if (ddicType === 'DTEL') {
          if (!payload.description) {
            return ok(res, JSON.stringify({ status: 'error', error: { code: 'DDIC_REQUIRED_FIELD', message: 'description is required' } }), 'application/json');
          }
          if (!payload.dataTypeInformation && !payload.domain && !payload.dataType) {
            return ok(res, JSON.stringify({ status: 'error', error: { code: 'DDIC_INVALID_FIELD', message: 'dataTypeInformation, domain or built-in dataType is required' } }), 'application/json');
          }
        }
        // Mirror of the wire payload so round-trip is consistent.
        const key = ddicType + ':' + objName;
        ddicStore_existed_before = ddicStore.has(key);
        const stored = Object.assign({}, payload, { name: objName });
        ddicStore.set(key, stored);
        const action = ddicStore_existed_before ? 'updated' : 'created';
        ddicStore_existed_before = false;
        return ok(res, JSON.stringify({ status: 'success', data: { name: objName, type: ddicType, action } }), 'application/json');
      }
      if (req.method === 'GET') {
        if (!name) {
          return ok(res, JSON.stringify({ status: 'error', error: { code: 'NOT_FOUND', message: 'object name is required' } }), 'application/json');
        }
        const key = ddicType + ':' + decodeURIComponent(name).toUpperCase();
        if (!ddicStore.has(key)) {
          return ok(res, JSON.stringify({ status: 'error', error: { code: 'DDIC_OBJECT_NOT_FOUND', message: `${ddicType} ${name} not found in mock store` } }), 'application/json');
        }
        return ok(res, JSON.stringify({ status: 'success', data: ddicStore.get(key) }), 'application/json');
      }
      return ok(res, JSON.stringify({ status: 'error', error: { code: 'METHOD_NOT_ALLOWED', message: `${req.method} not supported on /ddic/${ddicType}` } }), 'application/json');
    }

    // /sap/abap_cli/http/<name> (GET pull / POST|PUT upsert / DELETE).
    // Mirrors the bundled handler contract: node name derives from the AFF
    // generalInformation.url, writes are local-package-only, delete refuses
    // missing nodes and nodes that still have children.
    const httpSvc = /^\/sap\/abap_cli\/http\/([^/]+)$/.exec(path);
    if (httpSvc) {
      const requested = decodeURIComponent(httpSvc[1]);
      if (req.method === 'POST' || req.method === 'PUT') {
        const body = await readBody(req);
        let payload = {};
        try { payload = JSON.parse(body); } catch (_e) { payload = {}; }
        const general = (payload && payload.generalInformation) || {};
        const url = String(general.url || general.servicePath || '').replace(/\/+$/, '');
        const nodeName = url.split('/').filter(Boolean).pop() || requested;
        if (!payload.header || !payload.header.description || !url) {
          return ok(res, JSON.stringify({ status: 'error', error: { code: 'HTTP_SERVICE_INVALID', message: 'formatVersion, header.description and generalInformation.url are required' } }), 'application/json');
        }
        if (payload.package && !isLocalPackage(payload.package)) {
          return ok(res, JSON.stringify({ status: 'error', error: { code: 'HTTP_PACKAGE_NOT_SUPPORTED', message: 'SICF nodes can only be written in local packages' } }), 'application/json');
        }
        const key = nodeName.toUpperCase();
        const existed = httpStore.has(key);
        httpStore.set(key, payload);
        return ok(res, JSON.stringify({ status: 'success', data: { name: nodeName.toLowerCase(), type: 'HTTP', action: existed ? 'updated' : 'created' } }), 'application/json');
      }
      if (req.method === 'GET') {
        const key = requested.toUpperCase();
        if (!httpStore.has(key)) {
          return ok(res, JSON.stringify({ status: 'error', error: { code: 'HTTP_OBJECT_NOT_FOUND', message: `SICF service not found: ${requested}` } }), 'application/json');
        }
        return ok(res, JSON.stringify({ status: 'success', data: httpStore.get(key) }), 'application/json');
      }
      if (req.method === 'DELETE') {
        const key = requested.toUpperCase();
        if (!httpStore.has(key)) {
          return ok(res, JSON.stringify({ status: 'error', error: { code: 'HTTP_OBJECT_NOT_FOUND', message: `SICF service not found: ${requested}` } }), 'application/json');
        }
        const hasChildren = [...httpStore.keys()].some((k) => k.startsWith(key + '/'));
        if (hasChildren) {
          return ok(res, JSON.stringify({ status: 'error', error: { code: 'HTTP_SERVICE_HAS_CHILDREN', message: `${requested} has child nodes` } }), 'application/json');
        }
        httpStore.delete(key);
        return ok(res, JSON.stringify({ status: 'success', data: { name: key.toLowerCase(), type: 'HTTP', action: 'deleted' } }), 'application/json');
      }
      return ok(res, JSON.stringify({ status: 'error', error: { code: 'METHOD_NOT_ALLOWED', message: `${req.method} not supported on /http/${requested}` } }), 'application/json');
    }

    // 014: /sap/abap_cli/tran/<tcode> (GET pull / POST|PUT upsert / DELETE).
    // Mirrors the ABAP handler contract: 200 + envelope for SAP-side errors,
    // package/transport envelope at the top level of the wire document.
    const tran = /^\/sap\/abap_cli\/tran\/([^/]+)$/.exec(path);
    if (tran) {
      const tcode = decodeURIComponent(tran[1]).toUpperCase();
      if (req.method === 'GET') {
        if (!tranStore.has(tcode)) {
          return ok(res, JSON.stringify({ status: 'error', error: { code: 'TRAN_OBJECT_NOT_FOUND', message: `Transaction ${tcode} not found` } }), 'application/json');
        }
        return ok(res, JSON.stringify({ status: 'success', data: tranStore.get(tcode) }), 'application/json');
      }
      if (req.method === 'POST' || req.method === 'PUT') {
        const body = await readBody(req);
        let payload = {};
        try { payload = JSON.parse(body); } catch (_e) { payload = {}; }
        const bodyName = (payload.name || '').toUpperCase();
        if (bodyName && bodyName !== tcode) {
          return ok(res, JSON.stringify({ status: 'error', error: { code: 'TRAN_NAME_MISMATCH', message: `payload name ${bodyName} does not match URL transaction ${tcode}` } }), 'application/json');
        }
        const type = payload.generalInformation && payload.generalInformation.transactionType;
        if (!type) {
          return ok(res, JSON.stringify({ status: 'error', error: { code: 'TRAN_TYPE_INVALID', message: 'generalInformation.transactionType is required' } }), 'application/json');
        }
        if (!payload.header || !payload.header.description) {
          return ok(res, JSON.stringify({ status: 'error', error: { code: 'TRAN_DESCRIPTION_REQUIRED', message: 'header.description is required' } }), 'application/json');
        }
        const pkg = (payload.package || '').toUpperCase();
        if (!isLocalPackage(pkg) && !payload.transportRequest) {
          return ok(res, JSON.stringify({ status: 'error', error: { code: 'TRAN_TRANSPORT_REQUIRED', message: 'transportRequest is required for non-local packages' } }), 'application/json');
        }
        if (type === 'ooTransaction') {
          return ok(res, JSON.stringify({ status: 'error', error: { code: 'TRAN_OO_NOT_SUPPORTED', message: 'OO transactions cannot be written through RPY_TRANSACTION_INSERT' } }), 'application/json');
        }
        const existed = tranStore.has(tcode);
        const stored = Object.assign({}, payload, {
          name: tcode,
          // The real GET infers the package from TADIR; the mock keeps whatever
          // the write carried (defaulting to $TMP like the ABAP handler).
          package: pkg || '$TMP',
        });
        tranStore.set(tcode, stored);
        return ok(res, JSON.stringify({ status: 'success', data: { name: tcode, type: 'TRAN', action: existed ? 'updated' : 'created' } }), 'application/json');
      }
      if (req.method === 'DELETE') {
        if (!tranStore.has(tcode)) {
          return ok(res, JSON.stringify({ status: 'error', error: { code: 'TRAN_OBJECT_NOT_FOUND', message: `Transaction ${tcode} not found` } }), 'application/json');
        }
        const storedTran = tranStore.get(tcode);
        if (!isLocalPackage(storedTran.package)) {
          return ok(res, JSON.stringify({ status: 'error', error: { code: 'TRAN_DELETE_UNSUPPORTED', message: `transaction ${tcode} is in non-local package ${storedTran.package}; delete it in SE93` } }), 'application/json');
        }
        tranStore.delete(tcode);
        return ok(res, JSON.stringify({ status: 'success', data: { name: tcode, type: 'TRAN', action: 'deleted' } }), 'application/json');
      }
      return ok(res, JSON.stringify({ status: 'error', error: { code: 'METHOD_NOT_ALLOWED', message: `${req.method} not supported on /tran/${tcode}` } }), 'application/json');
    }

    // /sap/abap_cli/xslt/<name> (GET pull / POST|PUT upsert / DELETE).
    // Mirrors zcl_abap_vibe_icf_xslt: camelCase wire envelope, 200 + structured
    // error for SAP-side failures, CRLF read-back for the source string.
    const xslt = /^\/sap\/abap_cli\/xslt\/([^/]+)$/.exec(path);
    if (xslt) {
      const xsltName = decodeURIComponent(xslt[1]).toUpperCase();
      if (req.method === 'GET') {
        if (!xsltStore.has(xsltName)) {
          return ok(res, JSON.stringify({ status: 'error', error: { code: 'XSLT_OBJECT_NOT_FOUND', message: `Transformation ${xsltName} not found` } }), 'application/json');
        }
        const stored = xsltStore.get(xsltName);
        const readback = stored.source.replace(/\n/g, '\r\n') + '\r\n';
        return ok(res, JSON.stringify({
          status: 'success',
          data: {
            name: stored.name,
            description: stored.description,
            originalLanguage: stored.originalLanguage,
            source: readback,
            package: stored.package,
          },
        }), 'application/json');
      }
      if (req.method === 'POST' || req.method === 'PUT') {
        const body = await readBody(req);
        let payload = {};
        try { payload = JSON.parse(body); } catch (_e) { payload = {}; }
        const bodyName = (payload.name || '').toUpperCase();
        if (bodyName && bodyName !== xsltName) {
          return ok(res, JSON.stringify({ status: 'error', error: { code: 'XSLT_NAME_MISMATCH', message: `payload name ${bodyName} does not match URL transformation ${xsltName}` } }), 'application/json');
        }
        if (!payload.header || !payload.header.description) {
          return ok(res, JSON.stringify({ status: 'error', error: { code: 'XSLT_DESCRIPTION_REQUIRED', message: 'header.description is required' } }), 'application/json');
        }
        if (!payload.source || !String(payload.source).trim()) {
          return ok(res, JSON.stringify({ status: 'error', error: { code: 'XSLT_SOURCE_REQUIRED', message: 'source is required' } }), 'application/json');
        }
        const pkg = (payload.package || '').toUpperCase();
        if (!isLocalPackage(pkg) && !payload.transportRequest) {
          return ok(res, JSON.stringify({ status: 'error', error: { code: 'XSLT_TRANSPORT_REQUIRED', message: 'transportRequest is required for non-local packages' } }), 'application/json');
        }
        const existed = xsltStore.has(xsltName);
        xsltStore.set(xsltName, {
          name: xsltName,
          description: payload.header.description,
          originalLanguage: (payload.header.originalLanguage || 'EN').toUpperCase(),
          source: String(payload.source).replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n+$/, ''),
          package: pkg || (existed ? xsltStore.get(xsltName).package : '$TMP'),
        });
        return ok(res, JSON.stringify({ status: 'success', data: { name: xsltName, action: existed ? 'updated' : 'created' } }), 'application/json');
      }
      if (req.method === 'DELETE') {
        if (!xsltStore.has(xsltName)) {
          return ok(res, JSON.stringify({ status: 'error', error: { code: 'XSLT_OBJECT_NOT_FOUND', message: `Transformation ${xsltName} not found` } }), 'application/json');
        }
        xsltStore.delete(xsltName);
        return ok(res, JSON.stringify({ status: 'success', data: { name: xsltName, action: 'deleted' } }), 'application/json');
      }
      return ok(res, JSON.stringify({ status: 'error', error: { code: 'METHOD_NOT_ALLOWED', message: `${req.method} not supported on /xslt/${xsltName}` } }), 'application/json');
    }

    // Authorization-object family (AUTH / SUSC / SUCU / SUSH / SUSO) — the
    // hand-written ICF routes `/sap/abap_cli/auth/<sub>/<name>`:
    //   GET one JSON document, POST create, PUT update (existing only), DELETE.
    // Package / transport request travel as query parameters (the documents
    // carry neither); `$`-prefixed packages are transport-free. Statuses follow
    // the shared handler mapping: 400 validation/payload/transport, 404 not
    // found, 405 method, 409 already exists / delete refused, 500 SAP failure,
    // 501 release does not support the type.
    const authRoot = /^\/sap\/abap_cli\/auth\/([^/]+)(?:\/(.*))?$/.exec(path);
    if (authRoot) {
      const sub = decodeURIComponent(authRoot[1]).toLowerCase();
      const authType = AUTH_TYPE_BY_SUB[sub];
      if (!authType) {
        return authError(res, 404, 'NOT_FOUND', `unknown authorization-family route: /auth/${sub}`);
      }
      const store = authStores[sub];
      let rawName;
      try {
        rawName = decodeURIComponent(authRoot[2] ?? '');
      } catch (_e) {
        return authError(res, 400, `${authType}_NAME_INVALID`, 'object name is not valid URL encoding');
      }
      const name = canonicalAuthName(authType, rawName);
      if (!name || !authNameValid(authType, name)) {
        return authError(res, 400, `${authType}_NAME_INVALID`, `${authType} object name "${rawName.trim()}" is invalid`);
      }
      const queryPackage = (q.get('package') || '').trim().toUpperCase();
      const queryTransport = ((q.get('transportRequest') || q.get('tr') || '').trim()).toUpperCase();
      // SUSO profile regeneration is an explicit opt-in; anything but `true`
      // (the default) leaves the SAP_ALL/SAP_NEW data untouched.
      const regenerate = (q.get('regenerateProfiles') || '').trim().toLowerCase() === 'true';

      if (req.method === 'GET') {
        const stored = store.get(name);
        if (!stored) {
          return authError(res, 404, `${authType}_NOT_FOUND`, `${authType} object ${name.trim()} does not exist`);
        }
        return ok(res, JSON.stringify({ status: 'success', data: authGetData(stored, name) }), 'application/json');
      }

      if (req.method === 'POST') {
        const body = await readBody(req);
        const document = authParseJson(body);
        if (!document) {
          return authError(res, 400, `${authType}_INVALID_PAYLOAD`, 'request body is not a JSON document');
        }
        if (!queryPackage) {
          return authError(res, 400, `${authType}_INVALID_PAYLOAD`, 'package query parameter is required');
        }
        const payloadError = authPayloadError(authType, document);
        if (payloadError) {
          return authError(res, 400, `${authType}_INVALID_PAYLOAD`, payloadError);
        }
        // SUCU: the URL name and the document's two key fields must agree.
        if (authType === 'SUCU') {
          const documentName = sucuNameFromDocument(document);
          if (documentName !== name) {
            return authError(res, 400, 'SUCU_INVALID_PAYLOAD', 'object name in the URL and in generalInformation do not match');
          }
        }
        // SUSH: only `RF` applications can be created through the route. The
        // other key types are SAP-computed hashes of the leading object.
        if (authType === 'SUSH') {
          if (!name.endsWith('.RF')) {
            return authError(
              res,
              400,
              'SUSH_UNSUPPORTED',
              'only RF (RFC-enabled function module) applications can be created; create the leading object first and pull its key',
            );
          }
          if (String((document.generalInformation || {}).applicationType).toUpperCase() !== 'FUNC') {
            return authError(res, 400, 'SUSH_INVALID_PAYLOAD', 'an RF application must declare applicationType "FUNC"');
          }
        }
        const transportError = authTransportError(authType, queryPackage, queryTransport, 'create');
        if (transportError) {
          return authError(res, 400, transportError.code, transportError.message);
        }
        if (store.has(name)) {
          return authError(res, 409, `${authType}_ALREADY_EXISTS`, `${authType} object ${name.trim()} already exists`);
        }
        const stored = { document, package: queryPackage, whereUsed: false };
        store.set(name, stored);
        return ok(
          res,
          JSON.stringify({ status: 'success', data: authWriteData(authType, name, 'created', stored.package, regenerate) }),
          'application/json',
        );
      }

      if (req.method === 'PUT') {
        const stored = store.get(name);
        if (!stored) {
          return authError(res, 404, `${authType}_NOT_FOUND`, `${authType} object ${name.trim()} does not exist`);
        }
        const body = await readBody(req);
        const document = authParseJson(body);
        if (!document) {
          return authError(res, 400, `${authType}_INVALID_PAYLOAD`, 'request body is not a JSON document');
        }
        const payloadError = authPayloadError(authType, document);
        if (payloadError) {
          return authError(res, 400, `${authType}_INVALID_PAYLOAD`, payloadError);
        }
        if (authType === 'SUCU') {
          const documentName = sucuNameFromDocument(document);
          if (documentName !== name) {
            return authError(res, 400, 'SUCU_INVALID_PAYLOAD', 'object name in the URL and in generalInformation do not match');
          }
        }
        // SUSH: the leading application is immutable; only the SU22 payload
        // (maintenance mode / authorization objects) can change.
        if (authType === 'SUSH') {
          const previous = (stored.document.generalInformation || {});
          const next = (document.generalInformation || {});
          if (previous.applicationName !== next.applicationName || previous.applicationType !== next.applicationType) {
            return authError(res, 400, 'SUSH_INVALID_PAYLOAD', 'the leading application of an existing SUSH object cannot change');
          }
        }
        const targetPackage = queryPackage || stored.package;
        if (!targetPackage) {
          return authError(res, 400, `${authType}_INVALID_PAYLOAD`, 'package could not be resolved for this object');
        }
        const transportError = authTransportError(authType, targetPackage, queryTransport, 'update');
        if (transportError) {
          return authError(res, 400, transportError.code, transportError.message);
        }
        stored.document = document;
        stored.package = targetPackage;
        return ok(
          res,
          JSON.stringify({ status: 'success', data: authWriteData(authType, name, 'updated', stored.package, regenerate) }),
          'application/json',
        );
      }

      if (req.method === 'DELETE') {
        const stored = store.get(name);
        if (!stored) {
          return authError(res, 404, `${authType}_NOT_FOUND`, `${authType} object ${name.trim()} does not exist`);
        }
        const transportError = authTransportError(authType, stored.package, queryTransport, 'delete');
        if (transportError) {
          return authError(res, 400, transportError.code, transportError.message);
        }
        // Non-local SUCU objects cannot record a CTS delete entry from the ICF
        // session (TRAN/JOBD precedent): refuse and point at the GUI.
        if (authType === 'SUCU' && !isLocalPackage(stored.package)) {
          return authError(
            res,
            400,
            'SUCU_DELETE_UNSUPPORTED',
            `authorization group in package ${stored.package} cannot be deleted through the ICF service; delete it in SU21/SM30 so the removal is recorded in a request`,
          );
        }
        // Where-used / delivered-object guards of the real handlers happen
        // before any mutation and surface as a validation error.
        if (stored.whereUsed) {
          return authError(
            res,
            409,
            `${authType}_DELETE_REFUSED`,
            `${authType} object ${name.trim()} is still referenced by authorizations, roles or objects and cannot be deleted`,
          );
        }
        store.delete(name);
        return ok(
          res,
          JSON.stringify({ status: 'success', data: authWriteData(authType, name, 'deleted', stored.package, regenerate) }),
          'application/json',
        );
      }

      return authError(res, 405, 'METHOD_NOT_ALLOWED', `${req.method} not supported on /auth/${sub}/<name>`);
    }

    // /sap/abap_cli/sm59/<name> (GET pull / POST upsert / DELETE) — frozen wire
    // contract. Only RFCTYPE='G' (HTTP connection to external server)
    // destinations are manageable, a write replaces the whole modelled
    // definition, and RFCDES is a client-independent system table (no package /
    // transport envelope). Statuses mirror the handler: 404 absent, 400 for
    // type / name / payload validation, 405 for unsupported methods.
    // GET /sm59 (list) is deliberately not implemented.
    const sm59Route = /^\/sap\/abap_cli\/sm59(?:\/([^/]+))?$/.exec(path);
    if (sm59Route) {
      const sm59Reply = (status, payload) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      };
      const sm59Error = (status, code, message, details) =>
        sm59Reply(status, { status: 'error', error: { code, message, ...(details ? { details } : {}) } });
      const sm59NameProblem = (name) => {
        if (!name) return 'destination name is empty';
        if (name.length > 32) return `destination name must not exceed 32 characters (got ${name.length})`;
        if (/[\s\x00-\x1f]/.test(name)) return 'destination name must not contain whitespace or control characters';
        if ('#@$%*_+-:.;,/\\&?"=!'.includes(name[0])) return `destination name must not start with '${name[0]}'`;
        if (name === 'A_RFC' || name === 'B_RFC') return `destination name ${name} is reserved by SAP`;
        if (/_[A-Z0-9]{3,8}_[0-9]{2}$/.test(name) || name.includes('_TRUSTED') || /\[[^\]]*\]$/.test(name) || name.startsWith('NONE[')) {
          return `destination name ${name} matches a SAP-reserved popup pattern; create it in SM59`;
        }
        return undefined;
      };

      if (!sm59Route[1]) {
        return sm59Error(400, 'SM59_NAME_INVALID', 'destination name is required on /sm59/<name>');
      }
      const sm59Name = decodeURIComponent(sm59Route[1]).trim().toUpperCase();
      const nameProblem = sm59NameProblem(sm59Name);
      if (nameProblem) return sm59Error(400, 'SM59_NAME_INVALID', nameProblem);

      // Non-HTTP destinations are visible in SM59 but outside this type's scope.
      const nonHttp = sm59OtherTypeStore.get(sm59Name);
      if (nonHttp) {
        return sm59Error(
          400,
          'SM59_TYPE_NOT_SUPPORTED',
          `${sm59Name} has RFCTYPE='${nonHttp.type}', only HTTP destinations (RFCTYPE='G') are supported`,
          { rfctype: nonHttp.type },
        );
      }

      if (req.method === 'GET') {
        if (!sm59Store.has(sm59Name)) {
          return sm59Error(404, 'SM59_OBJECT_NOT_FOUND', `SM59 HTTP destination ${sm59Name} not found`);
        }
        return sm59Reply(200, { status: 'success', data: sm59Store.get(sm59Name) });
      }

      if (req.method === 'POST') {
        const body = await readBody(req);
        let payload;
        try {
          payload = JSON.parse(body);
        } catch (_e) {
          return sm59Error(400, 'SM59_INVALID_PAYLOAD', 'request body is not valid JSON');
        }
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
          return sm59Error(400, 'SM59_INVALID_PAYLOAD', 'request body is not a destination document');
        }
        const invalid = (message) => sm59Error(400, 'SM59_INVALID_PAYLOAD', message);
        if (payload.formatVersion !== undefined && String(payload.formatVersion) !== '1') {
          return invalid(`formatVersion must be "1" (got "${String(payload.formatVersion)}")`);
        }
        if (payload.name !== undefined && String(payload.name).trim().toUpperCase() !== sm59Name) {
          return invalid(`payload name ${String(payload.name)} does not match URL destination ${sm59Name}`);
        }
        if (payload.type !== undefined && String(payload.type).toUpperCase() !== 'G') {
          return invalid(`payload type must be "G" (got "${String(payload.type)}")`);
        }
        const targetHost = typeof payload.targetHost === 'string' ? payload.targetHost.trim() : '';
        if (!targetHost) return invalid('targetHost is required');
        if (targetHost.length > 1024) return invalid(`targetHost must not exceed 1024 characters (RFCHOST_EXT; got ${targetHost.length})`);
        const protocol = typeof payload.protocol === 'string' ? payload.protocol.trim().toUpperCase() : '';
        if (protocol !== 'HTTP' && protocol !== 'HTTPS') {
          return invalid('protocol must be "HTTP" or "HTTPS"');
        }
        let port;
        if (payload.port !== undefined) {
          port = typeof payload.port === 'number' ? payload.port : Number(payload.port);
          if (!Number.isInteger(port) || port < 0 || port > 65535) {
            return invalid(`port must be an integer between 1 and 65535 (got "${String(payload.port)}")`);
          }
        }
        if (!port) {
          // 0 / omitted: the handler resolves the default (443 HTTPS / 80 HTTP)
          // and always writes it explicitly.
          port = protocol === 'HTTPS' ? 443 : 80;
        }
        const description = payload.description === undefined ? '' : String(payload.description).trim();
        if (description.length > 72) {
          return invalid(`description must not exceed 72 characters (RFCDOC_D; got ${description.length})`);
        }
        const pathPrefix = payload.pathPrefix === undefined ? '' : String(payload.pathPrefix).trim();
        if (pathPrefix.length > 255) {
          return invalid(`pathPrefix must not exceed 255 characters (PFADPRE; got ${pathPrefix.length})`);
        }
        const existed = sm59Store.has(sm59Name);
        sm59Store.set(sm59Name, {
          formatVersion: '1',
          name: sm59Name,
          type: 'G',
          description,
          targetHost,
          port,
          protocol,
          pathPrefix,
        });
        return sm59Reply(200, {
          status: 'success',
          data: { name: sm59Name, type: 'G', action: existed ? 'updated' : 'created' },
        });
      }

      if (req.method === 'DELETE') {
        if (!sm59Store.has(sm59Name)) {
          return sm59Error(404, 'SM59_OBJECT_NOT_FOUND', `SM59 HTTP destination ${sm59Name} not found`);
        }
        sm59Store.delete(sm59Name);
        return sm59Reply(200, { status: 'success', data: { name: sm59Name, type: 'G', action: 'deleted' } });
      }

      return sm59Error(405, 'METHOD_NOT_ALLOWED', `${req.method} not supported on /sm59/${sm59Name}`);
    }

    // /sap/abap_cli/srfc/<name> and /oa2p/<name> (GET pull / POST upsert / DELETE)
    // — UCON RFC service / OAuth 2.0 client profile routes. Both are TADIR
    // objects, so the wire document carries the read-only `package`; POST
    // validates the modelled fields and upserts the store; DELETE removes the
    // entry. Statuses mirror the handlers: 404 absent, 400 invalid payload,
    // 405 unsupported method.
    const uconReply = (res, status, payload) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
    const uconNameProblem = (name) => {
      if (!name) return 'name is empty';
      if (name.length > 30) return `name must not exceed 30 characters (got ${name.length})`;
      if (!/^[A-Z0-9_/]+$/.test(name)) return `name may only contain A-Z, 0-9, '_' and '/' (got '${name}')`;
      return undefined;
    };

    const srfcRoute = /^\/sap\/abap_cli\/srfc(?:\/([^/]+))?$/.exec(path);
    if (srfcRoute) {
      const err = (status, code, message) => uconReply(res, status, { status: 'error', error: { code, message } });
      if (!srfcRoute[1]) return err(400, 'SRFC_NAME_INVALID', 'service name is required on /srfc/<name>');
      const name = decodeURIComponent(srfcRoute[1]).trim().toUpperCase();
      const nameProblem = uconNameProblem(name);
      if (nameProblem) return err(400, 'SRFC_NAME_INVALID', nameProblem);

      if (req.method === 'GET') {
        if (!srfcStore.has(name)) return err(404, 'SRFC_OBJECT_NOT_FOUND', `UCON RFC service ${name} not found`);
        return uconReply(res, 200, { status: 'success', data: srfcStore.get(name) });
      }
      if (req.method === 'POST') {
        const body = await readBody(req);
        let payload;
        try {
          payload = JSON.parse(body);
        } catch (_e) {
          return err(400, 'SRFC_INVALID_PAYLOAD', 'request body is not valid JSON');
        }
        const invalid = (message) => err(400, 'SRFC_INVALID_PAYLOAD', message);
        if (payload.formatVersion !== undefined && String(payload.formatVersion) !== '1') {
          return invalid(`formatVersion must be "1" (got "${String(payload.formatVersion)}")`);
        }
        if (payload.name !== undefined && String(payload.name).trim().toUpperCase() !== name) {
          return invalid(`payload name ${String(payload.name)} does not match URL service ${name}`);
        }
        const functionName = typeof payload.functionName === 'string' ? payload.functionName.trim().toUpperCase() : '';
        if (!functionName) return invalid('functionName is required');
        if (functionName.length > 30) return invalid(`functionName must not exceed 30 characters (got ${functionName.length})`);
        const scope = payload.scope === undefined ? '' : String(payload.scope).trim().toUpperCase();
        if (scope !== '' && !['E', 'O', 'P', 'S'].includes(scope)) {
          return invalid(`scope must be one of E, O, P, S or empty (got "${String(payload.scope)}")`);
        }
        const description = payload.description === undefined ? '' : String(payload.description);
        if (description.length > 255) return invalid(`description must not exceed 255 characters (got ${description.length})`);
        const defaultProfile = payload.defaultProfile === undefined ? '' : String(payload.defaultProfile).trim().toUpperCase();
        if (defaultProfile.length > 30) return invalid(`defaultProfile must not exceed 30 characters (got ${defaultProfile.length})`);
        const existed = srfcStore.has(name);
        const previous = existed ? srfcStore.get(name) : undefined;
        srfcStore.set(name, {
          formatVersion: '1',
          name,
          description,
          functionName,
          scope,
          defaultProfile,
          package: typeof payload.package === 'string' && payload.package.trim() ? payload.package.trim().toUpperCase() : (previous?.package ?? '$TMP'),
          createdBy: previous?.createdBy ?? CURRENT_USER,
          createdOn: previous?.createdOn ?? NOW.slice(0, 10),
          createdAt: previous?.createdAt ?? NOW.slice(11, 19),
          changedBy: existed ? CURRENT_USER : '',
          changedOn: existed ? NOW.slice(0, 10) : '',
          changedAt: existed ? NOW.slice(11, 19) : '',
        });
        return uconReply(res, 200, { status: 'success', data: { name, type: 'SRFC', action: existed ? 'updated' : 'created', package: srfcStore.get(name).package } });
      }
      if (req.method === 'DELETE') {
        if (!srfcStore.has(name)) return err(404, 'SRFC_OBJECT_NOT_FOUND', `UCON RFC service ${name} not found`);
        srfcStore.delete(name);
        return uconReply(res, 200, { status: 'success', data: { name, type: 'SRFC', action: 'deleted' } });
      }
      return err(405, 'METHOD_NOT_ALLOWED', `${req.method} not supported on /srfc/${name}`);
    }

    const oa2pRoute = /^\/sap\/abap_cli\/oa2p(?:\/([^/]+))?$/.exec(path);
    if (oa2pRoute) {
      const err = (status, code, message) => uconReply(res, status, { status: 'error', error: { code, message } });
      if (!oa2pRoute[1]) return err(400, 'OA2P_NAME_INVALID', 'OAuth2 profile name is required on /oa2p/<name>');
      const name = decodeURIComponent(oa2pRoute[1]).trim().toUpperCase();
      const nameProblem = uconNameProblem(name);
      if (nameProblem) return err(400, 'OA2P_NAME_INVALID', nameProblem);

      if (req.method === 'GET') {
        if (!oa2pStore.has(name)) return err(404, 'OA2P_OBJECT_NOT_FOUND', `OAuth2 profile ${name} not found`);
        return uconReply(res, 200, { status: 'success', data: oa2pStore.get(name) });
      }
      if (req.method === 'POST') {
        const body = await readBody(req);
        let payload;
        try {
          payload = JSON.parse(body);
        } catch (_e) {
          return err(400, 'OA2P_INVALID_PAYLOAD', 'request body is not valid JSON');
        }
        const invalid = (message) => err(400, 'OA2P_INVALID_PAYLOAD', message);
        if (payload.formatVersion !== undefined && String(payload.formatVersion) !== '1') {
          return invalid(`formatVersion must be "1" (got "${String(payload.formatVersion)}")`);
        }
        if (payload.name !== undefined && String(payload.name).trim().toUpperCase() !== name) {
          return invalid(`payload name ${String(payload.name)} does not match URL profile ${name}`);
        }
        const type = payload.type === undefined || String(payload.type).trim() === '' ? 'DEFAULT' : String(payload.type).trim().toUpperCase();
        if (type.length > 20) return invalid(`type must not exceed 20 characters (got ${type.length})`);
        if (payload.noAuthCheck !== undefined && typeof payload.noAuthCheck !== 'boolean') {
          return invalid('noAuthCheck must be a boolean');
        }
        const scopes = Array.isArray(payload.scopes) ? payload.scopes.map((scope) => String(scope).trim()).filter(Boolean) : [];
        const existed = oa2pStore.has(name);
        const previous = existed ? oa2pStore.get(name) : undefined;
        oa2pStore.set(name, {
          formatVersion: '1',
          name,
          type,
          noAuthCheck: payload.noAuthCheck === true,
          scopes,
          package: typeof payload.package === 'string' && payload.package.trim() ? payload.package.trim().toUpperCase() : (previous?.package ?? '$TMP'),
          createdBy: previous?.createdBy ?? CURRENT_USER,
          createdOn: previous?.createdOn ?? NOW.slice(0, 10),
          createdAt: previous?.createdAt ?? NOW.slice(11, 19),
          changedBy: CURRENT_USER,
          changedOn: NOW.slice(0, 10),
          changedAt: NOW.slice(11, 19),
        });
        return uconReply(res, 200, { status: 'success', data: { name, type: 'OA2P', action: existed ? 'updated' : 'created', package: oa2pStore.get(name).package } });
      }
      if (req.method === 'DELETE') {
        if (!oa2pStore.has(name)) return err(404, 'OA2P_OBJECT_NOT_FOUND', `OAuth2 profile ${name} not found`);
        oa2pStore.delete(name);
        return uconReply(res, 200, { status: 'success', data: { name, type: 'OA2P', action: 'deleted' } });
      }
      return err(405, 'METHOD_NOT_ALLOWED', `${req.method} not supported on /oa2p/${name}`);
    }

    // Generic AFF endpoint: /sap/abap_cli/aff/<TYPE>/<NAME>
    // (GET serialize / POST create / PUT update / DELETE).
    // Mirrors the bundled handler contract: TADIR type + name validation, the
    // same JSON envelope as the other ICF routes, `$`-prefixed packages are
    // transport-free, everything else needs a transport request, POST is
    // create-only (409 on an existing object), and multi-file bundles carry a
    // `files[]` list of { name, content } (UTF-8 text, not base64).
    const aff = /^\/sap\/abap_cli\/aff\/([^/]+)\/(.+)$/.exec(path);
    if (aff) {
      const affType = decodeURIComponent(aff[1]).toUpperCase();
      const affName = decodeURIComponent(aff[2]).toUpperCase();
      const affKey = `${affType}:${affName}`;
      const affError = (code, message) =>
        ok(res, JSON.stringify({ status: 'error', error: { code, message } }), 'application/json');
      if (!AFF_TYPES.has(affType)) {
        return affError('AFF_TYPE_INVALID', `AFF object type ${affType} is not supported by this release`);
      }
      if (!/^[A-Z0-9_/]+$/.test(affName) || affName.length > 40) {
        return affError('AFF_NAME_INVALID', `AFF object name ${affName} is invalid`);
      }
      if (req.method === 'GET') {
        if (!affStore.has(affKey)) {
          return affError('AFF_NOT_FOUND', `${affType} ${affName} not found`);
        }
        const stored = affStore.get(affKey);
        return ok(res, JSON.stringify({
          status: 'success',
          data: {
            type: stored.type,
            name: stored.name,
            package: stored.package,
            masterLanguage: stored.masterLanguage,
            files: stored.files,
          },
        }), 'application/json');
      }
      if (req.method === 'POST' || req.method === 'PUT') {
        const rawBody = await readBody(req);
        let payload;
        try {
          payload = JSON.parse(rawBody);
        } catch (_e) {
          return affError('AFF_FILE_INVALID', 'request body is not valid JSON');
        }
        const files = Array.isArray(payload && payload.files) ? payload.files : [];
        if (files.length === 0) {
          return affError('AFF_FILE_INVALID', 'files[] must carry at least the main AFF document');
        }
        for (const file of files) {
          if (!file || typeof file.name !== 'string' || !file.name || typeof file.content !== 'string') {
            return affError('AFF_FILE_INVALID', 'each file needs a name and a UTF-8 content string');
          }
          if (file.name.endsWith('.json')) {
            try {
              JSON.parse(file.content);
            } catch (_e) {
              return affError('AFF_FILE_INVALID', `${file.name} is not valid JSON`);
            }
          }
        }
        const existed = affStore.has(affKey);
        if (req.method === 'POST' && existed) {
          return affError('AFF_ALREADY_EXISTS', `${affType} ${affName} already exists`);
        }
        if (req.method === 'PUT' && !existed) {
          return affError('AFF_NOT_FOUND', `${affType} ${affName} not found`);
        }
        const requestedPackage = String(payload.package || '').trim().toUpperCase();
        let packageName;
        if (req.method === 'POST') {
          if (!requestedPackage) {
            return affError('AFF_PACKAGE_REQUIRED', 'package is required to create an AFF object');
          }
          packageName = requestedPackage;
        } else {
          packageName = existed ? affStore.get(affKey).package : (requestedPackage || '$TMP');
        }
        if (!isLocalPackage(packageName) && !payload.transportRequest) {
          return affError('AFF_TRANSPORT_REQUIRED', `transportRequest is required for non-local package ${packageName}`);
        }
        const stored = {
          type: affType,
          name: affName,
          package: packageName,
          masterLanguage: 'E',
          files: files.map((file) => ({ name: String(file.name), content: String(file.content) })),
        };
        affStore.set(affKey, stored);
        return ok(res, JSON.stringify({
          status: 'success',
          data: {
            type: affType,
            name: affName,
            package: packageName,
            action: existed ? 'updated' : 'created',
            activated: true,
            files: stored.files.map((file) => file.name),
          },
        }), 'application/json');
      }
      if (req.method === 'DELETE') {
        if (!affStore.has(affKey)) {
          return affError('AFF_NOT_FOUND', `${affType} ${affName} not found`);
        }
        const stored = affStore.get(affKey);
        if (!isLocalPackage(stored.package) && !q.get('transportRequest')) {
          return affError('AFF_TRANSPORT_REQUIRED', `transportRequest is required for non-local package ${stored.package}`);
        }
        affStore.delete(affKey);
        return ok(res, JSON.stringify({
          status: 'success',
          data: { type: affType, name: affName, package: stored.package, action: 'deleted' },
        }), 'application/json');
      }
      return affError('METHOD_NOT_ALLOWED', `${req.method} not supported on /aff/${affType}/${affName}`);
    }

    // 014: /sap/abap_cli/textpool/<category>?object=<name>&type=<type> (GET read / POST write).
    const textpool = /^\/sap\/abap_cli\/textpool\/(texts|selections|headings)$/.exec(path);
    if (textpool) {
      const category = textpool[1];
      const objName = (q.get('object') || '').toUpperCase();
      const objType = (q.get('type') || 'PROG').toUpperCase();
      if (!objName) {
        return ok(res, JSON.stringify({ status: 'error', error: { code: 'TEXTPOOL_OBJECT_NOT_FOUND', message: 'object query parameter is required' } }), 'application/json');
      }
      const key = `${objType}:${objName}:${category}`;
      if (req.method === 'GET') {
        if (TEXTPOOL_WRITE_UNSUPPORTED && !textpoolStore.has(key)) {
          return ok(res, JSON.stringify({ status: 'error', error: { code: 'TEXTPOOL_OBJECT_NOT_FOUND', message: `${objName} has no ${category} text elements` } }), 'application/json');
        }
        const elements = textpoolStore.get(key) || [];
        return ok(res, JSON.stringify({ status: 'success', data: { object: objName, type: objType, category, elements } }), 'application/json');
      }
      if (req.method === 'POST') {
        if (TEXTPOOL_WRITE_UNSUPPORTED) {
          return ok(res, JSON.stringify({ status: 'error', error: { code: 'TEXTPOOL_WRITE_FAILED', message: 'Simulated textpool write unsupported (MOCK_TEXTPOOL_WRITE_UNSUPPORTED=1)' } }), 'application/json');
        }
        const body = await readBody(req);
        let payload = { elements: [] };
        try { payload = JSON.parse(body); } catch (_e) { payload = { elements: [] }; }
        const elements = Array.isArray(payload.elements) ? payload.elements.map((el) => ({ id: String(el.id), text: String(el.text) })) : [];
        textpoolStore.set(key, elements);
        return ok(res, JSON.stringify({ status: 'success', data: { object: objName, type: objType, category, written: elements.length } }), 'application/json');
      }
      return ok(res, JSON.stringify({ status: 'error', error: { code: 'METHOD_NOT_ALLOWED', message: `${req.method} not supported on /textpool/${category}` } }), 'application/json');
    }

    // 016: /sap/abap_cli/data/query POST — read-only table data query.
    // Implements the subset of the contract documented in
    // Keep the mock response shapes aligned with the ICF /data contract.
    // US3 (T033) extends this with the full where grammar + safety injection.
    if (path === '/sap/abap_cli/data/query') {
      if (req.method !== 'POST') {
        return ok(res, JSON.stringify({ status: 'error', error: { code: 'METHOD_NOT_ALLOWED', message: 'POST only on /data/query' } }), 'application/json');
      }
      if (process.env.MOCK_AUTH_FAIL === '1') {
        res.statusCode = 401;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ status: 'error', error: { code: 'AUTH_ERROR', message: 'Simulated auth failure (MOCK_AUTH_FAIL=1)' } }));
        return;
      }
      const body = await readBody(req);
      let payload = {};
      try { payload = JSON.parse(body); } catch (_e) { payload = {}; }
      const table = String(payload.table || '').toUpperCase();
      if (!table) {
        return ok(res, JSON.stringify({ status: 'error', error: { code: 'INVALID_ARGUMENT', message: 'table is required' } }), 'application/json');
      }
      // MOCK_QUERY_FAIL=1 → simulate a runtime query failure (cx_root) for QUERY_FAILED tests.
      if (process.env.MOCK_QUERY_FAIL === '1') {
        return ok(res, JSON.stringify({ status: 'error', error: { code: 'QUERY_FAILED', message: 'Simulated runtime query failure (MOCK_QUERY_FAIL=1)' } }), 'application/json');
      }
      const meta = tableStore.get(table);
      if (!meta) {
        return ok(res, JSON.stringify({ status: 'error', error: { code: 'TABLE_NOT_FOUND', message: `table ${table} does not exist` } }), 'application/json');
      }
      if (meta.tabclass !== 'TRANSP' && meta.tabclass !== 'VIEW') {
        return ok(res, JSON.stringify({ status: 'error', error: { code: 'TABLE_TYPE_NOT_SUPPORTED', message: `table ${table} is of type ${meta.tabclass}; only TRANSP and VIEW are queryable`, details: { objectType: meta.tabclass } } }), 'application/json');
      }
      // Field validation — explicit invalid-field check (large-object rejection handled here).
      const validFields = meta.fields.map((f) => f.name);
      const requestedFields = Array.isArray(payload.fields) && payload.fields.length > 0
        ? payload.fields.map((f) => String(f).toUpperCase())
        : null;
      let outputFields;
      let excludedFields = [];
      if (requestedFields) {
        for (const f of requestedFields) {
          if (!validFields.includes(f)) {
            return ok(res, JSON.stringify({ status: 'error', error: { code: 'INVALID_FIELD', message: `field ${f} is not in table ${table}`, details: { validFields } } }), 'application/json');
          }
          const fieldDef = meta.fields.find((x) => x.name === f);
          if (LARGE_OBJECT_TYPES.has(fieldDef.dataType)) {
            return ok(res, JSON.stringify({ status: 'error', error: { code: 'INVALID_FIELD', message: `field ${f} is a large-object field (${fieldDef.dataType}) and is not supported for projection in v1` } }), 'application/json');
          }
        }
        outputFields = requestedFields;
      } else {
        // Auto-exclude large-object fields when no projection is specified.
        outputFields = [];
        meta.fields.forEach((f) => {
          if (LARGE_OBJECT_TYPES.has(f.dataType)) excludedFields.push(f.name);
          else outputFields.push(f.name);
        });
      }
      // Limit / offset server-side validation (mirror of ICF handler).
      const limit = payload.limit !== undefined ? Number(payload.limit) : 100;
      const offset = payload.offset !== undefined ? Number(payload.offset) : 0;
      if (!Number.isInteger(limit) || limit < 1 || limit > 10000) {
        return ok(res, JSON.stringify({ status: 'error', error: { code: 'LIMIT_EXCEEDED', message: `limit must be an integer in [1, 10000] (got ${payload.limit})` } }), 'application/json');
      }
      if (!Number.isInteger(offset) || offset < 0 || offset > 100000) {
        return ok(res, JSON.stringify({ status: 'error', error: { code: 'OFFSET_EXCEEDED', message: `offset must be an integer in [0, 100000] (got ${payload.offset})` } }), 'application/json');
      }
      // Order-by validation.
      const orderBy = Array.isArray(payload.orderBy) ? payload.orderBy : [];
      for (const ob of orderBy) {
        if (!ob || typeof ob.field !== 'string' || !validFields.includes(ob.field.toUpperCase())) {
          return ok(res, JSON.stringify({ status: 'error', error: { code: 'INVALID_FIELD', message: `orderBy field ${ob && ob.field} is not in table ${table}`, details: { validFields } } }), 'application/json');
        }
        if (ob.direction !== 'ASC' && ob.direction !== 'DESC') {
          return ok(res, JSON.stringify({ status: 'error', error: { code: 'INVALID_FIELD', message: `orderBy direction must be ASC or DESC (got ${ob.direction})` } }), 'application/json');
        }
      }
      const normalizedOrderBy = orderBy.map((ob) => ({ field: ob.field.toUpperCase(), direction: ob.direction }));
      // Where clause — strict AND-only grammar (US3). Mirrors the ABAP
      // `parse_where_clause` implementation so mock + real SAP agree.
      let parsedWhere;
      if (payload.where) {
        parsedWhere = parseWhereStrict(payload.where, meta.fields);
        if (!parsedWhere.ok) {
          return ok(res, JSON.stringify({
            status: 'error',
            error: {
              code: parsedWhere.code,
              message: `${parsedWhere.message} (offset ${parsedWhere.offset})`,
              details: { offset: parsedWhere.offset },
            },
          }), 'application/json');
        }
      } else {
        parsedWhere = { predicates: [] };
      }
      // Count-only path.
      if (payload.countOnly) {
        const counted = payload.where
          ? meta.rows.filter((row) => applyPredicates(row, parsedWhere.predicates))
          : meta.rows;
        return ok(res, JSON.stringify({ status: 'success', data: { table, count: counted.length, durationMs: 1 } }), 'application/json');
      }
      const filtered = payload.where ? meta.rows.filter((row) => applyPredicates(row, parsedWhere.predicates)) : meta.rows;
      const ordered = applyOrderBy(filtered, normalizedOrderBy);
      const probe = paginate(ordered, offset, limit + 1);
      const truncated = probe.length > limit;
      const finalRows = truncated ? probe.slice(0, limit) : probe;
      const projected = projectFields(finalRows, outputFields, meta.fields);
      return ok(res, JSON.stringify({
        status: 'success',
        data: {
          table,
          objectType: meta.tabclass === 'VIEW' ? 'VIEW' : 'TABL',
          fields: outputFields,
          rows: projected,
          rowCount: finalRows.length,
          truncated,
          excludedFields,
          durationMs: 1,
        },
      }), 'application/json');
    }

    /**
     * US3: strict AND-only where grammar — mirrors the ABAP `parse_where_clause`
     * implementation so mock-adt and the real ICF service agree on the syntax.
     * Returns { predicates: [], ok: true } on success or { ok: false, code, message, offset } on failure.
     *
     * Grammar:
     *   where := condition { "AND" condition }
     *   condition := field op value
     *   op := "=" | "<>" | ">" | ">=" | "<" | "<=" | "LIKE"
     *   field := [A-Za-z_][A-Za-z0-9_]*
     *   value := "'" <chars, '' for escape> "'" | [+-]?[0-9]+(\.[0-9]+)?
     */
    function parseWhereStrict(where, fields) {
      if (!where) return { ok: true, predicates: [] };
      const validFieldNames = new Set(fields.map((f) => f.name));
      const fieldMeta = new Map(fields.map((f) => [f.name, f]));

      function findAndIndex(s) {
        // Find AND as a standalone keyword. Since field names use only
        // [A-Za-z_][A-Za-z0-9_]* and AND has spaces around it in valid input,
        // a simple substring search is sufficient. Strings inside a value
        // would fail the value-parse step (unterminated literal) — handled
        // downstream.
        const lower = s.toLowerCase();
        const ix = lower.indexOf(' and ');
        if (ix < 0) return -1;
        return ix + 1; // start of 'AND'
      }

      let rest = where;
      let offset = 0;
      const predicates = [];

      while (rest.length > 0) {
        const consumed = where.length - rest.length;
        // Trim leading whitespace for the chunk but track offset.
        const leadingWs = rest.match(/^\s*/)[0].length;
        const chunkStart = offset + leadingWs;
        const andIx = findAndIndex(rest);
        let chunk;
        if (andIx < 0) {
          chunk = rest.trim();
          rest = '';
        } else {
          chunk = rest.substring(0, andIx).trim();
          rest = rest.substring(andIx + 3).replace(/^\s*/, '');
        }
        if (!chunk) {
          return { ok: false, code: 'INVALID_WHERE', message: 'empty condition', offset: chunkStart };
        }

        // Find the operator (longest match first).
        const ops = ['>=', '<=', '<>', '>', '<', '=', 'LIKE'];
        let op = null;
        let opStart = -1;
        let opLen = 0;
        for (const o of ops) {
          const ix = chunk.toUpperCase().indexOf(o.toUpperCase());
          if (ix >= 0 && (opStart < 0 || ix < opStart)) {
            op = o;
            opStart = ix;
            opLen = o.length;
          }
        }
        if (opStart <= 0) {
          return { ok: false, code: 'INVALID_WHERE', message: `condition '${chunk}' missing or invalid operator (use =, <>, >, >=, <, <=, LIKE)`, offset: chunkStart };
        }

        const fieldRaw = chunk.substring(0, opStart).trim();
        const valueRaw = chunk.substring(opStart + opLen).trim();
        if (!fieldRaw.match(/^[A-Za-z_][A-Za-z0-9_]*$/)) {
          return { ok: false, code: 'INVALID_WHERE', message: `field '${fieldRaw}' is invalid`, offset: chunkStart };
        }
        const field = fieldRaw.toUpperCase();
        if (field === 'MANDT') {
          return { ok: false, code: 'INVALID_WHERE', message: 'MANDT filter rejected (implicit session client only)', offset: chunkStart };
        }
        if (!validFieldNames.has(field)) {
          return { ok: false, code: 'INVALID_WHERE', message: `field '${field}' is not in table`, offset: chunkStart };
        }
        const fmeta = fieldMeta.get(field);

        // Value extraction.
        let valueKind = 'string';
        let valueStr = '';
        if (valueRaw.length > 0 && valueRaw[0] === "'") {
          // Find the matching closing quote, honouring '' escape.
          let i = 1;
          while (i < valueRaw.length) {
            if (valueRaw[i] === "'") {
              if (i + 1 < valueRaw.length && valueRaw[i + 1] === "'") {
                i += 2;
                continue;
              }
              break;
            }
            i++;
          }
          if (i >= valueRaw.length || valueRaw[i] !== "'") {
            return { ok: false, code: 'INVALID_WHERE', message: `unterminated string literal in condition '${chunk}'`, offset: chunkStart };
          }
          // Anything after the closing quote is residual — reject (e.g. trailing OR ...).
          const residual = valueRaw.substring(i + 1).trim();
          if (residual.length > 0) {
            return { ok: false, code: 'INVALID_WHERE', message: `unexpected tokens after value in condition '${chunk}' (use AND to chain conditions)`, offset: chunkStart };
          }
          valueStr = valueRaw.substring(1, i).replace(/''/g, "'");
          valueKind = 'string';
        } else if (valueRaw.match(/^[+-]?\d+(\.\d+)?$/)) {
          valueStr = valueRaw;
          valueKind = 'number';
        } else if (valueRaw.length > 0) {
          valueStr = valueRaw;
          valueKind = 'string';
        } else {
          return { ok: false, code: 'INVALID_WHERE', message: `missing value in condition '${chunk}'`, offset: chunkStart };
        }

        // Type adaptation.
        if (op === 'LIKE' && !['CHAR', 'NUMC', 'DATS', 'TIMS'].includes(fmeta.dataType)) {
          return { ok: false, code: 'INVALID_WHERE', message: `LIKE not supported on field ${field} (type ${fmeta.dataType})`, offset: chunkStart };
        }
        if (valueKind === 'number' && !['INT1', 'INT2', 'INT4', 'INT8', 'DEC', 'QUAN', 'CURR', 'FLTP'].includes(fmeta.dataType)) {
          return { ok: false, code: 'INVALID_WHERE', message: `numeric value '${valueStr}' not allowed on field ${field} (type ${fmeta.dataType})`, offset: chunkStart };
        }

        predicates.push({ field, operator: op, value: valueStr, valueKind });
        offset = chunkStart + chunk.length;
      }

      return { ok: true, predicates };
    }

    function applyPredicates(row, predicates) {
      if (!predicates || predicates.length === 0) return true;
      return predicates.every((p) => {
        const raw = row[p.field];
        if (raw === undefined) return false;
        const left = p.valueKind === 'number' ? Number(raw) : String(raw);
        const right = p.valueKind === 'number' ? Number(p.value) : String(p.value);
        switch (p.operator) {
          case '=':
            return left === right;
          case '<>':
            return left !== right;
          case '>':
            return left > right;
          case '>=':
            return left >= right;
          case '<':
            return left < right;
          case '<=':
            return left <= right;
          case 'LIKE': {
            const re = new RegExp(
              '^' +
                String(p.value)
                  .replace(/[.+^${}()|[\]\\]/g, '\\$&')
                  .replace(/%/g, '.*')
                  .replace(/_/g, '.') +
                '$',
            );
            return re.test(String(raw));
          }
          default:
            return false;
        }
      });
    }

    // 015: /sap/abap_cli/version-source?objectType=...&objectName=...&destination=...
    // Mirrors the real Version Management dispatch (active version 00000 source only).
    const versionSource = /^\/sap\/abap_cli\/version-source(?:\/.*)?$/.exec(path);
    if (versionSource) {
      if (req.method !== 'GET') {
        return ok(res, JSON.stringify({ status: 'error', error: { code: 'METHOD_NOT_ALLOWED', message: 'GET only on Version Management endpoints' } }), 'application/json');
      }
      const objType = (q.get('objectType') || '').toUpperCase();
      const objName = (q.get('objectName') || '').toUpperCase();
      const destination = (q.get('destination') || '').toUpperCase();
      if (!objType || !objName || !destination) {
        return ok(res, JSON.stringify({ status: 'error', error: { code: 'VERSION_PARAMETER_REQUIRED', message: 'objectType, objectName and destination query parameters are required' } }), 'application/json');
      }
      const SUPPORTED = ['REPS', 'REPO', 'TYPD', 'FUNC', 'CNTX', 'CINC', 'METH', 'CLSD', 'CPUB', 'CPRI', 'CPRO', 'INTF', 'XSLT'];
      if (!SUPPORTED.includes(objType)) {
        return ok(res, JSON.stringify({ status: 'error', error: { code: 'VERSION_TYPE_NOT_SUPPORTED', message: `unsupported Version Management object type: ${objType}` } }), 'application/json');
      }
      if (destination.length > 60 || !/^[A-Z0-9@._-]+$/.test(destination)) {
        return ok(res, JSON.stringify({ status: 'error', error: { code: 'VERSION_DESTINATION_INVALID', message: 'invalid RFC destination format' } }), 'application/json');
      }
      if (REMOTE_MISSING) {
        return ok(res, JSON.stringify({ status: 'success', data: { objectType: objType, objectName: objName, version: '00000', source: '' } }), 'application/json');
      }
      const key = `${objType}:${objName}`;
      const source = remoteSourceStore.get(key);
      if (source === undefined) {
        return ok(res, JSON.stringify({ status: 'error', error: { code: 'REMOTE_VERSION_NOT_FOUND', message: `active version (00000) could not be read for ${objName}` } }), 'application/json');
      }
      return ok(res, JSON.stringify({ status: 'success', data: { objectType: objType, objectName: objName, version: '00000', source } }), 'application/json');
    }

    // object search
    if (path === '/sap/bc/adt/repository/informationsystem/search' && req.method === 'GET') {
      const query = (q.get('query') || '').toUpperCase();
      const type = (q.get('objectType') || '').toUpperCase();
      const max = Math.max(1, Number(q.get('maxResults')) || 100);
      const packageHit = !type || type === 'DEVC' || 'DEVC/K'.startsWith(type);
      const packageMatches = packageHit
        ? [...packages.values()]
            .filter((p) => {
              const name = p.name.toUpperCase();
              return !query || name.includes(query) || query.includes(name);
            })
            .map((p) => ({
              name: p.name,
              type: 'DEVC/K',
              objectUrl: `/sap/bc/adt/packages/${encodeURIComponent(p.name.toLowerCase())}`,
              description: p.description,
              packageName: p.name,
            }))
        : [];
      // DDIC objects written through the ICF service are repository-searchable
      // in real SAP (the CLI resolves an update target's package that way), so
      // mirror them here: ddicStore is the mock's DDIC source of truth.
      const DDIC_SEARCH_TYPE = {
        TABL: 'TABL/DT',
        STRU: 'STRU/DS',
        DOMA: 'DOMA/DD',
        DTEL: 'DTEL/DE',
      };
      const DDIC_SEARCH_PATH = {
        TABL: 'tables',
        STRU: 'structures',
        DOMA: 'domains',
        DTEL: 'dataelements',
      };
      const ddicMatches = [...ddicStore.entries()]
        .map(([key, obj]) => {
          const ddicType = key.split(':')[0];
          const name = String(obj.name || key.slice(ddicType.length + 1)).toUpperCase();
          const description = obj.description || (obj.header && obj.header.description) || '';
          return {
            name,
            type: DDIC_SEARCH_TYPE[ddicType] || ddicType,
            objectUrl: `/sap/bc/adt/ddic/${DDIC_SEARCH_PATH[ddicType] || ddicType.toLowerCase()}/${name.toLowerCase()}`,
            description,
            packageName: obj.package || '$TMP',
          };
        })
        .filter((o) => {
          const nameOk = !query || o.name.includes(query) || query.includes(o.name);
          const typeOk = !type || o.type === type || o.type.startsWith(type);
          return nameOk && typeOk;
        });
      const matches = [
        ...packageMatches,
        ...ddicMatches,
        ...[...objects.values()].filter((o) => {
          const nameOk = !query || o.name.includes(query) || query.includes(o.name);
          const typeOk = !type || o.type === type || o.type.startsWith(type);
          return nameOk && typeOk;
        }),
      ].slice(0, max);
      const refs = matches
        .map(
          (o) =>
            `<adtcore:objectReference adtcore:name="${o.name}" adtcore:type="${o.type}" adtcore:uri="${o.objectUrl}" ` +
            `adtcore:description="${esc(o.description)}" adtcore:packageName="${o.packageName}"/>`,
        )
        .join('\n');
      return ok(
        res,
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
          `<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">\n${refs}\n</adtcore:objectReferences>`,
      );
    }

    // object creation (ADT createObject: POST to a creation path)
    if (req.method === 'POST' && !q.get('_action')) {
      const route = CREATE_ROUTES.find((r) => r.path === path);
      if (route) {
        const body = await readBody(req);
        const name = creationName(body, route);
        const descMatch = /adtcore:description="([^"]*)"/.exec(body);
        const description = descMatch?.[1] || '';
        if (!name) {
          return adtError(res, 400, 'Missing object name in create request body');
        }
        if (objects.has(name)) {
          return adtError(res, 409, `Object ${name} already exists`);
        }
        const obj = addObject(name, route.type, route.urlBase + name.toLowerCase(), description, skeletonParts(route.type, name));
        // Mirror real SAP semantics: a freshly created object is inactive
        // until an explicit activate call. The CLI's `create` happy-path
        // reports `activated:true` because it auto-runs activate after
        // createObject — that activate call (POST /activation) clears
        // this flag below.
        obj.inactive = true;
        return ok(res, '', 'application/xml');
      }
    }

    // ATC configuration objects (CHKC / CHKO / CHKV) — versioned XML resources.
    // The lifecycle mirrors real ADT: POST the collection, GET/PUT/DELETE the
    // per-object URL, with a locked PUT and an explicit activation.
    const atcMatch = /^\/sap\/bc\/adt\/atc\/(checkcategories|checks|checkvariants)(?:\/([^/]+))?$/.exec(path);
    if (atcMatch) {
      const type = ATC_COLLECTIONS[`/sap/bc/adt/atc/${atcMatch[1]}`];
      const name = atcMatch[2] ? decodeURIComponent(atcMatch[2]).toUpperCase() : undefined;
      const key = name ? `${type}:${name}` : '';
      if (req.method === 'POST' && !name) {
        const body = await readBody(req);
        const objectName = /adtcore:name="([^"]+)"/.exec(body)?.[1]?.toUpperCase();
        if (!objectName) return adtError(res, 400, 'Missing adtcore:name in ATC create body');
        if (atcObjects.has(`${type}:${objectName}`)) {
          return adtError(res, 409, `${type} ${objectName} already exists`);
        }
        const packageName = /adtcore:packageRef[^>]*adtcore:name="([^"]+)"/.exec(body)?.[1] || '$TMP';
        atcObjects.set(`${type}:${objectName}`, { xml: body, packageName });
        const obj = addObject(
          objectName,
          type,
          `/sap/bc/adt/atc/${atcMatch[1]}/${objectName.toLowerCase()}`,
          /adtcore:description="([^"]*)"/.exec(body)?.[1] || '',
          [],
          { packageName },
        );
        obj.inactive = true;
        return ok(res, body);
      }
      if (req.method === 'GET' && name) {
        const stored = atcObjects.get(key);
        if (!stored) return adtError(res, 404, `${type} ${name} not found`);
        return ok(res, stored.xml);
      }
      if (req.method === 'PUT' && name) {
        const stored = atcObjects.get(key);
        if (!stored) return adtError(res, 404, `${type} ${name} not found`);
        const obj = byObjectUrl(path);
        if (!obj || !obj.lockedBy || obj.lockedBy.lockHandle !== q.get('lockHandle')) {
          return adtError(res, 403, `${type} ${name} is not locked by this session`);
        }
        stored.xml = await readBody(req);
        return ok(res, stored.xml);
      }
      if (req.method === 'DELETE' && name) {
        const stored = atcObjects.get(key);
        if (!stored) return adtError(res, 404, `${type} ${name} not found`);
        const obj = byObjectUrl(path);
        if (!obj || !obj.lockedBy || obj.lockedBy.lockHandle !== q.get('lockHandle')) {
          return adtError(res, 403, `${type} ${name} is not locked by this session`);
        }
        atcObjects.delete(key);
        objects.delete(name);
        return ok(res, '');
      }
    }

    // Service bindings (SRVB): metadata-only resource + local publish jobs.
    const srvbMatch = /^\/sap\/bc\/adt\/businessservices\/bindings(?:\/([^/]+))?$/.exec(path);
    if (srvbMatch) {
      const srvbName = srvbMatch[1]?.toUpperCase();
      const srvbUrl = srvbName ? `/sap/bc/adt/businessservices/bindings/${srvbName.toLowerCase()}` : '';
      if (req.method === 'POST' && !srvbName) {
        const body = await readBody(req);
        const created = /adtcore:name="([^"]+)"/.exec(body)?.[1]?.toUpperCase();
        if (!created) return adtError(res, 400, 'Missing adtcore:name in service-binding create body');
        const description = /adtcore:description="([^"]*)"/.exec(body)?.[1] || '';
        const packageName = /adtcore:packageRef[^>]*adtcore:name="([^"]+)"/.exec(body)?.[1] || '$TMP';
        const serviceVersion = /srvb:content[^>]*srvb:version="([^"]+)"/.exec(body)?.[1] || '0001';
        const bindingVersion = /srvb:binding[^>]*srvb:version="([^"]+)"/.exec(body)?.[1] || 'V2';
        const serviceName = /srvb:services srvb:name="([^"]+)"/.exec(body)?.[1] || created;
        const stored = { name: created, description, packageName, serviceName, serviceVersion, bindingVersion, published: false };
        srvbStore.set(created, stored);
        const obj = addObject(created, 'SRVB', srvbUrl, description, [], { packageName });
        obj.inactive = true;
        return ok(res, '', 'text/plain');
      }
      if (srvbName && req.method === 'GET') {
        const stored = srvbStore.get(srvbName);
        if (!stored) return adtError(res, 404, `Service binding ${srvbName} not found`);
        return ok(res, srvbMetadataXml(stored));
      }
      if (srvbName && req.method === 'DELETE') {
        const obj = byObjectUrl(srvbUrl);
        if (!obj || !obj.lockedBy || obj.lockedBy.lockHandle !== q.get('lockHandle')) {
          return adtError(res, 403, `Service binding ${srvbName} is not locked by this session`);
        }
        srvbStore.delete(srvbName);
        objects.delete(srvbName);
        return ok(res, '');
      }
    }

    // Publish / unpublish jobs — {odatav2|odatav4}/{un,}publishjobs.
    const publishJobMatch = /^\/sap\/bc\/adt\/businessservices\/(odatav2|odatav4)\/(un)?publishjobs$/.exec(path);
    if (publishJobMatch && req.method === 'POST') {
      const serviceName = (q.get('servicename') || '').toUpperCase();
      const stored = srvbStore.get(serviceName);
      if (!stored) return adtError(res, 404, `Service ${serviceName} not found`);
      // The CLI must pick the protocol matching the binding version.
      const expectedType = stored.bindingVersion.toUpperCase() === 'V2' ? 'odatav2' : 'odatav4';
      if (publishJobMatch[1] !== expectedType) {
        return adtError(res, 400, `Binding ${serviceName} is ${stored.bindingVersion}, not ${publishJobMatch[1]}`);
      }
      const unpublish = Boolean(publishJobMatch[2]);
      stored.published = !unpublish;
      return ok(
        res,
        '<?xml version="1.0" encoding="UTF-8"?>' +
          '<asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values>' +
          '<SEVERITY>OK</SEVERITY>' +
          `<SHORT_TEXT>${unpublish ? 'un-published' : 'published'} ${serviceName} locally</SHORT_TEXT>` +
          '<LONG_TEXT></LONG_TEXT></asx:values></asx:abap>',
      );
    }

    // Type pools (TYPE / TYPE-POOL): /sap/bc/adt/ddic/typegroups.
    const typegroupMatch = /^\/sap\/bc\/adt\/ddic\/typegroups(?:\/([^/]+))?(\/source\/main)?$/.exec(path);
    if (typegroupMatch) {
      const tgName = typegroupMatch[1]?.toUpperCase();
      const tgSource = Boolean(typegroupMatch[2]);
      const tgKey = tgName ?? '';
      const tgUrl = tgName ? `/sap/bc/adt/ddic/typegroups/${tgName.toLowerCase()}` : '';
      if (req.method === 'POST' && !tgName) {
        const body = await readBody(req);
        const created = /adtcore:name="([^"]+)"/.exec(body)?.[1]?.toUpperCase();
        if (!created) return adtError(res, 400, 'Missing adtcore:name in type-group create body');
        if (typegroupStore.has(created)) return adtError(res, 400, `Type group ${created} already exists`);
        const packageName = /adtcore:packageRef[^>]*adtcore:name="([^"]+)"/.exec(body)?.[1] || '$TMP';
        const description = /adtcore:description="([^"]*)"/.exec(body)?.[1] || '';
        typegroupStore.set(created, { metaXml: body, source: '', packageName });
        const createdUrl = `/sap/bc/adt/ddic/typegroups/${created.toLowerCase()}`;
        const obj = addObject(created, 'TYPE', createdUrl, description, [], { packageName });
        obj.inactive = true;
        return ok(res, body);
      }
      if (tgName && tgSource && req.method === 'GET') {
        const stored = typegroupStore.get(tgKey);
        if (!stored) return adtError(res, 404, `Type group ${tgName} source not found`);
        return ok(res, stored.source, 'text/plain; charset=utf-8');
      }
      if (tgName && tgSource && req.method === 'PUT') {
        const stored = typegroupStore.get(tgKey);
        if (!stored) return adtError(res, 404, `Type group ${tgName} not found`);
        const obj = byObjectUrl(tgUrl);
        if (!obj || !obj.lockedBy || obj.lockedBy.lockHandle !== q.get('lockHandle')) {
          return adtError(res, 403, `Type group ${tgName} is not locked by this session`);
        }
        stored.source = await readBody(req);
        return ok(res, stored.source, 'text/plain; charset=utf-8');
      }
      if (tgName && !tgSource && req.method === 'GET') {
        const stored = typegroupStore.get(tgKey);
        if (!stored) return adtError(res, 404, `Type group ${tgName} not found`);
        let meta = stored.metaXml;
        if (stored.packageName && !/adtcore:packageRef/.test(meta)) {
          meta = meta.replace(/<\/([A-Za-z0-9]+:[A-Za-z0-9]+)>$/, `<adtcore:packageRef adtcore:name="${stored.packageName}"/></$1>`);
        }
        return ok(res, meta);
      }
      if (tgName && !tgSource && req.method === 'PUT') {
        const stored = typegroupStore.get(tgKey);
        if (!stored) return adtError(res, 404, `Type group ${tgName} not found`);
        const obj = byObjectUrl(tgUrl);
        if (!obj || !obj.lockedBy || obj.lockedBy.lockHandle !== q.get('lockHandle')) {
          return adtError(res, 403, `Type group ${tgName} is not locked by this session`);
        }
        stored.metaXml = await readBody(req);
        const desc = /adtcore:description="([^"]*)"/.exec(stored.metaXml)?.[1];
        if (desc !== undefined) obj.description = desc;
        const pkg = /adtcore:packageRef[^>]*adtcore:name="([^"]+)"/.exec(stored.metaXml)?.[1];
        if (pkg) stored.packageName = pkg;
        return ok(res, stored.metaXml);
      }
      if (tgName && !tgSource && req.method === 'DELETE') {
        const stored = typegroupStore.get(tgKey);
        if (!stored) return adtError(res, 404, `Type group ${tgName} not found`);
        const obj = byObjectUrl(tgUrl);
        if (!obj || !obj.lockedBy || obj.lockedBy.lockHandle !== q.get('lockHandle')) {
          return adtError(res, 403, `Type group ${tgName} is not locked by this session`);
        }
        typegroupStore.delete(tgKey);
        objects.delete(tgName);
        return ok(res, '');
      }
    }

    // CDS technical objects (DTDC / DTEB / DSFD / DSFI).
    const cdsMatch = /^\/sap\/bc\/adt\/ddic\/(dtdc|dteb|dsfd|drty)\/sources(?:\/([^/]+))?(\/source\/main)?$/.exec(path);
    const dsfiMatch = /^\/sap\/bc\/adt\/ddic\/dsfi(?:\/([^/]+))?(\/source\/main)?$/.exec(path);
    if (cdsMatch || dsfiMatch) {
      const type = cdsMatch ? cdsMatch[1].toUpperCase() : 'DSFI';
      const name = (cdsMatch ? cdsMatch[2] : dsfiMatch[1])?.toUpperCase();
      const isSource = Boolean((cdsMatch ? cdsMatch[3] : dsfiMatch[2]));
      const key = name ? `${type}:${name}` : '';
      const objectUrl = name
        ? (cdsMatch ? `/sap/bc/adt/ddic/${cdsMatch[1]}/sources/${name.toLowerCase()}` : `/sap/bc/adt/ddic/dsfi/${name.toLowerCase()}`)
        : '';
      if (req.method === 'POST' && !name) {
        const body = await readBody(req);
        const objectName = /adtcore:name="([^"]+)"/.exec(body)?.[1]?.toUpperCase();
        if (!objectName) return adtError(res, 400, 'Missing adtcore:name in CDS technical create body');
        if (cdsTechStore.has(`${type}:${objectName}`)) {
          return adtError(res, 409, `${type} ${objectName} already exists`);
        }
        const packageName = /adtcore:packageRef[^>]*adtcore:name="([^"]+)"/.exec(body)?.[1] || '$TMP';
        const description = /adtcore:description="([^"]*)"/.exec(body)?.[1] || '';
        cdsTechStore.set(`${type}:${objectName}`, { metaXml: body, source: '', packageName });
        const obj = addObject(
          objectName,
          type,
          cdsMatch ? `/sap/bc/adt/ddic/${cdsMatch[1]}/sources/${objectName.toLowerCase()}` : `/sap/bc/adt/ddic/dsfi/${objectName.toLowerCase()}`,
          description,
          [],
          { packageName },
        );
        obj.inactive = true;
        return ok(res, body);
      }
      if (name && isSource && req.method === 'GET') {
        const stored = cdsTechStore.get(key);
        if (!stored) return adtError(res, 404, `${type} ${name} source not found`);
        return ok(res, stored.source, type === 'DSFI' ? 'application/json' : 'text/plain; charset=utf-8');
      }
      if (name && isSource && req.method === 'PUT') {
        const stored = cdsTechStore.get(key);
        if (!stored) return adtError(res, 404, `${type} ${name} source not found`);
        const obj = byObjectUrl(objectUrl);
        if (!obj || !obj.lockedBy || obj.lockedBy.lockHandle !== q.get('lockHandle')) {
          return adtError(res, 403, `${type} ${name} is not locked by this session`);
        }
        stored.source = await readBody(req);
        return ok(res, stored.source, type === 'DSFI' ? 'application/json' : 'text/plain; charset=utf-8');
      }
      if (name && !isSource && req.method === 'GET') {
        const stored = cdsTechStore.get(key);
        if (!stored) return adtError(res, 404, `${type} ${name} not found`);
        // Metadata PUTs omit the package reference but real ADT keeps serving
        // it; re-inject it so the CLI's transport rule sees the package.
        let meta = stored.metaXml;
        if (stored.packageName && !/adtcore:packageRef/.test(meta)) {
          meta = meta.replace(/<\/([A-Za-z0-9]+:[A-Za-z0-9]+)>$/, `<adtcore:packageRef adtcore:name="${stored.packageName}"/></$1>`);
        }
        return ok(res, meta);
      }
      if (name && !isSource && req.method === 'PUT') {
        const stored = cdsTechStore.get(key);
        if (!stored) return adtError(res, 404, `${type} ${name} not found`);
        const obj = byObjectUrl(objectUrl);
        if (!obj || !obj.lockedBy || obj.lockedBy.lockHandle !== q.get('lockHandle')) {
          return adtError(res, 403, `${type} ${name} is not locked by this session`);
        }
        stored.metaXml = await readBody(req);
        const desc = /adtcore:description="([^"]*)"/.exec(stored.metaXml)?.[1];
        if (desc !== undefined) obj.description = desc;
        // Metadata PUTs omit the package reference; ADT keeps the package.
        const pkg = /adtcore:packageRef[^>]*adtcore:name="([^"]+)"/.exec(stored.metaXml)?.[1];
        if (pkg) stored.packageName = pkg;
        return ok(res, stored.metaXml);
      }
      if (name && !isSource && req.method === 'DELETE') {
        const stored = cdsTechStore.get(key);
        if (!stored) return adtError(res, 404, `${type} ${name} not found`);
        const obj = byObjectUrl(objectUrl);
        if (!obj || !obj.lockedBy || obj.lockedBy.lockHandle !== q.get('lockHandle')) {
          return adtError(res, 403, `${type} ${name} is not locked by this session`);
        }
        cdsTechStore.delete(key);
        objects.delete(name);
        return ok(res, '');
      }
    }

    // Application jobs (SAJC / SAJT) — blueSource create + JSON source/main.
    const appjobMatch = /^\/sap\/bc\/adt\/applicationjob\/(catalogs|templates)(?:\/([^/]+))?(\/source\/main)?(?:\/\$schema)?$/.exec(path);
    if (appjobMatch) {
      const type = appjobMatch[1] === 'catalogs' ? 'SAJC' : 'SAJT';
      const collection = `/sap/bc/adt/applicationjob/${appjobMatch[1]}`;
      const rawName = appjobMatch[2];
      const isSchema = rawName === '$schema';
      const name = rawName && !isSchema ? rawName.toUpperCase() : undefined;
      const isSource = Boolean(appjobMatch[3]);
      const key = name ? `${type}:${name}` : '';
      const objectUrl = name ? `${collection}/${name.toLowerCase()}` : collection;
      if (isSchema && req.method === 'GET') {
        return ok(
          res,
          JSON.stringify({ $schema: 'https://json-schema.org/draft/2020-12/schema', properties: APPJOB_SCHEMAS[APPJOB_MODEL][type] }),
          'application/vnd.sap.adt.objecttypeschema.v1+json',
        );
      }
      if (req.method === 'POST' && !name) {
        const body = await readBody(req);
        const objectName = /adtcore:name="([^"]+)"/.exec(body)?.[1]?.toUpperCase();
        if (!objectName) return adtError(res, 400, `Missing adtcore:name in ${type} create body`);
        if (appjobStore.has(`${type}:${objectName}`)) {
          return adtError(res, 409, `${type} ${objectName} already exists`);
        }
        const packageName = /adtcore:packageRef[^>]*adtcore:name="([^"]+)"/.exec(body)?.[1] || '$TMP';
        const description = /adtcore:description="([^"]*)"/.exec(body)?.[1] || '';
        const defaultSource =
          APPJOB_MODEL === 'nested'
            ? JSON.stringify(
                {
                  formatVersion: '1',
                  header: { description, originalLanguage: 'en' },
                  generalInformation: type === 'SAJC' ? { className: '' } : { catalogName: '' },
                },
                null,
                2,
              )
            : JSON.stringify(
                {
                  formatVersion: '1',
                  header: { description, originalLanguage: 'en' },
                  ...(type === 'SAJC' ? { className: '' } : { catalogName: '' }),
                },
                null,
                2,
              );
        appjobStore.set(`${type}:${objectName}`, { metaXml: body, source: defaultSource, packageName });
        const createdUrl = `${collection}/${objectName.toLowerCase()}`;
        const obj = addObject(objectName, type, createdUrl, description, [], { packageName });
        obj.inactive = true;
        return ok(res, body);
      }
      if (name && isSource && req.method === 'GET') {
        const stored = appjobStore.get(key);
        if (!stored) return adtError(res, 404, `${type} ${name} source not found`);
        return ok(res, stored.source, 'application/json');
      }
      if (name && isSource && req.method === 'PUT') {
        const stored = appjobStore.get(key);
        if (!stored) return adtError(res, 404, `${type} ${name} source not found`);
        const obj = byObjectUrl(objectUrl);
        if (!obj || !obj.lockedBy || obj.lockedBy.lockHandle !== q.get('lockHandle')) {
          return adtError(res, 403, `${type} ${name} is not locked by this session`);
        }
        const body = await readBody(req);
        try {
          JSON.parse(body);
        } catch {
          return adtError(res, 400, `${type} ${name}: source/main is not a JSON document`);
        }
        stored.source = body;
        return ok(res, body, 'application/json');
      }
      if (name && !isSource && req.method === 'GET') {
        const stored = appjobStore.get(key);
        if (!stored) return adtError(res, 404, `${type} ${name} not found`);
        let meta = stored.metaXml;
        if (stored.packageName && !/adtcore:packageRef/.test(meta)) {
          meta = meta.replace(/<\/([A-Za-z0-9]+:[A-Za-z0-9]+)>$/, `<adtcore:packageRef adtcore:name="${stored.packageName}"/></$1>`);
        }
        return ok(res, meta);
      }
      if (name && !isSource && req.method === 'PUT') {
        const stored = appjobStore.get(key);
        if (!stored) return adtError(res, 404, `${type} ${name} not found`);
        const obj = byObjectUrl(objectUrl);
        if (!obj || !obj.lockedBy || obj.lockedBy.lockHandle !== q.get('lockHandle')) {
          return adtError(res, 403, `${type} ${name} is not locked by this session`);
        }
        stored.metaXml = await readBody(req);
        const desc = /adtcore:description="([^"]*)"/.exec(stored.metaXml)?.[1];
        if (desc !== undefined) obj.description = desc;
        const pkg = /adtcore:packageRef[^>]*adtcore:name="([^"]+)"/.exec(stored.metaXml)?.[1];
        if (pkg) stored.packageName = pkg;
        return ok(res, stored.metaXml);
      }
      if (name && !isSource && req.method === 'DELETE') {
        const stored = appjobStore.get(key);
        if (!stored) return adtError(res, 404, `${type} ${name} not found`);
        const obj = byObjectUrl(objectUrl);
        if (!obj || !obj.lockedBy || obj.lockedBy.lockHandle !== q.get('lockHandle')) {
          return adtError(res, 403, `${type} ${name} is not locked by this session`);
        }
        appjobStore.delete(key);
        objects.delete(name);
        return ok(res, '');
      }
    }

    // Generic AFF objects over ADT blueSource resources
    // (APLO / CHDO / EVTB / SMBC). `source/main` is the official AFF JSON, so
    // the mock mirrors the real contract: POST collection (create) /
    // GET metadata / GET source / locked PUT source (+ activation through the
    // generic /activation handler) / DELETE object.
    const adtAffMatch = /^(\/sap\/bc\/adt\/(?:applicationlog\/objects|changedocuments\/objects|businessservices\/evtbevb|bct\/smbctyp))(?:\/([^/]+))?(\/source\/main)?$/.exec(path);
    if (adtAffMatch) {
      const collection = adtAffMatch[1];
      const type = ADT_AFF_COLLECTIONS[collection];
      const rawName = adtAffMatch[2];
      const isSource = Boolean(adtAffMatch[3]);
      const name = rawName ? rawName.toUpperCase() : undefined;
      const key = name ? `${type}:${name}` : '';
      const objectUrl = name ? `${collection}/${name.toLowerCase()}` : collection;
      if (req.method === 'POST' && !name) {
        const body = await readBody(req);
        const objectName = /adtcore:name="([^"]+)"/.exec(body)?.[1]?.toUpperCase();
        if (!objectName) return adtError(res, 400, `Missing adtcore:name in ${type} create body`);
        if (adtAffStore.has(`${type}:${objectName}`)) {
          return adtError(res, 409, `${type} ${objectName} already exists`);
        }
        const packageName = /adtcore:packageRef[^>]*adtcore:name="([^"]+)"/.exec(body)?.[1] || '$TMP';
        const description = /adtcore:description="([^"]*)"/.exec(body)?.[1] || '';
        adtAffStore.set(`${type}:${objectName}`, { metaXml: body, source: '', packageName });
        const obj = addObject(objectName, type, `${collection}/${objectName.toLowerCase()}`, description, [], { packageName });
        obj.inactive = true;
        return ok(res, body);
      }
      if (name && isSource && req.method === 'GET') {
        const stored = adtAffStore.get(key);
        if (!stored) return adtError(res, 404, `${type} ${name} source not found`);
        return ok(res, stored.source, 'application/json');
      }
      if (name && isSource && req.method === 'PUT') {
        const stored = adtAffStore.get(key);
        if (!stored) return adtError(res, 404, `${type} ${name} source not found`);
        const obj = byObjectUrl(objectUrl);
        if (!obj || !obj.lockedBy || obj.lockedBy.lockHandle !== q.get('lockHandle')) {
          return adtError(res, 403, `${type} ${name} is not locked by this session`);
        }
        const body = await readBody(req);
        try {
          JSON.parse(body);
        } catch {
          return adtError(res, 400, `${type} ${name}: source/main is not a JSON document`);
        }
        stored.source = body;
        return ok(res, body, 'application/json');
      }
      if (name && !isSource && req.method === 'GET') {
        const stored = adtAffStore.get(key);
        if (!stored) return adtError(res, 404, `${type} ${name} not found`);
        // Metadata PUTs omit the package reference but real ADT keeps serving
        // it; re-inject it so the CLI's transport rule sees the package.
        let meta = stored.metaXml;
        if (stored.packageName && !/adtcore:packageRef/.test(meta)) {
          meta = meta.replace(/<\/([A-Za-z0-9]+:[A-Za-z0-9]+)>$/, `<adtcore:packageRef adtcore:name="${stored.packageName}"/></$1>`);
        }
        return ok(res, meta);
      }
      if (name && !isSource && req.method === 'PUT') {
        const stored = adtAffStore.get(key);
        if (!stored) return adtError(res, 404, `${type} ${name} not found`);
        const obj = byObjectUrl(objectUrl);
        if (!obj || !obj.lockedBy || obj.lockedBy.lockHandle !== q.get('lockHandle')) {
          return adtError(res, 403, `${type} ${name} is not locked by this session`);
        }
        stored.metaXml = await readBody(req);
        const desc = /adtcore:description="([^"]*)"/.exec(stored.metaXml)?.[1];
        if (desc !== undefined) obj.description = desc;
        return ok(res, stored.metaXml);
      }
      if (name && !isSource && req.method === 'DELETE') {
        const stored = adtAffStore.get(key);
        if (!stored) return adtError(res, 404, `${type} ${name} not found`);
        adtAffStore.delete(key);
        objects.delete(name);
        return ok(res, '');
      }
    }

    // lock / unlock (POST on objectUrl)
    if (req.method === 'POST' && q.get('_action') === 'LOCK') {
      const obj = byObjectUrl(path);
      if (!obj) return adtError(res, 404, `Object not found: ${path}`);
      if (obj.lockedBy) return adtError(res, 400, `Object ${obj.name} is locked by user ${obj.lockedBy.user}`);
      obj.lockedBy = { user: CURRENT_USER, lockHandle: `lock-${Date.now()}` };
      return ok(res, lockXml(obj.lockedBy.lockHandle));
    }
    if (req.method === 'POST' && q.get('_action') === 'UNLOCK') {
      const obj = byObjectUrl(path);
      if (!obj) return adtError(res, 404, `Object not found: ${path}`);
      if (!obj.lockedBy || obj.lockedBy.lockHandle !== q.get('lockHandle')) {
        return adtError(res, 400, 'Invalid lock handle');
      }
      obj.lockedBy = null;
      return ok(res, '');
    }

    // setObjectSource (PUT on sourceUrl)
    if (req.method === 'PUT') {
      const found = bySourceUrl(path);
      if (!found) return adtError(res, 404, `Source not found: ${path}`);
      const { owner, part } = found;
      if (!owner.lockedBy || owner.lockedBy.lockHandle !== q.get('lockHandle')) {
        return adtError(res, 403, `Object ${owner.name} is not locked by this session`);
      }
      putCount += 1;
      if (ATOMIC_FAIL && putCount === 2) {
        return adtError(res, 500, 'Simulated mid-batch write failure (MOCK_ATOMIC_FAIL=1)');
      }
      part.content = await readBody(req);
      // transport assign: writing identical content with corrNr attaches the
      // object to that transport (mirrors how the CLI reuses setObjectSource).
      const corrNr = q.get('corrNr');
      if (corrNr && DETAIL_TRANSPORTS.has(corrNr)) {
        objectTransports.set(owner.name, corrNr);
      }
      return ok(res, '');
    }

    // content-based syntax check
    if (path === '/sap/bc/adt/checkruns' && req.method === 'POST') {
      const body = await readBody(req);
      const sourceUrl = /<chkrun:checkObject[^>]*adtcore:uri="([^"]+)"/.exec(body)?.[1] ?? '';
      const artifact = /<chkrun:artifact[^>]*chkrun:uri="([^"]+)"[^>]*>/.exec(body);
      const contentMatch = /<chkrun:content>([^<]*)<\/chkrun:content>/.exec(body);
      const inclUrl = artifact?.[1] ?? sourceUrl;
      const content = contentMatch ? Buffer.from(contentMatch[1], 'base64').toString('utf-8') : '';
      return ok(res, checkXml(sourceUrl, inclUrl, validateSource(content)));
    }

    // activation — list inactive objects (GET). Mirrors real ADT response
    // shape: ioc:inactiveObjects root with ioc:entry children, each holding
    // an ioc:object (or ioc:transport) wrapping an ioc:ref element whose
    // attributes carry adtcore:uri/type/name. abap-adt-api's
    // inactiveObjects() expects this exact structure.
    //
    // URI convention: use the object's objectUrl so the CLI's activate
    // filter (`uri.split('#')[0] === resolved.objectUrl`) matches cleanly.
    // Real SAP typically emits the per-include sourceUrl with a #fragment
    // marker; the CLI's filter strips the fragment and would also accept
    // that form, but emitting the bare objectUrl keeps the mock contract
    // simple and matches what abap-adt-api's activate() function expects
    // for the POST body.
    if (path === '/sap/bc/adt/activation/inactiveobjects' && req.method === 'GET') {
      const entries = [];
      for (const obj of objects.values()) {
        if (!obj.inactive) continue;
        const mainPart = obj.parts.find((p) => p.subtype === 'main') ?? obj.parts[0];
        const includeType = obj.type === 'CLAS' ? '/MA' : '/1';
        const fragment = mainPart && mainPart.sourceUrl !== obj.objectUrl ? `#${obj.name.toLowerCase()}` : '';
        entries.push(
          `<ioc:entry>` +
            `<ioc:object ioc:user="${CURRENT_USER}">` +
              `<ioc:ref adtcore:uri="${esc(obj.objectUrl)}${fragment}" ` +
              `adtcore:type="${esc(obj.type)}${includeType}" ` +
              `adtcore:name="${esc(obj.name)}"/>` +
            `</ioc:object>` +
          `</ioc:entry>`,
        );
      }
      const xml =
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<ioc:inactiveObjects xmlns:ioc="http://www.sap.com/adt/activation" ' +
        'xmlns:adtcore="http://www.sap.com/adt/core" ' +
        'xmlns:chkl="http://www.sap.com/adt/checklist">\n' +
        entries.join('\n') +
        '\n</ioc:inactiveObjects>';
      return ok(res, xml);
    }

    // activation — POST the items to activate. Real SAP returns an envelope
    // with chkl:messages and any remaining ioc:inactiveObjects; we mirror
    // the empty success shape (same as before) but also clear the
    // `inactive` flag on every activated object so a follow-up
    // /inactiveobjects call reports zero items.
    if (path === '/sap/bc/adt/activation' && req.method === 'POST') {
      const body = await readBody(req);
      for (const uri of body.matchAll(/adtcore:uri="([^"]+)"/g)) {
        const obj = byAnyUrl(uri[1]);
        if (obj) {
          obj.active = true;
          obj.inactive = false;
        }
      }
      return ok(
        res,
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
          '<ioc:inactiveObjects xmlns:ioc="http://www.sap.com/adt/activation" xmlns:chkl="http://www.sap.com/adt/checklist"/>',
      );
    }

    // user transports
    if (path === '/sap/bc/adt/cts/transportrequests' && req.method === 'GET') {
      return ok(res, transportXml());
    }

    // create transport (ADT createTransport: POST /sap/bc/adt/cts/transports)
    if (path === '/sap/bc/adt/cts/transports' && req.method === 'POST') {
      const body = await readBody(req);
      const devclass = /<DEVCLASS>([^<]*)<\/DEVCLASS>/.exec(body)?.[1] ?? '';
      const requestText = /<REQUEST_TEXT>([^<]*)<\/REQUEST_TEXT>/.exec(body)?.[1] ?? '';
      if (!requestText.trim()) {
        return adtError(res, 400, 'Transport request text must not be empty');
      }
      transportSeq += 1;
      const number = `TRN${String(transportSeq).padStart(3, '0')}`;
      createdTransports.push({
        number,
        owner: CURRENT_USER,
        desc: requestText,
        status: 'D',
        uri: `/sap/bc/adt/cts/transportrequests/${number}`,
      });
      // abap-adt-api takes the last path segment of the response as the transport number
      return ok(res, `/sap/bc/adt/cts/transportrequests/${number}`, 'text/plain');
    }

    // transportInfo (POST /sap/bc/adt/cts/transportchecks) — which request owns an object
    if (path === '/sap/bc/adt/cts/transportchecks' && req.method === 'POST') {
      const body = await readBody(req);
      const uri = /<URI>([^<]*)<\/URI>/.exec(body)?.[1] ?? '';
      const owner = bySourceUrl(uri)?.owner ?? byObjectUrl(uri);
      const trNumber = owner ? objectTransports.get(owner.name) : undefined;
      const tr = trNumber ? DETAIL_TRANSPORTS.get(trNumber) : undefined;
      return ok(
        res,
        transportInfoXml(tr ? [{ number: tr.number, status: tr.status, owner: tr.owner, desc: tr.desc }] : []),
        'application/vnd.sap.as+xml;charset=UTF-8;dataname=com.sap.adt.transport.service.checkData',
      );
    }

    // transportDetails (GET /sap/bc/adt/cts/transportrequests/<number>)
    if (path.startsWith('/sap/bc/adt/cts/transportrequests/') && req.method === 'GET') {
      const number = path.split('/').pop();
      const found = [...DETAIL_TRANSPORTS.values()].find((r) => r.number === number);
      if (found) {
        return ok(res, transportDetailsXml(found), 'application/vnd.sap.adt.transportorganizer.v1+xml');
      }
      return adtError(res, 404, `Transport request ${number} not found`);
    }

    // ATC: checkVariant (POST /sap/bc/adt/atc/worklists?checkVariant=<v>)
    if (path === '/sap/bc/adt/atc/worklists' && req.method === 'POST') {
      const variant = q.get('checkVariant');
      if (!variant || !ATC_VARIANTS.has(variant)) return adtError(res, 404, `Unknown ATC variant: ${variant}`);
      return ok(res, variant, 'text/plain');
    }

    // ATC: createAtcRun (POST /sap/bc/adt/atc/runs?worklistId=<variant>)
    if (path === '/sap/bc/adt/atc/runs' && req.method === 'POST') {
      const variant = q.get('worklistId');
      if (!variant || !ATC_VARIANTS.has(variant)) return adtError(res, 404, `Unknown ATC variant: ${variant}`);
      atcSeq += 1;
      const runId = `RUN${String(atcSeq).padStart(3, '0')}`;
      atcRuns.set(runId, { variant, timestamp: NOW });
      return ok(res, atcRunXml(runId, variant), 'application/xml');
    }

    // ATC: worklist (GET /sap/bc/adt/atc/worklists/<runId>)
    if (path.startsWith('/sap/bc/adt/atc/worklists/') && req.method === 'GET') {
      const runId = path.split('/').pop();
      const run = atcRuns.get(runId);
      if (!run) return adtError(res, 404, `Unknown ATC run: ${runId}`);
      return ok(res, atcWorklistXml(run), 'application/atc.worklist.v1+xml');
    }

    // validateNewObject (POST /sap/bc/adt/oo/validation/objectname)
    if (path === '/sap/bc/adt/oo/validation/objectname' && req.method === 'POST') {
      const objname = (q.get('objname') || '').toUpperCase();
      const objtype = q.get('objtype') || '';
      if (!objname || !objtype) return adtError(res, 400, 'Missing objname/objtype for validation');
      if (objname.startsWith('ZBAD_')) {
        return ok(res, validateXml('ERROR', `Object name ${objname} is not allowed`, ''), 'application/xml');
      }
      return ok(res, validateXml('INFO', `${objname} is available`, 'X'), 'application/xml');
    }

    // object structure / source read (GET)
    if (req.method === 'GET') {
      const found = bySourceUrl(path);
      if (found) return ok(res, found.part.content, 'text/plain; charset=utf-8');
      const obj = byObjectUrl(path);
      if (obj) return ok(res, structureXml(obj), 'application/xml');
      return adtError(res, 404, `Resource not found: ${path}`);
    }

    return adtError(res, 404, `Unhandled route: ${req.method} ${path}`);
  } catch (error) {
    adtError(res, 500, error instanceof Error ? error.message : String(error));
  }
});

server.listen(PORT, () => {
  const names = [...objects.keys()].join(', ');
  console.log(`Mock ADT listening on http://localhost:${PORT}`);
  console.log(`Fixture objects: ${names}`);
  console.log(`NO_TRANSPORTS=${NO_TRANSPORTS ? 'on' : 'off'} (TRN001 available)`);
  console.log(`ATOMIC_FAIL=${ATOMIC_FAIL ? 'on (2nd PUT fails)' : 'off'}`);
});
