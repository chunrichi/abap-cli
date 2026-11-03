/**
 * `abap publish` / `abap unpublish` — SRVB publish jobs.
 *
 * Pins the metadata projection (service version + binding protocol version +
 * published flag) and the flow contract: derive versions from ADT metadata,
 * map a missing binding to OBJECT_NOT_FOUND, and pass the unpublish flag
 * through to the ADT job.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { parseSrvbMetadata } from '../../src/abap_cli/clients/srvb.js';
import { CliError } from '../../src/abap_cli/output/json.js';

const getSrvbMetadata = vi.fn(async (): Promise<string> => PUBLISHED_V2_XML);
const publishSrvb = vi.fn(async () => ({ severity: 'OK', shortText: 'ok', longText: '' }));

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: { create: async () => ({ getSrvbMetadata, publishSrvb }) },
}));

const PUBLISHED_V2_XML =
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<srvb:serviceBinding srvb:releaseSupported="false" srvb:published="true" srvb:bindingCreated="true"' +
  ' adtcore:name="ZUI_MY_SERVICE" adtcore:type="SRVB/SVB" adtcore:version="active"' +
  ' xmlns:srvb="http://www.sap.com/adt/ddic/ServiceBindings" xmlns:adtcore="http://www.sap.com/adt/core">' +
  '<srvb:services srvb:name="ZUI_MY_SERVICE">' +
  '<srvb:content srvb:version="0001" srvb:releaseState="NOT_RELEASED">' +
  '<srvb:serviceDefinition adtcore:name="ZUI_MY_SERVICE_DEF"/>' +
  '</srvb:content></srvb:services>' +
  '<srvb:binding srvb:type="ODATA" srvb:version="V2" srvb:category="0">' +
  '<srvb:implementation adtcore:name="ZUI_MY_SERVICE"/>' +
  '</srvb:binding></srvb:serviceBinding>';

const UNPUBLISHED_V4_XML = PUBLISHED_V2_XML.replace('srvb:published="true"', 'srvb:published="false"').replace(
  'srvb:version="V2"',
  'srvb:version="V4"',
);

beforeEach(() => {
  vi.clearAllMocks();
  getSrvbMetadata.mockResolvedValue(PUBLISHED_V2_XML);
});

describe('parseSrvbMetadata', () => {
  it('projects service version, binding version and the published flag', () => {
    expect(parseSrvbMetadata(PUBLISHED_V2_XML)).toEqual({
      name: 'ZUI_MY_SERVICE',
      serviceVersion: '0001',
      bindingVersion: 'V2',
      published: true,
      serviceDefinition: 'ZUI_MY_SERVICE_DEF',
    });
  });

  it('handles unpublished ODATA V4 bindings', () => {
    expect(parseSrvbMetadata(UNPUBLISHED_V4_XML)).toMatchObject({
      bindingVersion: 'V4',
      published: false,
    });
  });

  it('returns empty versions when the metadata carries no services/binding', () => {
    const bare =
      '<srvb:serviceBinding xmlns:srvb="http://www.sap.com/adt/ddic/ServiceBindings" adtcore:name="X"' +
      ' xmlns:adtcore="http://www.sap.com/adt/core"/>';
    expect(parseSrvbMetadata(bare)).toMatchObject({ name: 'X', serviceVersion: '', bindingVersion: '', published: false });
  });

  it('rejects a response without the serviceBinding root', () => {
    expect(() => parseSrvbMetadata('<adtcore:mainObject/>')).toThrowError(/serviceBinding/);
  });
});

describe('runPublishSrvb', () => {
  it('publishes with the versions derived from the metadata', async () => {
    const { runPublishSrvb } = await import('../../src/abap_cli/flows/edit/publish-srvb.js');
    const result = await runPublishSrvb('zui_my_service', {});
    expect(getSrvbMetadata).toHaveBeenCalledWith('ZUI_MY_SERVICE');
    expect(publishSrvb).toHaveBeenCalledWith('ZUI_MY_SERVICE', '0001', 'V2', false);
    expect(result.data).toMatchObject({
      object: 'ZUI_MY_SERVICE',
      type: 'SRVB',
      action: 'published',
      channel: 'adt',
      serviceVersion: '0001',
      bindingVersion: 'V2',
      published: true,
      status: 'OK',
    });
    expect(result.human).toBe('Published SRVB ZUI_MY_SERVICE (V2, service version 0001)');
  });

  it('runs the unpublish job when asked', async () => {
    const { runPublishSrvb } = await import('../../src/abap_cli/flows/edit/publish-srvb.js');
    const result = await runPublishSrvb('ZUI_MY_SERVICE', { unpublish: true });
    expect(publishSrvb).toHaveBeenCalledWith('ZUI_MY_SERVICE', '0001', 'V2', true);
    expect(result.data).toMatchObject({ action: 'unpublished', published: false });
    expect(result.human).toBe('Unpublished SRVB ZUI_MY_SERVICE (V2, service version 0001)');
  });

  it('maps a missing binding to OBJECT_NOT_FOUND', async () => {
    getSrvbMetadata.mockRejectedValueOnce(
      new CliError('SAP_ERROR', 'Object not found', { details: { httpStatus: 404 } }),
    );
    const { runPublishSrvb } = await import('../../src/abap_cli/flows/edit/publish-srvb.js');
    await expect(runPublishSrvb('ZUI_NOPE', {})).rejects.toMatchObject({ code: 'OBJECT_NOT_FOUND' });
    expect(publishSrvb).not.toHaveBeenCalled();
  });

  it('rejects a binding whose metadata carries no publish versions', async () => {
    getSrvbMetadata.mockResolvedValueOnce(
      '<srvb:serviceBinding xmlns:srvb="http://www.sap.com/adt/ddic/ServiceBindings" adtcore:name="X"' +
        ' xmlns:adtcore="http://www.sap.com/adt/core"/>',
    );
    const { runPublishSrvb } = await import('../../src/abap_cli/flows/edit/publish-srvb.js');
    await expect(runPublishSrvb('X', {})).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(publishSrvb).not.toHaveBeenCalled();
  });
});
