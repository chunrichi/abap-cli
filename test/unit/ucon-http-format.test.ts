/**
 * UCON HTTP service (UCON_HTTP) local document contract.
 *
 * Pins the local-extension ucon_http-v1 shape: handler ordering, handler-class
 * normalization, the optional ICF node link, schema/semantic validation and the
 * pull → push wire round-trip (server-owned fields must never leak into the
 * local file).
 */
import { describe, expect, it } from 'vitest';
import {
  UCON_HTTP_DESCRIPTION_MAX_LENGTH,
  UCON_HTTP_HANDLER_MAX_LENGTH,
  effectiveHandlerOrder,
  getUconHttpJsonExample,
  localToWire,
  uconHttpArtifact,
  validateUconHttpObject,
  wireToLocal,
  type UconHttpLocal,
} from '../../src/abap_cli/formats/ucon-http/json.js';

const LOCAL: UconHttpLocal = {
  formatVersion: '1',
  description: 'Demo UCON HTTP service',
  handlers: [
    { order: '01', handlerClass: 'ZCL_HTTP_DEMO_HANDLER' },
    { order: '02', handlerClass: 'ZCL_HTTP_AUDIT_HANDLER' },
  ],
};

describe('ucon_http wire mapping', () => {
  it('drops server-owned fields and normalizes handler classes on pull', () => {
    const local = wireToLocal({
      formatVersion: '1',
      name: 'ZHTTP_DEMO',
      description: '  Demo UCON HTTP service  ',
      handlers: [
        { order: '02', handlerClass: 'zcl_http_audit_handler' },
        { order: '01', handlerClass: 'ZCL_HTTP_DEMO_HANDLER' },
      ],
      icfService: { icfName: '', icfParGuid: '' },
      package: '$TMP',
      createdBy: 'MOCKUSER',
    });
    expect(local).toEqual({
      formatVersion: '1',
      description: 'Demo UCON HTTP service',
      handlers: [
        { order: '02', handlerClass: 'ZCL_HTTP_AUDIT_HANDLER' },
        { order: '01', handlerClass: 'ZCL_HTTP_DEMO_HANDLER' },
      ],
    });
    expect(local).not.toHaveProperty('name');
    expect(local).not.toHaveProperty('package');
  });

  it('keeps a populated ICF node link and uppercases it', () => {
    const local = wireToLocal({
      formatVersion: '1',
      handlers: [{ handlerClass: 'ZCL_X' }],
      icfService: { icfName: 'znode', icfParGuid: 'abc123' },
    });
    expect(local.icfService).toEqual({ icfName: 'ZNODE', icfParGuid: 'ABC123' });
  });

  it('builds the POST body from the local document and echoes the name', () => {
    const wire = localToWire(LOCAL, 'zhttp_demo');
    expect(wire).toEqual({ ...LOCAL, name: 'ZHTTP_DEMO' });
    expect(wire).not.toHaveProperty('package');
    expect(wire).not.toHaveProperty('transportRequest');
  });

  it('round-trips a pull → push document byte-for-byte', () => {
    expect(localToWire(wireToLocal({ ...LOCAL, name: 'ZHTTP_DEMO', package: '$TMP' }), 'ZHTTP_DEMO')).toEqual({
      ...LOCAL,
      name: 'ZHTTP_DEMO',
    });
  });

  it('uses the list position when a handler carries no explicit order', () => {
    expect(effectiveHandlerOrder({ handlerClass: 'ZCL_A' }, 0)).toBe('1');
    expect(effectiveHandlerOrder({ order: '07', handlerClass: 'ZCL_A' }, 0)).toBe('07');
  });
});

describe('ucon_http semantic validation', () => {
  it('accepts a complete document', () => {
    expect(validateUconHttpObject(LOCAL)).toEqual([]);
    expect(validateUconHttpObject({ ...LOCAL, icfService: { icfName: 'ZNODE', icfParGuid: 'ABC' } })).toEqual([]);
  });

  it('requires at least one handler class', () => {
    expect(validateUconHttpObject({ formatVersion: '1', handlers: [] })).toEqual([
      'handlers must contain at least one handler class (UCONHTTPSERVHANDL-SERVICEHANDLER)',
    ]);
    expect(validateUconHttpObject({ formatVersion: '1' })).toEqual([
      'handlers must contain at least one handler class (UCONHTTPSERVHANDL-SERVICEHANDLER)',
    ]);
  });

  it('rejects duplicate service orders, including implicit list positions', () => {
    const errors = validateUconHttpObject({
      formatVersion: '1',
      handlers: [
        { order: '02', handlerClass: 'ZCL_A' },
        { handlerClass: 'ZCL_B' },
        { handlerClass: 'ZCL_C' },
      ],
    });
    expect(errors).toEqual([
      'handlers[1].order 2 collides with handlers[0]; service orders must be unique',
    ]);
  });

  it('rejects an over-long or non-single-line description', () => {
    expect(validateUconHttpObject({
      ...LOCAL,
      description: 'x'.repeat(UCON_HTTP_DESCRIPTION_MAX_LENGTH + 1),
    })).toEqual([
      `description must not exceed ${UCON_HTTP_DESCRIPTION_MAX_LENGTH} characters (UCONHTTPSERVTEXT; got ${UCON_HTTP_DESCRIPTION_MAX_LENGTH + 1})`,
    ]);
    expect(validateUconHttpObject({ ...LOCAL, description: 'line one\nline two' })).toEqual([
      'description must be a single line (no line breaks; UCONHTTPSERVTEXT is one CHAR 255 field)',
    ]);
  });

  it('rejects an over-long or malformed handler class', () => {
    expect(validateUconHttpObject({
      formatVersion: '1',
      handlers: [{ handlerClass: 'Z' + 'X'.repeat(UCON_HTTP_HANDLER_MAX_LENGTH) }],
    })).toEqual([
      `handlers[0].handlerClass must not exceed ${UCON_HTTP_HANDLER_MAX_LENGTH} characters (got ${UCON_HTTP_HANDLER_MAX_LENGTH + 1})`,
    ]);
    expect(validateUconHttpObject({
      formatVersion: '1',
      handlers: [{ handlerClass: 'ZCL BAD HANDLER' }],
    })).toEqual([
      `handlers[0].handlerClass may only contain A-Z, 0-9, '_' and '/' (got "ZCL BAD HANDLER")`,
    ]);
  });

  it('rejects a malformed service order', () => {
    expect(validateUconHttpObject({
      formatVersion: '1',
      handlers: [{ order: 'abc', handlerClass: 'ZCL_A' }],
    })).toEqual([
      'handlers[0].order must be a 1 or 2 digit service order (got "abc")',
    ]);
  });

  it('checks the ICF node link lengths', () => {
    const errors = validateUconHttpObject({
      ...LOCAL,
      icfService: { icfName: 'N'.repeat(16), icfParGuid: 'G'.repeat(26) },
    });
    expect(errors).toEqual([
      'icfService.icfName must not exceed 15 characters (ICFNAME; got 16)',
      'icfService.icfParGuid must not exceed 25 characters (ICFPARGUID; got 26)',
    ]);
  });
});

describe('ucon_http artifact validation', () => {
  it('accepts the documented shape through the bundled schema', async () => {
    await expect(uconHttpArtifact.validate(LOCAL)).resolves.toEqual([]);
  });

  it('rejects unknown properties through the bundled schema', async () => {
    const errors = await uconHttpArtifact.validate({ ...LOCAL, extra: true });
    expect(errors.join('\n')).toMatch(/additional/i);
  });

  it('rejects a handler without handlerClass', async () => {
    const errors = await uconHttpArtifact.validate({ formatVersion: '1', handlers: [{ order: '01' }] });
    expect(errors.join('\n')).toMatch(/handlerClass/);
  });

  it('exposes an agent-facing example', () => {
    const example = getUconHttpJsonExample();
    expect(example).toContain('zcli_http_demo.ucon_http.json');
    expect(example).toContain('"handlerClass"');
    expect(example).toContain('icfService');
  });
});
