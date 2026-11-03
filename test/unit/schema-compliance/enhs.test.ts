/**
 * ENHS schema compliance — the vendored `enhs-v1.json` against the upstream
 * AFF example document plus the shapes the CLI must reject.
 *
 * The upstream format covers BAdI definitions only.
 */
import { describe, expect, it } from 'vitest';
import { expectSchemaFail } from './_helpers.js';
import { validateAff } from '../../../src/abap_cli/aff/schema-validator.js';

/** Upstream `file-formats/enhs/examples/z_aff_example_enhs.enhs.json`. */
const ENHS_EXAMPLE = {
  formatVersion: '1',
  header: {
    description: 'Example ENHS for ABAP file formats',
    originalLanguage: 'en',
  },
  configuration: { tool: 'badiDefinition' },
  badiDefinitions: [
    {
      name: 'Z_AFF_EXAMPLE_BADI_DEFINITION',
      description: 'This is an example Badi Definition',
      interface: 'Z_AFF_EXAMPLE_BADI_INTF',
      instantiation: 'creatingNewInstances',
      multipleUse: true,
      filters: [
        {
          name: 'EXAMPLE_FILTER',
          description: 'This is an example Filter',
          type: 'string',
        },
      ],
    },
  ],
};

describe('enhs-v1.json', () => {
  it('accepts the upstream AFF example', async () => {
    const r = await validateAff('ENHS', ENHS_EXAMPLE);
    expect(r.status).toBe('pass');
  });

  it('rejects a document without configuration.tool', async () => {
    const { configuration: _omitted, ...withoutConfiguration } = ENHS_EXAMPLE;
    await expectSchemaFail(
      'ENHS',
      withoutConfiguration,
      /required property 'configuration'/,
    );
  });

  it('rejects unknown top-level properties (additionalProperties: false)', async () => {
    await expectSchemaFail(
      'ENHS',
      { ...ENHS_EXAMPLE, package: '$TMP' },
      /additionalProperties|must NOT have additional properties/,
    );
  });
});
