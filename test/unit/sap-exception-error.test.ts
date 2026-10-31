/**
 * ADT error model: SAP returns an `<exc:exception>` envelope whose `type` says
 * *why* a call failed (resource locked, no access, already exists, not found).
 * The CLI keeps its existing `code`/`category` mapping and adds the exception
 * identity to `details`, plus recovery `nextSteps` for the known types, so an
 * agent can branch on the cause instead of re-reading a truncated body.
 */
import { describe, expect, it } from 'vitest';
import { AxiosError } from 'axios';
import { classifyHttpError, parseSapException } from '../../src/abap_cli/clients/http-error.js';

function exceptionBody(type: string, extra = ''): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework">' +
    '<namespace id="com.sap.adt"/>' +
    `<type id="${type}"/>` +
    '<message lang="EN">Request failed on resource /sap/bc/adt/oo/classes/zcl_foo</message>' +
    '<properties><entry key="resource">/sap/bc/adt/oo/classes/zcl_foo</entry></properties>' +
    extra +
    '</exc:exception>'
  );
}

function axiosError(status: number, data: unknown, statusText = 'Failed'): AxiosError {
  return new AxiosError('Request failed', String(status), undefined, undefined, {
    status,
    statusText,
    data,
    headers: {},
    config: undefined as never,
  });
}

describe('parseSapException', () => {
  it('parses namespace / type / message / localizedMessage / properties', () => {
    const body =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework">' +
      '<namespace id="com.sap.adt"/>' +
      '<type id="ExceptionResourceLocked"/>' +
      '<message lang="DE">Objekt ist gesperrt</message>' +
      '<message lang="EN">Object is locked</message>' +
      '<localizedMessage lang="EN">Object is locked (localized)</localizedMessage>' +
      '<properties><entry key="resource">/sap/bc/adt/oo/classes/zcl_foo</entry></properties>' +
      '</exc:exception>';
    expect(parseSapException(body)).toEqual({
      namespace: 'com.sap.adt',
      type: 'ExceptionResourceLocked',
      message: 'Object is locked',
      localizedMessage: 'Object is locked (localized)',
      properties: { resource: '/sap/bc/adt/oo/classes/zcl_foo' },
    });
  });

  it('returns undefined for non-exception bodies (HTML / plain text / JSON)', () => {
    expect(parseSapException('<html><body>503 Service Not Available</body></html>')).toBeUndefined();
    expect(parseSapException('400 Session Timed Out')).toBeUndefined();
    expect(parseSapException('{"status":"error"}')).toBeUndefined();
  });
});

describe('classifyHttpError → exc:exception mapping', () => {
  it('maps ExceptionResourceLocked to lock nextSteps (code stays SAP_ERROR)', () => {
    const cli = classifyHttpError(axiosError(423, exceptionBody('ExceptionResourceLocked')));
    expect(cli.code).toBe('SAP_ERROR');
    expect(cli.details).toMatchObject({
      httpStatus: 423,
      sapErrorType: 'ExceptionResourceLocked',
      sapErrorNamespace: 'com.sap.adt',
      sapErrorProperties: { resource: '/sap/bc/adt/oo/classes/zcl_foo' },
    });
    const steps = (cli.nextSteps ?? []).join('\n');
    expect(steps).toContain('abap inspect <object> --locks');
    expect(steps).toContain('locked');
  });

  it('maps ExceptionResourceAlreadyExists to an exist/delete next step', () => {
    const cli = classifyHttpError(axiosError(409, exceptionBody('ExceptionResourceAlreadyExists')));
    expect(cli.code).toBe('SAP_ERROR');
    expect(cli.details?.sapErrorType).toBe('ExceptionResourceAlreadyExists');
    expect((cli.nextSteps ?? []).join('\n')).toContain('abap inspect <object>');
  });

  it('maps ExceptionResourceNotFound to a search/create next step', () => {
    const cli = classifyHttpError(axiosError(404, exceptionBody('ExceptionResourceNotFound')));
    expect(cli.code).toBe('SAP_ERROR');
    expect(cli.details?.sapErrorType).toBe('ExceptionResourceNotFound');
    const steps = (cli.nextSteps ?? []).join('\n');
    expect(steps).toContain('abap search <name>');
    expect(steps).toContain('abap create');
  });

  it('keeps AUTH_ERROR for 403 but exposes the exception type', () => {
    // SAP maps "no access" to 403; the category must not change, but the
    // exception identity tells the agent it is an authorization problem.
    const cli = classifyHttpError(axiosError(403, exceptionBody('ExceptionNoAccess')), { name: 'dev' });
    expect(cli.code).toBe('AUTH_ERROR');
    expect(cli.category).toBeUndefined(); // category is derived by toErrorShape
    expect(cli.details).toMatchObject({
      httpStatus: 403,
      system: 'dev',
      sapErrorType: 'ExceptionNoAccess',
      sapErrorNamespace: 'com.sap.adt',
    });
    expect((cli.nextSteps ?? []).join('\n')).toContain('password');
  });

  it('parses the wrapped abap-adt-api exception body too', () => {
    const wrapped = Object.assign(new Error('Request failed with status code 500'), {
      status: 500,
      response: { body: exceptionBody('ExceptionResourceLocked') },
    });
    const cli = classifyHttpError(wrapped);
    expect(cli.code).toBe('SAP_ERROR');
    expect(cli.details?.sapErrorType).toBe('ExceptionResourceLocked');
    expect(cli.details?.sapErrorProperties).toEqual({ resource: '/sap/bc/adt/oo/classes/zcl_foo' });
    expect((cli.nextSteps ?? []).join('\n')).toContain('--locks');
  });

  it('falls back to localizedMessage when no English <message> exists', () => {
    const body =
      '<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework">' +
      '<namespace id="com.sap.adt"/><type id="ExceptionInvalidRequest"/>' +
      '<localizedMessage lang="EN">Localized failure text</localizedMessage>' +
      '</exc:exception>';
    const cli = classifyHttpError(axiosError(400, body));
    expect(cli.message).toContain('Localized failure text');
    expect(cli.details?.sapErrorType).toBe('ExceptionInvalidRequest');
  });

  it('leaves unknown exception types without mapped nextSteps', () => {
    const cli = classifyHttpError(axiosError(400, exceptionBody('ExceptionSomethingOdd')));
    expect(cli.code).toBe('SAP_ERROR');
    expect(cli.details?.sapErrorType).toBe('ExceptionSomethingOdd');
    expect(cli.nextSteps).toBeUndefined();
  });
});
