/**
 * ENHO schema compliance — the vendored `enho-v1.json` against a document
 * serialized by the reference release (SAP_BASIS 757) plus the shapes the CLI
 * must reject.
 *
 * The schema is the reference-release variant: upstream main later moved
 * `enhancementSpot` under `generalInformation` and changed the BAdI
 * implementation layout, but the reference release still emits the older v1
 * document (see `src/abap_cli/schema/README.md`). The format covers BAdI
 * implementations only.
 */
import { describe, expect, it } from 'vitest';
import { expectSchemaFail } from './_helpers.js';
import { validateAff } from '../../../src/abap_cli/aff/schema-validator.js';

/** Shape serialized by the reference release for `ZEX_HU_BASICS_PRODUCT`. */
const ENHO_EXAMPLE = {
  formatVersion: '1',
  header: {
    description: 'Hu pack',
    originalLanguage: 'en',
  },
  enhancementSpot: 'ZEWM_ENH_SPOT',
  badiImplementations: [
    {
      name: 'ZEX_HU_BASICS_PRODUCT',
      description: 'Hu pack',
      badiDefinition: 'ZEWM_BADI_DEF',
      implementingClass: 'ZCL_EX_HU_BASICS_PRODUCT',
      isDefaultImplementation: false,
      isActiveImplementation: false,
      customizing: 'notSupported',
    },
  ],
  referencedObjects: [],
};

describe('enho-v1.json', () => {
  it('accepts a reference-release ENHO document', async () => {
    const r = await validateAff('ENHO', ENHO_EXAMPLE);
    expect(r.status).toBe('pass');
  });

  it('rejects a document without enhancementSpot', async () => {
    const { enhancementSpot: _omitted, ...withoutSpot } = ENHO_EXAMPLE;
    await expectSchemaFail('ENHO', withoutSpot, /required property 'enhancementSpot'/);
  });

  it('rejects unknown top-level properties (additionalProperties: false)', async () => {
    await expectSchemaFail(
      'ENHO',
      { ...ENHO_EXAMPLE, package: '$TMP' },
      /additionalProperties|must NOT have additional properties/,
    );
  });
});
