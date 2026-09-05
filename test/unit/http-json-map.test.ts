/**
  HTTP service JSON helpers — local↔wire conversion, validation, namespace.
 * Mirrors ddic-json-map.test.ts but for the HTTP service object type.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  localToWire,
  wireToLocal,
  validateHttpObject,
  validateHttpService,
  readHttpService,
  writeHttpService,
  type HttpObjectLocal,
  type HttpWirePayload,
} from '../../src/abap_cli/formats/http/json.js';

describe('022 HTTP JSON helpers', () => {
  describe('localToWire', () => {
    it('maps the abap-file-format nested shape to the nested wire (the contract the ICF handler deserializes)', () => {
      const local: HttpObjectLocal = {
        name: 'zhttp_test',
        formatVersion: '1',
        header: { description: 'HTTP service', originalLanguage: 'en', abapLanguageVersion: 'standard' },
        generalInformation: { handlerClass: 'ZCL_HTTP_HANDLER', url: '/sap/zhttp_test' },
      };
      const wire = localToWire(local);
      expect(wire).toEqual({
        name: 'ZHTTP_TEST',
        formatVersion: '1',
        header: { description: 'HTTP service', originalLanguage: 'en', abapLanguageVersion: 'standard' },
        generalInformation: { handlerClass: 'ZCL_HTTP_HANDLER', url: '/sap/zhttp_test' },
      });
    });

    it('maps the flat CLI shape (description / handlerClass at top level) into the nested wire', () => {
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
        formatVersion: '1',
        header: { description: 'Flat shape', originalLanguage: 'EN' },
        generalInformation: { handlerClass: 'ZCL_FLAT_HANDLER', url: '/sap/flat' },
      });
    });

    it('uppercases the name', () => {
      const local: HttpObjectLocal = {
        name: 'zhttp_lower',
        header: { description: 'd', originalLanguage: 'EN' },
      };
      expect(localToWire(local).name).toBe('ZHTTP_LOWER');
    });

    it('carries the transport envelope (package / transportRequest) at the wire top level', () => {
      const local = {
        name: 'ZHTTP_TRN',
        header: { description: 'd', originalLanguage: 'EN' },
        generalInformation: { url: '/sap/zhttp_trn' },
        package: '$TMP',
        transportRequest: 'A4HK900148',
      };
      const wire = localToWire(local as HttpObjectLocal);
      expect(wire.package).toBe('$TMP');
      expect(wire.transportRequest).toBe('A4HK900148');
    });
  });

  describe('wireToLocal', () => {
    it('maps the nested GET payload to the abap-file-format nested shape', () => {
      const wire: HttpWirePayload = {
        formatVersion: '1',
        header: { description: 'HTTP service', originalLanguage: 'EN', abapLanguageVersion: 'standard' },
        generalInformation: { handlerClass: 'ZCL_HTTP_HANDLER', url: '/sap/zhttp_test' },
      };
      const local = wireToLocal(wire);
      expect(local.name).toBeUndefined();
      expect(local.formatVersion).toBe('1');
      expect(local.header).toEqual({ description: 'HTTP service', originalLanguage: 'EN', abapLanguageVersion: 'standard' });
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

  // ----- T2.2 AFF schema-based validation -----

  describe('validateHttpService (AFF schema)', () => {
    it('passes a valid AFF-shaped document', () => {
      const doc = {
        formatVersion: '1',
        header: { description: 'HTTP service', originalLanguage: 'EN' },
        generalInformation: { handlerClass: 'ZCL_HTTP_HANDLER', url: '/sap/zhttp_test' },
      };
      expect(validateHttpService(doc)).toEqual([]);
    });

    it('rejects documents missing formatVersion (AFF schema)', () => {
      const doc = {
        header: { description: 'x', originalLanguage: 'EN' },
        generalInformation: {},
      };
      const errors = validateHttpService(doc);
      expect(errors.length).toBeGreaterThan(0);
      // ajv error shape: <instancePath>: <message>
      expect(errors.join('\n')).toMatch(/formatVersion/);
    });

    it('rejects documents with description > 60 chars', () => {
      const doc = {
        formatVersion: '1',
        header: { description: 'd'.repeat(61), originalLanguage: 'EN' },
        generalInformation: {},
      };
      const errors = validateHttpService(doc);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('rejects documents with extra top-level fields (AFF additionalProperties:false)', () => {
      const doc = {
        formatVersion: '1',
        header: { description: 'x', originalLanguage: 'EN' },
        generalInformation: {},
        rogueField: 'oops',
      };
      const errors = validateHttpService(doc);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.join('\n')).toMatch(/rogueField|additional/);
    });
  });

  describe('writeHttpService (AFF schema pre-write)', () => {
    let tmpDir: string;
    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'abap-cli-http-test-'));
    });
    afterEach(async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('round-trips a valid document', async () => {
      const filePath = path.join(tmpDir, 'nested', 'zhttp_rt.http.json');
      const doc = {
        formatVersion: '1' as const,
        header: { description: 'round-trip', originalLanguage: 'EN' },
        generalInformation: { handlerClass: 'ZCL_RT', url: '/sap/zrt' },
      };
      await writeHttpService(filePath, doc);
      const back = await readHttpService(filePath);
      expect(back).toEqual(doc);
    });

    it('throws on an invalid document before writing', async () => {
      const filePath = path.join(tmpDir, 'zhttp_bad.http.json');
      const bad = {
        // missing required formatVersion
        header: { description: 'x', originalLanguage: 'EN' },
        generalInformation: {},
      };
      await expect(writeHttpService(filePath, bad)).rejects.toThrow(/AFF HTTP fixture invalid/);
      // The file must NOT have been written.
      await expect(fs.stat(filePath)).rejects.toThrow();
    });
  });
});
