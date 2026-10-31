import { describe, it, expect } from 'vitest';
import { expectSchemaPass } from './_helpers.js';
import { validateAff } from '../../../src/abap_cli/aff/schema-validator.js';
import { localToWire as httpLocalToWire, wireToLocal as httpWireToLocal } from '../../../src/abap_cli/formats/http/json.js';

describe('schema-compliance / http', () => {
  it('zmy_service.http.json passes http-v1.json', async () => {
    await expectSchemaPass('zmy_service.http.json', 'HTTP');
  });

  it('rejects the pre-upstream `generalInformation.url` member', async () => {
    const legacy = {
      formatVersion: '1',
      header: { description: 'legacy', originalLanguage: 'en' },
      generalInformation: { handlerClass: 'ZCL_MY_HANDLER', url: '/sap/zmy_service' },
    };
    const r = await validateAff('HTTP', legacy);
    expect(r.status).toBe('fail');
    expect(r.errors.map((e) => `${e.instancePath} ${e.keyword}`).join('\n')).toMatch(/generalInformation/);
  });

  it('drops SICF-only metadata from the local document so it stays AFF-valid', async () => {
    // The ICF GET path also reports serviceId / descriptionByLang; writing
    // them into the local .http.json would fail http-v1.json
    // (additionalProperties:false) in the pull pre-write hook.
    const wire = {
      formatVersion: '1',
      header: {
        description: 'Example HTTP service',
        originalLanguage: 'en',
        descriptionByLang: [
          { language: 'EN', description: 'Example HTTP service' },
          { language: 'DE', description: 'Beispiel HTTP-Dienst' },
        ],
      },
      generalInformation: {
        handlerClass: 'ZCL_MY_HANDLER',
        url: '/sap/zmy_service',
        serviceId: '/sap/zmy_service',
      },
    };
    const local = httpWireToLocal(wire as any);
    expect((local as any).generalInformation?.servicePath).toBe('/sap/zmy_service');
    expect((local as any).generalInformation?.serviceId).toBeUndefined();
    expect((local as any).header?.descriptionByLang).toBeUndefined();

    const validated = await validateAff('HTTP', local);
    expect(validated.status).not.toBe('fail');

    // local → wire keeps mapping AFF servicePath onto the ICF handler's url.
    const back = httpLocalToWire(local as any);
    expect((back as any).generalInformation?.url).toBe('/sap/zmy_service');
  });
});
