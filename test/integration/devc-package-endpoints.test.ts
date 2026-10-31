/**
 * DEVC (package) mock-parity contract.
 *
 * The mock ADT server now serves the package resource the CLI uses for
 * `create DEVC` / `pull DEVC` / `delete DEVC`. The response shapes here are
 * copies of what a real S/4HANA system returned during the DEVC end-to-end
 * run; this suite pins the wire contract the CLI parsers rely on.
 *
 * Intentionally HTTP-level (no CLI process / keychain) like the other
 * mock-parity suites.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const MOCK = resolve(ROOT, 'test/integration/mock-adt/server.js');
const PORT = 8091;
const BASE = `http://localhost:${PORT}`;

let mockProc: ChildProcess;

beforeAll(async () => {
  mockProc = await new Promise<ChildProcess>((resolveP, rejectP) => {
    const proc = spawn('node', [MOCK, String(PORT)], { stdio: ['ignore', 'pipe', 'pipe'] });
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

async function request(
  path: string,
  opts: { method?: string; body?: string; contentType?: string; accept?: string } = {},
): Promise<{ status: number; body: string; contentType: string }> {
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      Accept: opts.accept ?? 'application/vnd.sap.adt.packages.v2+xml',
      ...(opts.contentType ? { 'Content-Type': opts.contentType } : {}),
    },
    ...(opts.body !== undefined ? { body: opts.body } : {}),
  });
  return { status: res.status, body: await res.text(), contentType: res.headers.get('content-type') ?? '' };
}

function createBody(name: string, superPackage: string, softwareComponent: string, description = 'mock package'): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<pak:package xmlns:pak="http://www.sap.com/adt/packages" xmlns:adtcore="http://www.sap.com/adt/core"
  adtcore:description="${description}" adtcore:name="${name}" adtcore:type="DEVC/K"
  adtcore:version="active" adtcore:responsible="MOCKUSER">
  <adtcore:packageRef adtcore:name="${superPackage}"/>
  <pak:attributes pak:packageType="development"/>
  <pak:superPackage adtcore:name="${superPackage}"/>
  <pak:applicationComponent/>
  <pak:transport>
    <pak:softwareComponent pak:name="${softwareComponent}"/>
    <pak:transportLayer pak:name=""/>
  </pak:transport>
  <pak:translation/>
  <pak:useAccesses/>
  <pak:packageInterfaces/>
  <pak:subPackages/>
</pak:package>`;
}

const pkgPath = (name: string) => `/sap/bc/adt/packages/${encodeURIComponent(name)}`;

describe('DEVC mock parity: package read', () => {
  it('GET $TMP returns the pak:package envelope with LOCAL software component', async () => {
    const res = await request(pkgPath('$TMP'));
    expect(res.status).toBe(200);
    expect(res.contentType).toContain('application/vnd.sap.adt.packages.v2+xml');
    expect(res.body).toContain('<pak:package');
    expect(res.body).toContain('adtcore:name="$TMP"');
    expect(res.body).toContain('adtcore:type="DEVC/K"');
    expect(res.body).toContain('<pak:softwareComponent pak:name="LOCAL"/>');
    expect(res.body).toContain('pak:packageType="development"');
  });

  it('GET a sub package returns superPackage + cloud language version (real-SAP field names)', async () => {
    const res = await request(pkgPath('ZDEV'));
    expect(res.status).toBe(200);
    expect(res.body).toContain('<pak:superPackage adtcore:type="DEVC/K" adtcore:name="ZLOCAL"/>');
    expect(res.body).toContain('pak:languageVersion="5"');
  });

  it('GET a namespaced package returns switch + application component + use accesses', async () => {
    const res = await request(pkgPath('/MOCK/SWITCHED'));
    expect(res.status).toBe(200);
    expect(res.body).toContain('adtcore:name="/MOCK/SWITCHED"');
    expect(res.body).toContain('<pak:switch adtcore:type="SFSW/6S" adtcore:name="/MOCK/SWITCH_ECC"');
    expect(res.body).toContain('<pak:applicationComponent pak:name="BC-SRV"');
    expect(res.body).toContain('<pak:useAccess pak:severity="none">');
    expect(res.body).toContain('adtcore:name="SABP_MAIN_PUBLIC"');
  });

  it('GET a missing package answers 404', async () => {
    const res = await request(pkgPath('$NO_SUCH_PACKAGE'));
    expect(res.status).toBe(404);
  });
});

describe('DEVC mock parity: name validation', () => {
  const validate = async (qs: string): Promise<{ status: number; body: string }> => {
    const res = await fetch(`${BASE}/sap/bc/adt/packages/validation?${qs}`, {
      method: 'POST',
      headers: { Accept: 'application/*' },
    });
    return { status: res.status, body: await res.text() };
  };

  it('accepts a $-prefixed LOCAL package name', async () => {
    const res = await validate('objtype=DEVC%2FK&objname=%24MOCK_OK&description=x&packagename=%24TMP&swcomp=LOCAL&transportLayer=&packagetype=development');
    expect(res.status).toBe(200);
    expect(res.body).toContain('<SEVERITY>OK</SEVERITY>');
  });

  it("rejects a LOCAL name without the '$'/'TEST' prefix with SAP's wording", async () => {
    const res = await validate('objtype=DEVC%2FK&objname=ZNOT_LOCAL&description=x&packagename=%24TMP&swcomp=LOCAL&transportLayer=&packagetype=development');
    expect(res.status).toBe(200);
    expect(res.body).toContain('<SEVERITY>ERROR</SEVERITY>');
    expect(res.body).toContain("Names of LOCAL packages must start with '$' or 'TEST'");
  });

  it('rejects an empty software component', async () => {
    const res = await validate('objtype=DEVC%2FK&objname=%24MOCK_OK&description=x&packagename=%24TMP&swcomp=&transportLayer=&packagetype=development');
    expect(res.body).toContain('<SEVERITY>ERROR</SEVERITY>');
    expect(res.body).toContain('No software component specified');
  });
});

describe('DEVC mock parity: create / delete / update', () => {
  it('POST creates a package, GET reads it back, DELETE removes it', async () => {
    const create = await request('/sap/bc/adt/packages', {
      method: 'POST',
      contentType: 'application/*',
      accept: 'application/*',
      body: createBody('$MOCK_CREATED', '$TMP', 'LOCAL', 'created by mock test'),
    });
    expect(create.status).toBe(201);
    expect(create.body).toContain('adtcore:name="$MOCK_CREATED"');
    expect(create.body).toContain('adtcore:description="created by mock test"');

    const read = await request(pkgPath('$MOCK_CREATED'));
    expect(read.status).toBe(200);
    expect(read.body).toContain('<pak:superPackage adtcore:type="DEVC/K" adtcore:name="$TMP"/>');

    const del = await request(pkgPath('$MOCK_CREATED'), { method: 'DELETE', accept: 'application/*' });
    expect(del.status).toBe(200);

    const after = await request(pkgPath('$MOCK_CREATED'));
    expect(after.status).toBe(404);
  });

  it('POST rejects a duplicate package name', async () => {
    const res = await request('/sap/bc/adt/packages', {
      method: 'POST',
      contentType: 'application/*',
      accept: 'application/*',
      body: createBody('$TMP', '$TMP', 'LOCAL'),
    });
    expect(res.status).toBe(400);
    expect(res.body).toContain('already exists');
  });

  it('PUT is rejected by the resource controller (no package update in ADT)', async () => {
    const res = await request(pkgPath('ZDEV'), {
      method: 'PUT',
      contentType: 'application/xml',
      accept: 'application/*',
      body: '<x/>',
    });
    expect(res.status).toBe(405);
    expect(res.body).toContain('Resource controller does not support method PUT');
  });

  it('DELETE of a missing package answers 404', async () => {
    const res = await request(pkgPath('$NO_SUCH_PACKAGE'), { method: 'DELETE', accept: 'application/*' });
    expect(res.status).toBe(404);
  });

  it('DELETE of a package with sub packages is rejected', async () => {
    const res = await request(pkgPath('ZLOCAL'), { method: 'DELETE', accept: 'application/*' });
    expect(res.status).toBe(400);
    expect(res.body).toContain('子包');
  });
});

describe('DEVC mock parity: search', () => {
  it('search with objectType=DEVC returns DEVC/K object references', async () => {
    const res = await request(
      '/sap/bc/adt/repository/informationsystem/search?query=ZDEV&objectType=DEVC&maxResults=10',
      { accept: 'application/xml' },
    );
    expect(res.status).toBe(200);
    expect(res.body).toContain('adtcore:type="DEVC/K"');
    expect(res.body).toContain('adtcore:name="ZDEV"');
    expect(res.body).toContain('adtcore:uri="/sap/bc/adt/packages/zdev"');
  });
});
