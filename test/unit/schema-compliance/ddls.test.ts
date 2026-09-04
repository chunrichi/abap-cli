/**
 * Spec 036 T036-038: DDLS schema-compliance tests.
 */
import { describe, it } from 'vitest';
import { expectSchemaPass, expectSchemaFail } from './_helpers.js';

describe('DDLS schema compliance (036)', () => {
  it('zmy_ddls.ddls.json PASSes ddls-v1.json', async () => {
    await expectSchemaPass('ddls/zmy_ddls.ddls.json', 'DDLS');
  });

  it('missing sourceOrigin fails ddls-v1.json', async () => {
    await expectSchemaFail('DDLS', {
      formatVersion: '1',
      header: { description: 'no-origin', originalLanguage: 'EN' },
      sourceType: 'viewEntity',
    }, /required property 'sourceOrigin'/);
  });
});