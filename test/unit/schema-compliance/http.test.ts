import { describe, it, expect } from 'vitest';
import { expectSchemaPass, readJsonFixture } from './_helpers.js';
import { validateAff } from '../../../src/abap_cli/aff/schema-validator.js';
import { localToWire as httpLocalToWire, wireToLocal as httpWireToLocal } from '../../../src/abap_cli/formats/http/json.js';

describe('schema-compliance / http (T033-051)', () => {
  it('zmy_service.http.json passes http-v1.json (handcrafted — upstream has no example)', async () => {
    await expectSchemaPass('http/zmy_service.http.json', 'HTTP');
  });

  it('HTTP wire ↔ local round-trips serviceId / descriptionByLang through nested generalInformation / header', async () => {
    const local = await readJsonFixture('http/zmy_service.http.json');
    // Inject SICF extension fields that are not in AFF http-v1.json but live
    // in the CLI's nested wire shape.
    (local as Record<string, unknown>).generalInformation = {
      ...((local as Record<string, unknown>).generalInformation as Record<string, unknown>),
      serviceId: '/sap/zmy_service',
    };
    (local as Record<string, unknown>).header = {
      ...((local as Record<string, unknown>).header as Record<string, unknown>),
      descriptionByLang: [
        { language: 'EN', description: 'Example HTTP service' },
        { language: 'DE', description: 'Beispiel HTTP-Dienst' },
      ],
    };
    const wire = httpLocalToWire(local as any);
    expect((wire as any).generalInformation?.serviceId).toBe('/sap/zmy_service');
    expect((wire as any).header?.descriptionByLang).toHaveLength(2);
    const back = httpWireToLocal(wire);
    expect((back as any).generalInformation?.serviceId).toBe('/sap/zmy_service');
    expect((back as any).header?.descriptionByLang?.[0]?.description).toBe('Example HTTP service');
  });
});