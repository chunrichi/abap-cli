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
const NOW = '2026-08-01T00:00:00Z';
const CURRENT_USER = 'MOCKUSER';

// ---------- fixture store ----------
const objects = new Map();

function addObject(name, type, objectUrl, description, parts, opts = {}) {
  objects.set(name, {
    name,
    type,
    objectUrl,
    description,
    packageName: '$TMP',
    active: true,
    lockedBy: opts.lockedBy ?? null, // { user, lockHandle }
    parts,
  });
}

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
    subtype: 'locals_imp',
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
    subtype: 'locals_imp',
    sourceUrl: '/sap/bc/adt/oo/classes/zcl_syntax_error/source/locals_imp',
    content: '',
  },
]);

addObject('ZCL_LOCKED', 'CLAS', '/sap/bc/adt/oo/classes/zcl_locked', 'Class locked by another user', [
  {
    subtype: 'main',
    sourceUrl: '/sap/bc/adt/oo/classes/zcl_locked/source/main',
    content: 'CLASS zcl_locked DEFINITION PUBLIC.\nENDCLASS.\n',
  },
  {
    subtype: 'locals_imp',
    sourceUrl: '/sap/bc/adt/oo/classes/zcl_locked/source/locals_imp',
    content: '',
  },
], { lockedBy: { user: 'OTHER', lockHandle: 'lock-other' } });

addObject('ZPROG', 'PROG', '/sap/bc/adt/programs/programs/zprog', 'Demo report', [
  {
    subtype: 'main',
    sourceUrl: '/sap/bc/adt/programs/programs/zprog/source/main',
    content: "REPORT zprog.\nWRITE: / 'hello mock'.\n",
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
    parts.push({ subtype: 'locals_imp', sourceUrl: `${base}/source/locals_imp`, content: '' });
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
const SUBTYPE_TO_INCLUDE_TYPE = {
  main: 'main',
  locals_def: 'definitions',
  locals_imp: 'implementations',
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
    `abapsource:sourceUri="${main.sourceUrl}" program:programType="1" program:lockedByEditor="false"/>`
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

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  const q = url.searchParams;

  try {
    // login / compatibility
    if (path === '/sap/bc/adt/compatibility/graph') {
      return ok(res, '{}', 'application/json');
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
      part.content = await readBody(req);
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
});
