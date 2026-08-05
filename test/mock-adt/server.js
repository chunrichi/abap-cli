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
// MOCK_AUTH_FAIL=1 → compatibility graph returns 401 (auth layer failure for `connection test`).
const AUTH_FAIL = process.env.MOCK_AUTH_FAIL === '1';
// MOCK_ICF_FAIL=1 → /sap/zabap_vibe/ returns 500 (icf layer failure for `connection test`).
const ICF_FAIL = process.env.MOCK_ICF_FAIL === '1';
// MOCK_SETUP_FAIL=1 → classrun of the ICF setup class returns a failure envelope.
const SETUP_FAIL = process.env.MOCK_SETUP_FAIL === '1';
// Deployed zabap_vibe version served by the mock root (mirrors CLI ICF_SERVICE_VERSION).
const ICF_SERVICE_VERSION = process.env.MOCK_ICF_VERSION || '0.1.0';
const NOW = '2026-08-01T00:00:00Z';
const CURRENT_USER = 'MOCKUSER';
let putCount = 0; // global PUT counter (MOCK_ATOMIC_FAIL fails on the 2nd write)

// ---------- fixture store ----------
const objects = new Map();

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
    `abapsource:sourceUri="${main.sourceUrl}" program:programType="${obj.programType}" program:lockedByEditor="false"/>`
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

// ---------- ATC (check --atc, US2/US3) ----------
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

    // self-built ICF service root (probeIcf target for `connection test` / `doctor`)
    if (path === '/sap/zabap_vibe/') {
      if (ICF_FAIL) return adtError(res, 500, 'Simulated ICF failure (MOCK_ICF_FAIL=1)');
      return ok(res, JSON.stringify({ status: 'success', data: { service: 'zabap_vibe', version: ICF_SERVICE_VERSION } }), 'application/json');
    }

    // ADT classrun (runClass) — simulates the remote ICF setup execution (013).
    const classrun = /^\/sap\/bc\/adt\/oo\/classrun\/([^/?]+)/.exec(path);
    if (classrun && req.method === 'POST') {
      const className = classrun[1].toUpperCase();
      if (className === 'ZCL_ABAP_VIBE_ICF_SETUP') {
        if (SETUP_FAIL) return ok(res, JSON.stringify({ status: 'error', error: { code: 'ICF_ADMIN_REQUIRED', message: 'Simulated setup failure (MOCK_SETUP_FAIL=1)' } }), 'application/json');
        return ok(res, JSON.stringify({ status: 'success', action: 'already_active', node: { vhost: 'default_host', url: '/sap/zabap_vibe', handler: 'ZCL_ABAP_VIBE_ICF', active: true } }), 'application/json');
      }
      return ok(res, JSON.stringify({ status: 'success' }), 'application/json');
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
