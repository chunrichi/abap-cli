/**
  HTTP service JSON helpers — local↔wire conversion, validation, namespace.
 * Mirrors ddic-json-map.test.ts but for the HTTP service object type.
 */
import { describe, expect, it } from 'vitest';
import {
  localToWire,
  wireToLocal,
  validateHttpObject,
  type HttpObjectLocal,
  type HttpWirePayload,
} from '../../src/abap_cli/formats/http/json.js';

describe('022 HTTP JSON helpers', () => {
  describe('localToWire', () => {
    it('maps the abap-file-format nested shape to wire', () => {
      const local: HttpObjectLocal = {
        name: 'zhttp_test',
        formatVersion: '1',
        header: { description: 'HTTP service', originalLanguage: 'en', abapLanguageVersion: 'standard' },
        generalInformation: { handlerClass: 'ZCL_HTTP_HANDLER', url: '/sap/zhttp_test' },
      };
      const wire = localToWire(local);
      expect(wire).toEqual({
        name: 'ZHTTP_TEST',
        description: 'HTTP service',
        originalLanguage: 'en',
        abapLanguageVersion: 'standard',
        handlerClass: 'ZCL_HTTP_HANDLER',
        url: '/sap/zhttp_test',
        package: undefined,
        transportRequest: undefined,
      });
    });

    it('accepts the flat CLI shape (description / handlerClass at top level)', () => {
      const local: HttpObjectLocal = {
        name: 'ZHTTP_FLAT',
        description: 'Flat shape',
        originalLanguage: 'EN',
        handlerClass: 'ZCL_FLAT_HANDLER',
        url: '/sap/flat',
      };
      const wire = localToWire(local);
      expect(wire).toMatchObject({
        name: 'ZHTTP_FLAT',
        description: 'Flat shape',
        originalLanguage: 'EN',
        handlerClass: 'ZCL_FLAT_HANDLER',
        url: '/sap/flat',
      });
    });

    it('uppercases the name', () => {
      const local: HttpObjectLocal = {
        name: 'zhttp_lower',
        header: { description: 'd', originalLanguage: 'EN' },
      };
      expect(localToWire(local).name).toBe('ZHTTP_LOWER');
    });
  });

  describe('wireToLocal', () => {
    it('produces the abap-file-format nested shape', () => {
      const wire: HttpWirePayload = {
        name: 'ZHTTP_TEST',
        description: 'HTTP service',
        originalLanguage: 'EN',
        handlerClass: 'ZCL_HTTP_HANDLER',
        url: '/sap/zhttp_test',
      };
      const local = wireToLocal(wire);
      expect(local.name).toBe('ZHTTP_TEST');
      expect(local.formatVersion).toBe('1');
      expect(local.header).toEqual({ description: 'HTTP service', originalLanguage: 'EN' });
      expect(local.generalInformation).toEqual({ handlerClass: 'ZCL_HTTP_HANDLER', url: '/sap/zhttp_test' });
    });
  });

  describe('validateHttpObject', () => {
    it('passes a valid nested object', () => {
      const local: HttpObjectLocal = {
        name: 'ZHTTP_TEST',
        header: { description: 'd', originalLanguage: 'EN' },
        generalInformation: { handlerClass: 'ZCL_X', url: '/x' },
      };
      expect(validateHttpObject(local)).toEqual([]);
    });

    it('rejects missing name', () => {
      const local: HttpObjectLocal = { header: { description: 'd', originalLanguage: 'EN' } };
      expect(validateHttpObject(local)).toContain('Missing required field: name');
    });

    it('rejects invalid namespace (non-Z/Y/slash)', () => {
      const local: HttpObjectLocal = { name: 'XHTTP', header: { description: 'd', originalLanguage: 'EN' } };
      expect(validateHttpObject(local).some((e) => e.includes('Invalid namespace'))).toBe(true);
    });

    it('rejects missing description / originalLanguage', () => {
      const local: HttpObjectLocal = { name: 'ZHTTP_TEST' };
      const errors = validateHttpObject(local);
      expect(errors.some((e) => e.includes('description'))).toBe(true);
      expect(errors.some((e) => e.includes('originalLanguage'))).toBe(true);
    });

    it('rejects invalid abapLanguageVersion', () => {
      const local: HttpObjectLocal = {
        name: 'ZHTTP_TEST',
        header: { description: 'd', originalLanguage: 'EN', abapLanguageVersion: 'nonsense' },
      };
      expect(validateHttpObject(local).some((e) => e.includes('Invalid abapLanguageVersion'))).toBe(true);
    });

    it('rejects handlerClass over 30 chars', () => {
      const longName = 'Z' + 'A'.repeat(30);
      const local: HttpObjectLocal = {
        name: 'ZHTTP_TEST',
        header: { description: 'd', originalLanguage: 'EN' },
        generalInformation: { handlerClass: longName, url: '/x' },
      };
      expect(validateHttpObject(local).some((e) => e.includes('handlerClass too long'))).toBe(true);
    });

    it('rejects description over 60 chars', () => {
      const local: HttpObjectLocal = {
        name: 'ZHTTP_TEST',
        header: { description: 'd'.repeat(61), originalLanguage: 'EN' },
        generalInformation: { handlerClass: 'ZCL_X', url: '/x' },
      };
      expect(validateHttpObject(local).some((e) => e.includes('description too long'))).toBe(true);
    });

    it('accepts description at exactly 60 chars', () => {
      const local: HttpObjectLocal = {
        name: 'ZHTTP_TEST',
        header: { description: 'd'.repeat(60), originalLanguage: 'EN' },
        generalInformation: { handlerClass: 'ZCL_X', url: '/x' },
      };
      expect(validateHttpObject(local)).toEqual([]);
    });
  });
});
