import { describe, expect, it } from 'vitest';
import axios from 'axios';
import { AxiosError } from 'axios';
import { classifyHttpError, isTlsErrorCode, TLS_ERROR_CODE_LIST } from '../../src/abap_cli/clients/http-error.js';
import { toErrorShape } from '../../src/abap_cli/output/json.js';

describe('http-error classifier ()', () => {
  it('TLS_ERROR_CODE_LIST contains the documented Node codes', () => {
    expect(TLS_ERROR_CODE_LIST).toContain('UNABLE_TO_VERIFY_LEAF_SIGNATURE');
    expect(TLS_ERROR_CODE_LIST).toContain('SELF_SIGNED_CERT_IN_CHAIN');
    expect(TLS_ERROR_CODE_LIST).toContain('CERT_HAS_EXPIRED');
  });

  it('classified errors carry the explicit category via toErrorShape (US-2)', () => {
    const ax = new AxiosError('Unauthorized', '401', undefined, undefined, {
      status: 401,
      statusText: 'Unauthorized',
      data: {},
      headers: {},
      config: undefined as never,
    });
    const cli = classifyHttpError(ax);
    expect(toErrorShape(cli).category).toBe('AUTH_ERROR');

    const ax500 = new AxiosError('Server Error', '500', undefined, undefined, {
      status: 500,
      statusText: 'Internal Server Error',
      data: { message: 'boom' },
      headers: {},
      config: undefined as never,
    });
    expect(toErrorShape(classifyHttpError(ax500)).category).toBe('SAP_ERROR');
  });

  it('isTlsErrorCode recognises a TLS code', () => {
    expect(isTlsErrorCode('SELF_SIGNED_CERT_IN_CHAIN')).toBe(true);
    expect(isTlsErrorCode('ECONNRESET')).toBe(false);
    expect(isTlsErrorCode(undefined)).toBe(false);
  });

  it('classifies an AxiosError with TLS cause as TLS_ERROR with canonical nextSteps', () => {
    const cause = Object.assign(new Error('unable to verify the first certificate'), {
      code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    });
    const ax = new AxiosError('TLS fail', 'ECONNABORTED' as never, undefined, undefined, undefined);
    Object.defineProperty(ax, 'cause', { value: cause });
    const cli = classifyHttpError(ax, { name: 'dev' });
    expect(cli.code).toBe('TLS_ERROR');
    expect(cli.nextSteps).toBeDefined();
    expect(cli.nextSteps!.some((s) => s.includes('--ca'))).toBe(true);
    expect(cli.example).toContain('--ca');
  });

  it('classifies an AxiosError with 401 as AUTH_ERROR', () => {
    const ax = new AxiosError('Unauthorized', '401', undefined, undefined, {
      status: 401,
      statusText: 'Unauthorized',
      data: {},
      headers: {},
      config: undefined as never,
    });
    const cli = classifyHttpError(ax);
    expect(cli.code).toBe('AUTH_ERROR');
    expect(cli.details?.httpStatus).toBe(401);
    expect(cli.nextSteps!.some((s) => s.includes('password'))).toBe(true);
  });

  it('classifies an AxiosError with 500 as SAP_ERROR', () => {
    const ax = new AxiosError('Server Error', '500', undefined, undefined, {
      status: 500,
      statusText: 'Internal Server Error',
      data: { message: 'boom' },
      headers: {},
      config: undefined as never,
    });
    const cli = classifyHttpError(ax);
    expect(cli.code).toBe('SAP_ERROR');
    expect(cli.details?.httpStatus).toBe(500);
  });

  it('classifies a bare Node TLS error (no Axios wrapper) as TLS_ERROR', () => {
    const e = Object.assign(new Error('SELF_SIGNED_CERT_IN_CHAIN'), { code: 'SELF_SIGNED_CERT_IN_CHAIN' });
    const cli = classifyHttpError(e);
    expect(cli.code).toBe('TLS_ERROR');
  });

  it('falls back to SAP_ERROR for an unrecognised error', () => {
    const cli = classifyHttpError(new Error('mystery'));
    expect(cli.code).toBe('SAP_ERROR');
  });

  it('classifies an HttpClientException-style error (abap-adt-api wrapper) with status=401 as AUTH_ERROR', () => {
    // abap-adt-api wraps AxiosError → HttpClientException with .status and .message
    const httpClientEx = Object.assign(new Error('Request failed with status code 401'), { status: 401 });
    const cli = classifyHttpError(httpClientEx);
    expect(cli.code).toBe('AUTH_ERROR');
    expect(cli.details?.httpStatus).toBe(401);
  });

  it('classifies an HttpClientException-style error with status=500 as SAP_ERROR', () => {
    const httpClientEx = Object.assign(new Error('Request failed with status code 500'), { status: 500 });
    const cli = classifyHttpError(httpClientEx);
    expect(cli.code).toBe('SAP_ERROR');
    expect(cli.details?.httpStatus).toBe(500);
  });

  it('classifies an HttpClientException-style TLS error (status=0 + TLS code) as TLS_ERROR, not SAP_ERROR (SC-004)', () => {
    // Real SAP: abap-adt-api surfaces TLS handshake failures as AdtHttpException
    // with status=0 and the Node TLS code on `code` (e.g. DEPTH_ZERO_SELF_SIGNED_CERT).
    const httpClientEx = Object.assign(
      new Error('self-signed certificate'),
      { status: 0, code: 'DEPTH_ZERO_SELF_SIGNED_CERT' },
    );
    const cli = classifyHttpError(httpClientEx, { name: 'dev' });
    expect(cli.code).toBe('TLS_ERROR');
    expect(cli.details?.cause).toBe('DEPTH_ZERO_SELF_SIGNED_CERT');
    expect(cli.nextSteps!.some((s) => s.includes('--insecure'))).toBe(true);
  });

  // silence unused-import warning
  expect(axios.isAxiosError).toBeDefined();
});