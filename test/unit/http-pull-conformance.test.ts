/**
 * HTTP pull must produce a strictly abap-file-format document.
 *
 * The ICF GET path also reports SICF-only metadata (`generalInformation.
 * serviceId`, `header.descriptionByLang[]`). Those are not in the vendored
 * `http-v1.json` (which is `additionalProperties:false`), so writing them into
 * the local `<name>.http.json` made a real `pull HTTP` fail its own pre-write
 * AFF validation. This suite pins the contract:
 *   - wire → local drops the SICF-only members and validates clean
 *   - local → wire still maps AFF `servicePath` to the ICF wire `url`
 */
import { describe, expect, it } from 'vitest';
import { localToWire, wireToLocal, validateHttpService } from '../../src/abap_cli/formats/http/json.js';

const wireWithSicfMetadata = {
  formatVersion: '1' as const,
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

describe('http pull AFF conformance', () => {
  it('wireToLocal drops SICF-only metadata so the local document validates', () => {
    const local = wireToLocal(wireWithSicfMetadata);
    const header = (local as Record<string, unknown>).header as Record<string, unknown>;
    const generalInformation = (local as Record<string, unknown>).generalInformation as Record<string, unknown>;

    expect(header.descriptionByLang).toBeUndefined();
    expect(generalInformation.serviceId).toBeUndefined();
    expect(generalInformation.servicePath).toBe('/sap/zfoo');
    // The pre-write hook runs the same validator; an empty array means the
    // document is writable.
    expect(validateHttpService(local)).toEqual([]);
  });

  it('localToWire maps servicePath back to the ICF wire url and forwards no local-only fields', () => {
    const wire = localToWire({
      name: 'ZMY_SERVICE',
      formatVersion: '1',
      header: { description: 'My service', originalLanguage: 'EN' },
      generalInformation: { handlerClass: 'ZCL_MY_HANDLER', servicePath: '/sap/zfoo' },
    } as Record<string, unknown>);

    expect(wire.generalInformation?.url).toBe('/sap/zfoo');
    expect(wire.generalInformation?.serviceId).toBeUndefined();
    expect(wire.header?.descriptionByLang).toBeUndefined();
  });

  it('still rejects documents that carry non-AFF SICF members', () => {
    const withExtensions = {
      formatVersion: '1',
      header: {
        description: 'Legacy pull',
        originalLanguage: 'EN',
        descriptionByLang: [{ language: 'EN', description: 'Legacy pull' }],
      },
      generalInformation: { handlerClass: 'ZCL_MY_HANDLER', servicePath: '/sap/zfoo' },
    };
    expect(validateHttpService(withExtensions).length).toBeGreaterThan(0);
  });
});
