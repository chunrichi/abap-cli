/**
 * SMBC schema compliance — the vendored `smbc-v1.json` against the upstream
 * AFF example document plus the shapes the CLI must reject.
 */
import { describe, expect, it } from 'vitest';
import { expectSchemaFail } from './_helpers.js';
import { validateAff } from '../../../src/abap_cli/aff/schema-validator.js';

/** Upstream `file-formats/smbc/examples/z_aff_example_smbc.smbc.json`. */
const SMBC_EXAMPLE = {
  formatVersion: '1',
  header: {
    description: 'AFF Example Object for SMBC',
    originalLanguage: 'en',
  },
  serviceConfiguration: {
    serviceBinding: '/DMO/SB_CUSTOMER_MSSK_O4',
    serviceName: '/DMO/SD_CUSTOMER_MSSK',
    serviceVersion: '0001',
    rootEntitySet: 'Customer',
    name: 'Maintain customer',
    configurationGroup: '/DMO/ADMIN_GROUP',
    skipRootEntity: false,
  },
  appConfiguration: {
    listReport: { variantManagement: 'none' },
    objectPages: [{ entitySet: 'Customer', sectionLayout: 'tabs' }],
    tableSettings: [
      {
        entitySet: 'Customer',
        tableType: 'gridTable',
        selectionMode: 'auto',
        enableFullScreen: true,
      },
    ],
  },
};

describe('smbc-v1.json', () => {
  it('accepts the upstream AFF example', async () => {
    const r = await validateAff('SMBC', SMBC_EXAMPLE);
    expect(r.status).toBe('pass');
  });

  it('rejects a document without serviceConfiguration', async () => {
    const { serviceConfiguration: _omitted, ...withoutServiceConfiguration } = SMBC_EXAMPLE;
    await expectSchemaFail(
      'SMBC',
      withoutServiceConfiguration,
      /required property 'serviceConfiguration'/,
    );
  });

  it('rejects a malformed serviceVersion', async () => {
    await expectSchemaFail(
      'SMBC',
      {
        ...SMBC_EXAMPLE,
        serviceConfiguration: { ...SMBC_EXAMPLE.serviceConfiguration, serviceVersion: 1 },
      },
      /serviceConfiguration\/serviceVersion/,
    );
  });
});
