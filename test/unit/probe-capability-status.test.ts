/**
 * `profile test` capability probe — HTTP status classification.
 *
 * `abap-adt-api` throws on every non-2xx response instead of resolving with a
 * response object, so the capability matrix can only read the status off the
 * exception (`.err` on AdtErrorException, `.status` on AdtHttpException).
 * A 2xx–4xx answer proves the endpoint is deployed — 4xx just means the object
 * is missing or not authorized — while 5xx / a status-less network failure
 * means absent. Pin that contract for all four paths here.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  logout: vi.fn(),
  request: vi.fn(),
  getSystem: vi.fn(),
  upsertSystem: vi.fn(),
  getPassword: vi.fn(),
}));

vi.mock('abap-adt-api', () => ({
  ADTClient: vi.fn().mockImplementation(function () {
    return {
      login: (...a: unknown[]) => mocks.login(...a),
      logout: (...a: unknown[]) => mocks.logout(...a),
      httpClient: { request: (...a: unknown[]) => mocks.request(...a) },
    };
  }),
}));

vi.mock('../../src/abap_cli/config/user-config.js', () => ({
  getSystem: (...a: unknown[]) => mocks.getSystem(...a),
  upsertSystem: (...a: unknown[]) => mocks.upsertSystem(...a),
}));

vi.mock('../../src/abap_cli/config/secrets.js', () => ({
  getPassword: (...a: unknown[]) => mocks.getPassword(...a),
}));

vi.mock('../../src/abap_cli/clients/basic-auth.js', () => ({
  buildBasicAuth: () => ({ password: 'pw', options: {} }),
}));

vi.mock('../../src/abap_cli/config/project-config.js', () => ({
  readCaCertificate: () => undefined,
}));

import { probeSystem } from '../../src/abap_cli/clients/probe.js';

const PROFILE = {
  url: 'http://127.0.0.1:9', // http → TLS layer is skipped
  client: '100',
  username: 'dev',
  language: 'EN',
};

/** Kernel-release Atom fragment the probe parses from /system/information. */
const KERNEL_XML =
  '<atom:feed><atom:entry><atom:id>KernelRelease</atom:id><atom:title>S4</atom:title></atom:entry></atom:feed>';

/** The per-type capability endpoints (ADT + ICF). DDLS has no ICF handler. */
const CAPABILITY_PATHS = [
  '/sap/bc/adt/ddic/tabletypes/LVC_T_TABL',
  '/sap/bc/adt/messageclass/SADT_TOOLS_CORE',
  '/sap/bc/adt/ddic/ddl/sources/I_ABAPAPPLICATIONCOMPONENT',
  '/sap/abap_cli/ddic/ttyp/LVC_T_TABL',
  '/sap/abap_cli/ddic/msag/SADT_TOOLS_CORE',
];

/** Resolve the discovery / ICF-root / kernel-release probes; route the rest. */
function baseRequest(capability: (path: string) => Promise<unknown>) {
  return (path: string): Promise<unknown> => {
    if (CAPABILITY_PATHS.includes(path)) return capability(path);
    if (path.includes('/system/information')) return Promise.resolve({ status: 200, body: KERNEL_XML });
    return Promise.resolve({ status: 200, body: '' });
  };
}

/** Error shaped like abap-adt-api's: `.err` for AdtErrorException,
 *  `.status` for AdtHttpException. */
function statusError(status: number, field: 'err' | 'status'): Error {
  return Object.assign(new Error(`HTTP ${status}`), field === 'err' ? { err: status } : { status });
}

describe('profile test capability probe — HTTP status', () => {
  beforeEach(() => {
    mocks.login.mockReset().mockResolvedValue(undefined);
    mocks.logout.mockReset().mockResolvedValue(undefined);
    mocks.request.mockReset();
    mocks.getSystem.mockReset().mockReturnValue(PROFILE);
    mocks.upsertSystem.mockReset();
    mocks.getPassword.mockReset().mockResolvedValue('pw');
  });

  it('keeps ADT and ICF capabilities ok when the request throws 4xx', async () => {
    mocks.request.mockImplementation(
      baseRequest((path) =>
        path.startsWith('/sap/bc/adt/')
          ? Promise.reject(statusError(404, 'err'))
          : Promise.reject(statusError(403, 'status')),
      ),
    );

    const probe = await probeSystem('sys');

    expect(probe.capabilities?.ttyp.adt).toBe('ok');
    expect(probe.capabilities?.msag.adt).toBe('ok');
    expect(probe.capabilities?.ddls.adt).toBe('ok');
    expect(probe.capabilities?.ttyp.icf).toBe('ok');
    expect(probe.capabilities?.msag.icf).toBe('ok');
    // DDLS has no ICF handler by design.
    expect(probe.capabilities?.ddls.icf).toBe('absent');
  });

  it('reports absent when the request throws 5xx', async () => {
    mocks.request.mockImplementation(baseRequest(() => Promise.reject(statusError(503, 'err'))));

    const probe = await probeSystem('sys');

    expect(probe.capabilities?.ttyp.adt).toBe('absent');
    expect(probe.capabilities?.msag.adt).toBe('absent');
    expect(probe.capabilities?.ddls.adt).toBe('absent');
    expect(probe.capabilities?.ttyp.icf).toBe('absent');
    expect(probe.capabilities?.msag.icf).toBe('absent');
    expect(probe.capabilities?.ddls.icf).toBe('absent');
  });

  it('reports absent when the exception carries no HTTP status (network error)', async () => {
    mocks.request.mockImplementation(baseRequest(() => Promise.reject(new Error('socket hang up'))));

    const probe = await probeSystem('sys');

    expect(probe.capabilities?.ttyp.adt).toBe('absent');
    expect(probe.capabilities?.msag.adt).toBe('absent');
    expect(probe.capabilities?.ddls.adt).toBe('absent');
    expect(probe.capabilities?.ttyp.icf).toBe('absent');
    expect(probe.capabilities?.msag.icf).toBe('absent');
  });

  it('reports ok when the request resolves with HTTP 200', async () => {
    mocks.request.mockImplementation(baseRequest(() => Promise.resolve({ status: 200, body: '' })));

    const probe = await probeSystem('sys');

    expect(probe.capabilities?.ttyp.adt).toBe('ok');
    expect(probe.capabilities?.msag.adt).toBe('ok');
    expect(probe.capabilities?.ddls.adt).toBe('ok');
    expect(probe.capabilities?.ttyp.icf).toBe('ok');
    expect(probe.capabilities?.msag.icf).toBe('ok');
    expect(probe.ddlSourceSupported).toBe(true);
  });
});
