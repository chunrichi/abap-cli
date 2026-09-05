/**
 * T3.2 — `renderServiceBindingMetadata` projects the abap-adt-api
 * ServiceBinding payload into the AFF `<name>.srvb.json` shape (matches
 * srvb-v1.json):
 *   - `bindingType` (string)        — type + version joined with space
 *   - `bindingTypeCategory` (enum)  — 0 → 'ui', 1 → 'webApi'
 *   - `services[]` (array)          — name + versions[] + serviceDefinition
 *   - `formatVersion` + `header`    — description / originalLanguage
 *
 * Errors are surfaced as `CliError('SAP_ERROR')` when:
 *   - A service entry is missing a name or service definition.
 *   - A service version is not a numeric string / number.
 *   - The binding payload is missing bindingType / category / services.
 */
import { describe, it, expect } from 'vitest';
import type { ServiceBinding } from 'abap-adt-api/build/api/tablecontents.js';
import { renderServiceBindingMetadata } from '../../src/abap_cli/formats/pull-strategy.js';
import { CliError } from '../../src/abap_cli/output/json.js';

const SAMPLE_BINDING: ServiceBinding = {
  releaseSupported: true,
  published: false,
  repair: false,
  bindingCreated: true,
  responsible: 'DEVELOPER',
  masterLanguage: 'EN',
  masterSystem: 'NPL',
  name: 'ZMY_BINDING',
  type: 'SRVB',
  changedAt: '2024-01-01',
  version: '1',
  createdAt: '2024-01-01',
  changedBy: 'DEVELOPER',
  createdBy: 'DEVELOPER',
  description: 'My binding',
  language: 'EN',
  packageRef: { uri: '/sap/bc/adt/packages/zmy_pkg', type: 'DEVC', name: 'ZMY_PKG' },
  links: [],
  services: [
    {
      name: 'ZUI_BINDING',
      version: 1,
      releaseState: 'RELEASED',
      serviceDefinition: { uri: '/sap/bc/adt/ddl/srvd/zsd_ui', type: 'SRVD', name: 'ZSD_UI' },
    },
  ],
  binding: {
    type: 'SRVD',
    version: '1',
    category: 0, // 0 = 'ui'
    implementation: { name: 'ZCL_UI' },
  },
};

const SAMPLE_META: Record<string, unknown> = {
  'adtcore:description': 'fallback description',
  'adtcore:masterLanguage': 'DE',
};

describe('renderServiceBindingMetadata (T3.2)', () => {
  it('projects a complete binding payload', () => {
    const result = renderServiceBindingMetadata(SAMPLE_BINDING, SAMPLE_META);
    expect(result.formatVersion).toBe('1');
    expect(result.header).toEqual({ description: 'My binding', originalLanguage: 'en' });
    expect(result.bindingType).toBe('SRVD 1');
    expect(result.bindingTypeCategory).toBe('ui');
    expect(result.services).toEqual([
      {
        name: 'ZUI_BINDING',
        versions: [{ serviceVersion: '1', serviceDefinition: 'ZSD_UI' }],
      },
    ]);
  });

  it('decodes category 0 → "ui"', () => {
    const result = renderServiceBindingMetadata(SAMPLE_BINDING, SAMPLE_META);
    expect(result.bindingTypeCategory).toBe('ui');
  });

  it('decodes category 1 → "webApi"', () => {
    const binding = {
      ...SAMPLE_BINDING,
      binding: { ...SAMPLE_BINDING.binding, category: 1 },
    };
    const result = renderServiceBindingMetadata(binding, SAMPLE_META);
    expect(result.bindingTypeCategory).toBe('webApi');
  });

  it('preserves zero-padded numeric-string service version', () => {
    const binding: ServiceBinding = {
      ...SAMPLE_BINDING,
      services: [
        {
          name: 'ZUI_BINDING',
          // SAP may encode the version as a zero-padded string.
          version: '0001' as unknown as number,
          releaseState: 'RELEASED',
          serviceDefinition: { uri: '/x', type: 'SRVD', name: 'ZSD_UI' },
        },
      ],
    };
    const result = renderServiceBindingMetadata(binding, SAMPLE_META);
    expect(result.services[0]!.versions[0]!.serviceVersion).toBe('0001');
  });

  it('falls back to structure meta when binding.description is empty', () => {
    const binding: ServiceBinding = { ...SAMPLE_BINDING, description: '' };
    const result = renderServiceBindingMetadata(binding, SAMPLE_META);
    expect(result.header).toMatchObject({ description: 'fallback description' });
  });

  it('uses the structure meta masterLanguage when binding.masterLanguage is empty', () => {
    const binding: ServiceBinding = { ...SAMPLE_BINDING, masterLanguage: '' };
    const result = renderServiceBindingMetadata(binding, SAMPLE_META);
    expect(result.header.originalLanguage).toBe('de');
  });

  it('defaults to "EN" when no language is available', () => {
    const result = renderServiceBindingMetadata(SAMPLE_BINDING, {});
    expect(result.header.originalLanguage).toBe('en');
  });

  it('throws SAP_ERROR when a service entry is missing the name', () => {
    const binding: ServiceBinding = {
      ...SAMPLE_BINDING,
      services: [
        {
          // @ts-expect-error — intentionally omit name
          name: '',
          version: 1,
          releaseState: 'RELEASED',
          serviceDefinition: { uri: '/x', type: 'SRVD', name: 'ZSD_UI' },
        },
      ],
    };
    expect(() => renderServiceBindingMetadata(binding, {})).toThrow(CliError);
  });

  it('throws SAP_ERROR when a service entry is missing the service definition', () => {
    const binding: ServiceBinding = {
      ...SAMPLE_BINDING,
      services: [
        {
          name: 'ZUI_BINDING',
          version: 1,
          releaseState: 'RELEASED',
          // @ts-expect-error — intentionally omit serviceDefinition.name
          serviceDefinition: { uri: '/x', type: 'SRVD', name: '' },
        },
      ],
    };
    expect(() => renderServiceBindingMetadata(binding, {})).toThrow(CliError);
  });

  it('throws SAP_ERROR when a service version is non-numeric', () => {
    const binding: ServiceBinding = {
      ...SAMPLE_BINDING,
      services: [
        {
          name: 'ZUI_BINDING',
          version: 'not-a-number' as unknown as number,
          releaseState: 'RELEASED',
          serviceDefinition: { uri: '/x', type: 'SRVD', name: 'ZSD_UI' },
        },
      ],
    };
    expect(() => renderServiceBindingMetadata(binding, {})).toThrow(/invalid service version/);
  });

  it('throws SAP_ERROR when the binding payload is incomplete (no services)', () => {
    const binding: ServiceBinding = { ...SAMPLE_BINDING, services: [] };
    expect(() => renderServiceBindingMetadata(binding, {})).toThrow(/did not return complete/);
  });

  it('throws SAP_ERROR when the binding payload is incomplete (unknown category)', () => {
    const binding: ServiceBinding = {
      ...SAMPLE_BINDING,
      binding: { ...SAMPLE_BINDING.binding, category: 99 },
    };
    expect(() => renderServiceBindingMetadata(binding, {})).toThrow(/did not return complete/);
  });

  it('groups versions by service name when multiple versions of the same service exist', () => {
    const binding: ServiceBinding = {
      ...SAMPLE_BINDING,
      services: [
        {
          name: 'ZUI_BINDING',
          version: 1,
          releaseState: 'RELEASED',
          serviceDefinition: { uri: '/x', type: 'SRVD', name: 'ZSD_UI' },
        },
        {
          name: 'ZUI_BINDING',
          version: 2,
          releaseState: 'RELEASED',
          serviceDefinition: { uri: '/x', type: 'SRVD', name: 'ZSD_UI' },
        },
      ],
    };
    const result = renderServiceBindingMetadata(binding, SAMPLE_META);
    expect(result.services).toEqual([
      {
        name: 'ZUI_BINDING',
        versions: [
          { serviceVersion: '1', serviceDefinition: 'ZSD_UI' },
          { serviceVersion: '2', serviceDefinition: 'ZSD_UI' },
        ],
      },
    ]);
  });
});
