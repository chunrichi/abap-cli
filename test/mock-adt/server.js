#!/usr/bin/env node
/**
 * Mock ADT server for offline verification of `abap pull` / `abap push` / `abap check`.
 *
 * Implements the subset of /sap/bc/adt endpoints consumed by abap-adt-api:
 *   compatibility/graph (login), repository search, object structure, source
 *   GET/PUT, lock/unlock, checkruns (content-based syntax check), activation,
 *   cts/transportrequests.
 *
 * Usage:  node test/mock-adt/server.js [port]
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
// MOCK_ICF_FAIL=1 → /sap/zabap_vibe/ returns 500 (icf layer failure for `profile test`).
const ICF_FAIL = process.env.MOCK_ICF_FAIL === '1';
// MOCK_SETUP_FAIL=1 → classrun of the ICF setup class returns a failure envelope.
const SETUP_FAIL = process.env.MOCK_SETUP_FAIL === '1';
// MOCK_DDIC_FAIL=1 → /sap/zabap_vibe/ddic/<type> POST returns 500 (created objects still
// occupy the fixture store but the wire response is the failure envelope).
// MOCK_TEXTPOOL_WRITE_UNSUPPORTED=1 → /textpool/<category> POST reports write unsupported
// (simulates ECC where the ADT text-elements write endpoint is absent).
const TEXTPOOL_WRITE_UNSUPPORTED = process.env.MOCK_TEXTPOOL_WRITE_UNSUPPORTED === '1';
const DDIC_FAIL = process.env.MOCK_DDIC_FAIL === '1';
// MOCK_REMOTE_MISSING=1 → /version-source reports no transported versions (empty source),
// mirroring the real backend's SVRS_GET_VERSIONS empty case.
const REMOTE_MISSING = process.env.MOCK_REMOTE_MISSING === '1';
// Deployed zabap_vibe version served by the mock root (mirrors CLI ICF_SERVICE_VERSION).
const ICF_SERVICE_VERSION = process.env.MOCK_ICF_VERSION || '0.4.0';
const NOW = '2026-08-01T00:00:00Z';
const CURRENT_USER = 'MOCKUSER';
let putCount = 0; // global PUT counter (MOCK_ATOMIC_FAIL fails on the 2nd write)

// ---------- fixture store ----------
const objects = new Map();
// 014: temporary in-memory store for DDIC create/overwrite payloads (round-trip tests).
const ddicStore = new Map();
// 014: textpool store — key = `<TYPE>:<OBJ>:<CATEGORY>`, value = array of { id, text }.
const textpoolStore = new Map();
// 015: remote source store — key = `<TYPE>:<OBJ>`, value = source string served by /version-source.
const remoteSourceStore = new Map();
// 016: read-only table data store — key = <TABLE>, value = { tabclass, fields, rows }.
// Seeded below with ZTAB_FIXTURE (150 rows, clientDependent, mixed types).
const tableStore = new Map();
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
  objects.set(name, {
    name,
    type,
    objectUrl,
    description,
    packageName: opts.packageName ?? '$TMP',
    active: true,
    lockedBy: opts.lockedBy ?? null, // { user, lockHandle }
    programType: opts.programType ?? '1', // ADT program:programType
    parts,
  });
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
]);

// 015: remote (Version Management) sources served by /version-source — keyed TYPE:NAME.
remoteSourceStore.set('REPS:ZPROG', "REPORT zprog.\nWRITE: / 'production version'.\n");
remoteSourceStore.set('INTF:ZIF_DEMO', 'INTERFACE zif_demo.\n  METHODS run.\nENDINTERFACE.\n');
remoteSourceStore.set('CLSD:ZCL_DEMO', 'CLASS zcl_demo DEFINITION PUBLIC.\n  PUBLIC SECTION.\n    METHODS run.\nENDCLASS.\n');

// ICF service classes (013): handler + setup, targets for deploy enumeration / classrun.
addObject('ZCL_ABAP_VIBE_ICF', 'CLAS', '/sap/bc/adt/oo/classes/zcl_abap_vibe_icf', 'ICF handler for zabap_vibe', [
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
  res.writeHead(200, { 'Content-Type': type });
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

    // self-built ICF service root (probeIcf target for `profile test` / `doctor`)
    if (path === '/sap/zabap_vibe/') {
      if (ICF_FAIL) return adtError(res, 500, 'Simulated ICF failure (MOCK_ICF_FAIL=1)');
      return ok(res, JSON.stringify({ status: 'success', data: { service: 'zabap_vibe', version: ICF_SERVICE_VERSION } }), 'application/json');
    }

    // ADT classrun (runClass) — simulates the remote ICF setup execution (013)
    // and the runner wrapper execution (015).
    const classrun = /^\/sap\/bc\/adt\/oo\/classrun\/([^/?]+)/.exec(path);
    if (classrun && req.method === 'POST') {
      const className = classrun[1].toUpperCase();
      if (className === 'ZCL_ABAP_VIBE_ICF_SETUP') {
        if (SETUP_FAIL) return ok(res, JSON.stringify({ status: 'error', error: { code: 'ICF_ADMIN_REQUIRED', message: 'Simulated setup failure (MOCK_SETUP_FAIL=1)' } }), 'application/json');
        return ok(res, JSON.stringify({ status: 'success', action: 'already_active', node: { vhost: 'default_host', url: '/sap/zabap_vibe', handler: 'ZCL_ABAP_VIBE_ICF', active: true } }), 'application/json');
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

    // 014: /sap/zabap_vibe/ddic/<type> POST (create/overwrite) and GET /<name> (pull).
    const ddic = /^\/sap\/zabap_vibe\/ddic\/(doma|dtel|tabl|stru)(?:\/(.+))?$/.exec(path);
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
        if (payload.package && payload.package !== '$TMP' && !payload.transportRequest) {
          return ok(res, JSON.stringify({ status: 'error', error: { code: 'DDIC_TRANSPORT_REQUIRED', message: 'transportRequest is required for non-$TMP packages' } }), 'application/json');
        }
        if (ddicType === 'TABL' || ddicType === 'STRU') {
          if (!Array.isArray(payload.fields) || payload.fields.length === 0) {
            return ok(res, JSON.stringify({ status: 'error', error: { code: 'DDIC_REQUIRED_FIELD', message: 'fields list is required and must be non-empty' } }), 'application/json');
          }
        }
        if (ddicType === 'DOMA') {
          if (!payload.dataType || payload.length === undefined) {
            return ok(res, JSON.stringify({ status: 'error', error: { code: 'DDIC_REQUIRED_FIELD', message: 'dataType and length are required' } }), 'application/json');
          }
        }
        if (ddicType === 'DTEL') {
          if (!payload.description) {
            return ok(res, JSON.stringify({ status: 'error', error: { code: 'DDIC_REQUIRED_FIELD', message: 'description is required' } }), 'application/json');
          }
          if (!payload.domain && !payload.dataType) {
            return ok(res, JSON.stringify({ status: 'error', error: { code: 'DDIC_INVALID_FIELD', message: 'domain or built-in dataType is required' } }), 'application/json');
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

    // 014: /sap/zabap_vibe/textpool/<category>?object=<name>&type=<type> (GET read / POST write).
    const textpool = /^\/sap\/zabap_vibe\/textpool\/(texts|selections|headings)$/.exec(path);
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

    // 016: /sap/zabap_vibe/data/query POST — read-only table data query.
    // Implements the subset of the contract documented in
    // specs/016-abap-select/contracts/icf-data-service.md used by US1 unit tests.
    // US3 (T033) extends this with the full where grammar + safety injection.
    if (path === '/sap/zabap_vibe/data/query') {
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

    // 015: /sap/zabap_vibe/version-source?objectType=...&objectName=...&destination=...
    // Mirrors the real Version Management dispatch (active version 00000 source only).
    const versionSource = /^\/sap\/zabap_vibe\/version-source(?:\/.*)?$/.exec(path);
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
      const matches = [...objects.values()]
        .filter((o) => {
          const nameOk = !query || o.name.includes(query) || query.includes(o.name);
          const typeOk = !type || o.type === type || o.type.startsWith(type);
          return nameOk && typeOk;
        })
        .slice(0, max);
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
        addObject(name, route.type, route.urlBase + name.toLowerCase(), description, skeletonParts(route.type, name));
        return ok(res, '', 'application/xml');
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

    // activation
    if (path === '/sap/bc/adt/activation' && req.method === 'POST') {
      const body = await readBody(req);
      for (const uri of body.matchAll(/adtcore:uri="([^"]+)"/g)) {
        const obj = byObjectUrl(uri[1].split('?')[0]);
        if (obj) obj.active = true;
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
