/**
 * Mock-parity contract tests.
 *
 * The mock ADT server historically lacked two endpoints that real SAP
 * exposes — see `tests/260902001-all-commands-fugr-e2e/summary.md`:
 *   - GET /sap/bc/adt/activation/inactiveobjects  (consumed by `abap activate`)
 *   - GET /sap/bc/adt/discovery                   (consumed by `abap doctor`)
 *
 * These tests start the mock, drive the two HTTP paths, and assert that the
 * wire response shape matches what the CLI's ADTClient / runtime probe
 * parse. They are intentionally HTTP-level (not CLI-level) so they don't
 * require a populated OS keychain or a configured ~/.abap-cli profile.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const MOCK = resolve(ROOT, 'test/mock-adt/server.js');
const PORT = 8090;

let mockProc: ChildProcess;

beforeAll(async () => {
  mockProc = await new Promise<ChildProcess>((resolveP, rejectP) => {
    const proc = spawn('node', [MOCK, String(PORT)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const onData = (chunk: Buffer) => {
      if (chunk.toString().includes('Mock ADT listening')) {
        proc.stdout?.off('data', onData);
        resolveP(proc);
      }
    };
    proc.stdout?.on('data', onData);
    proc.on('error', rejectP);
    setTimeout(() => rejectP(new Error('mock-adt startup timeout')), 5000);
  });
});

afterAll(() => {
  mockProc.kill('SIGTERM');
});

async function get(path: string, accept = 'application/xml'): Promise<{ status: number; body: string; contentType: string }> {
  const res = await fetch(`http://localhost:${PORT}${path}`, {
    method: 'GET',
    headers: { Accept: accept },
  });
  return {
    status: res.status,
    body: await res.text(),
    contentType: res.headers.get('content-type') ?? '',
  };
}

async function post(path: string, body: string, contentType = 'application/xml', accept = 'application/xml'): Promise<{ status: number; body: string }> {
  const res = await fetch(`http://localhost:${PORT}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': contentType, Accept: accept },
    body,
  });
  return { status: res.status, body: await res.text() };
}

describe('mock-parity: discovery endpoint (doctor probe)', () => {
  it('GET /sap/bc/adt/discovery returns 200 with an Atom service document', async () => {
    const res = await get('/sap/bc/adt/discovery', 'application/atomsvc+xml');
    expect(res.status).toBe(200);
    expect(res.contentType).toContain('atomsvc');
    expect(res.body).toContain('<app:service');
    expect(res.body).toContain('<app:workspace');
    // Include the ICF collection so the runtime probe classifies as netweaver750
    // (matches the on-prem S/4HANA signature real SAP exposes).
    expect(res.body).toContain('/sap/bc/adt/icf/');
    // Include at least one ABAP collection the CLI checks for.
    expect(res.body).toContain('/sap/bc/adt/oo/classes');
  });
});

describe('mock-parity: activate inactive-object enumeration endpoint', () => {
  // Helper that creates a CLAS object and returns its objectUrl. The body
  // shape mirrors abap-adt-api's createBody (class:abapClass + adtcore
  // attributes); the mock just looks for adtcore:name + adtcore:description.
  async function createClass(name: string): Promise<string> {
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<class:abapClass xmlns:class="http://www.sap.com/adt/oo/classes" xmlns:adtcore="http://www.sap.com/adt/core"
  adtcore:description="mp-test" adtcore:name="${name}" adtcore:type="CLAS/OC"
  adtcore:language="EN" adtcore:masterLanguage="EN"
  adtcore:responsible="MOCKUSER">
  <adtcore:packageRef adtcore:name="$TMP"/>
</class:abapClass>`;
    const r = await post('/sap/bc/adt/oo/classes', body);
    expect(r.status).toBe(200);
    return `/sap/bc/adt/oo/classes/${name.toLowerCase()}`;
  }

  it('GET /sap/bc/adt/activation/inactiveobjects returns 200 with empty list when nothing is inactive', async () => {
    // Newly started mock has no inactive objects.
    const res = await get('/sap/bc/adt/activation/inactiveobjects');
    expect(res.status).toBe(200);
    expect(res.body).toContain('<ioc:inactiveObjects');
    // Empty payload is OK: <ioc:inactiveObjects ... /> or <ioc:inactiveObjects ...></ioc:inactiveObjects>
    expect(res.body).not.toContain('<ioc:entry>');
  });

  it('createObject → newly created class appears in /inactiveobjects; activate clears it', async () => {
    const name = `ZMP_NEW_${Date.now()}`;
    const objectUrl = await createClass(name);

    // After create, the object should be reported inactive.
    const beforeRes = await get('/sap/bc/adt/activation/inactiveobjects');
    expect(beforeRes.status).toBe(200);
    expect(beforeRes.body).toContain(`adtcore:name="${name}"`);
    // The CLI's activate flow matches on objectUrl (URI prefix before any
    // #fragment). The mock emits the objectUrl directly.
    expect(beforeRes.body).toContain(`adtcore:uri="${objectUrl}`);

    // Activate it.
    const activateBody = `<?xml version="1.0" encoding="UTF-8"?>
<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
  <adtcore:objectReference adtcore:uri="${objectUrl}" adtcore:type="CLAS" adtcore:name="${name}" adtcore:parentUri="${objectUrl}"/>
</adtcore:objectReferences>`;
    const activateRes = await post('/sap/bc/adt/activation?method=activate', activateBody);
    expect(activateRes.status).toBe(200);

    // After activation, the object must NOT be in /inactiveobjects.
    const afterRes = await get('/sap/bc/adt/activation/inactiveobjects');
    expect(afterRes.status).toBe(200);
    expect(afterRes.body).not.toContain(`adtcore:name="${name}"`);
  });
});

describe('mock-parity: pre-existing fixtures remain active by default', () => {
  it('pre-seeded ZCL_DEMO is NOT in inactiveobjects (activate should no-op)', async () => {
    const res = await get('/sap/bc/adt/activation/inactiveobjects');
    expect(res.status).toBe(200);
    expect(res.body).not.toContain('adtcore:name="ZCL_DEMO"');
  });
});