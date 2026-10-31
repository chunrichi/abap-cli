/**
 * MSAG schema-compliance tests.
 */
import { describe, it } from 'vitest';
import { expectSchemaPass, expectSchemaFail } from './_helpers.js';

describe('MSAG schema compliance', () => {
  it('zmy_msag.msag.json PASSes msag-v1.json', async () => {
    await expectSchemaPass('zmy_msag.msag.json', 'MSAG');
  });

  it('missing messages field fails msag-v1.json', async () => {
    await expectSchemaFail('MSAG', {
      formatVersion: '1',
      header: { description: 'no-messages', originalLanguage: 'EN' },
    }, /required property 'messages'/);
  });
});