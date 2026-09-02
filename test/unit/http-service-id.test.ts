/**
 * 032 US10 (T041/T042): HTTP `serviceId` + `descriptionByLang[]` round-trip.
 *
 * Wire shape (SAP ICF /http/<name>):
 *   `{ serviceId: '/sap/zfoo', descriptionByLang: [{ language: 'EN', description: 'My service' }] }`
 *
 * Local shape (abap-file-format http-v1.json + SICF extensions):
 *   `generalInformation.serviceId` — service path on the wire
 *   `header.descriptionByLang[]`   — multi-language descriptions
 *
 * Both fields are SICF-specific extensions that the CLI round-trips even
 * though they're not in the abap-file-format http-v1.json schema.
 */
import { describe, it, expect } from 'vitest';
import { localToWire, wireToLocal } from '../../src/abap_cli/formats/http/json.js';

describe('032/http-service-id', () => {
  describe('wireToLocal', () => {
    it('maps wire serviceId → local generalInformation.serviceId', () => {
      const local = wireToLocal({
        name: 'ZMY_SERVICE',
        description: 'My service',
        originalLanguage: 'EN',
        handlerClass: 'ZCL_MY_HANDLER',
        url: '/sap/zfoo',
        serviceId: '/sap/zfoo',
        descriptionByLang: [{ language: 'EN', description: 'My service' }],
      });
      const generalInformation = (local as Record<string, unknown>).generalInformation as Record<string, unknown>;
      expect(generalInformation.serviceId).toBe('/sap/zfoo');
    });

    it('maps wire descriptionByLang[] → local header.descriptionByLang[]', () => {
      const local = wireToLocal({
        name: 'ZMY_SERVICE',
        description: 'My service',
        originalLanguage: 'EN',
        descriptionByLang: [
          { language: 'EN', description: 'My service' },
          { language: 'DE', description: 'Mein Service' },
          { language: 'ZH', description: '我的服务' },
        ],
      });
      const header = (local as Record<string, unknown>).header as Record<string, unknown>;
      expect(header.descriptionByLang).toEqual([
        { language: 'EN', description: 'My service' },
        { language: 'DE', description: 'Mein Service' },
        { language: 'ZH', description: '我的服务' },
      ]);
    });

    it('omits descriptionByLang when wire array is empty', () => {
      const local = wireToLocal({
        name: 'ZMY_SERVICE',
        description: 'Plain service',
        originalLanguage: 'EN',
        descriptionByLang: [],
      });
      const header = (local as Record<string, unknown>).header as Record<string, unknown>;
      expect(header.descriptionByLang).toBeUndefined();
    });

    it('omits serviceId when wire field absent (existing objects without serviceId)', () => {
      const local = wireToLocal({
        name: 'ZMY_OLD',
        description: 'Legacy',
        originalLanguage: 'EN',
      });
      const generalInformation = (local as Record<string, unknown>).generalInformation as Record<string, unknown>;
      expect(generalInformation.serviceId).toBeUndefined();
    });
  });

  describe('localToWire (push passthrough)', () => {
    it('maps local nested generalInformation.serviceId → wire serviceId', () => {
      const wire = localToWire({
        name: 'ZMY_SERVICE',
        description: 'My service',
        originalLanguage: 'EN',
        generalInformation: {
          handlerClass: 'ZCL_MY_HANDLER',
          url: '/sap/zfoo',
          serviceId: '/sap/zfoo',
        },
      } as Record<string, unknown>);
      expect(wire.serviceId).toBe('/sap/zfoo');
    });

    it('maps local nested header.descriptionByLang[] → wire descriptionByLang[]', () => {
      const wire = localToWire({
        name: 'ZMY_SERVICE',
        description: 'My service',
        originalLanguage: 'EN',
        header: {
          description: 'My service',
          originalLanguage: 'EN',
          descriptionByLang: [
            { language: 'EN', description: 'My service' },
            { language: 'DE', description: 'Mein Service' },
          ],
        },
      } as Record<string, unknown>);
      expect(wire.descriptionByLang).toEqual([
        { language: 'EN', description: 'My service' },
        { language: 'DE', description: 'Mein Service' },
      ]);
    });

    it('accepts top-level flat serviceId/descriptionByLang (legacy fallback)', () => {
      const wire = localToWire({
        name: 'ZMY_SERVICE',
        description: 'My service',
        originalLanguage: 'EN',
        serviceId: '/sap/zlegacy',
        descriptionByLang: [{ language: 'EN', description: 'Legacy form' }],
      } as Record<string, unknown>);
      expect(wire.serviceId).toBe('/sap/zlegacy');
      expect(wire.descriptionByLang).toEqual([{ language: 'EN', description: 'Legacy form' }]);
    });

    it('omits serviceId/descriptionByLang when neither nested nor flat input present', () => {
      const wire = localToWire({
        name: 'ZMY_SERVICE',
        description: 'My service',
        originalLanguage: 'EN',
      });
      expect(wire.serviceId).toBeUndefined();
      expect(wire.descriptionByLang).toBeUndefined();
    });
  });

  describe('round-trip', () => {
    it('localToWire → wireToLocal preserves serviceId + descriptionByLang', () => {
      const src = {
        name: 'ZMY_SERVICE',
        description: 'My service',
        originalLanguage: 'EN',
        handlerClass: 'ZCL_MY_HANDLER',
        url: '/sap/zfoo',
        formatVersion: '1',
        header: {
          description: 'My service',
          originalLanguage: 'EN',
          descriptionByLang: [
            { language: 'EN', description: 'My service' },
            { language: 'DE', description: 'Mein Service' },
          ],
        },
        generalInformation: {
          handlerClass: 'ZCL_MY_HANDLER',
          url: '/sap/zfoo',
          serviceId: '/sap/zfoo',
        },
      };
      const back = wireToLocal(localToWire(src as Record<string, unknown>));
      const header = (back as Record<string, unknown>).header as Record<string, unknown>;
      const generalInformation = (back as Record<string, unknown>).generalInformation as Record<string, unknown>;
      expect(generalInformation.serviceId).toBe('/sap/zfoo');
      expect(header.descriptionByLang).toEqual([
        { language: 'EN', description: 'My service' },
        { language: 'DE', description: 'Mein Service' },
      ]);
    });

    it('round-trip with single-language descriptionByLang', () => {
      const src = {
        name: 'ZMY_SERVICE',
        description: 'My service',
        originalLanguage: 'EN',
        serviceId: '/sap/zfoo',
        descriptionByLang: [{ language: 'EN', description: 'My service' }],
      };
      const back = wireToLocal(localToWire(src as Record<string, unknown>));
      const header = (back as Record<string, unknown>).header as Record<string, unknown>;
      const generalInformation = (back as Record<string, unknown>).generalInformation as Record<string, unknown>;
      expect(generalInformation.serviceId).toBe('/sap/zfoo');
      expect(header.descriptionByLang).toEqual([{ language: 'EN', description: 'My service' }]);
    });
  });
});