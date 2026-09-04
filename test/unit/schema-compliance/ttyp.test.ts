/**
 * Spec 036 T036-017: TTYP schema-compliance tests.
 *
 * Two cases:
 *   1. `test/fixtures/ttyp/zmy_ttyp.ttyp.json` PASSes against the
 *      handcrafted `ttyp-v1.json`.
 *   2. An in-memory mutation (`accessType: "invalid"`) FAILS.
 */
import { describe, it, expect } from 'vitest';
import { expectSchemaPass, expectSchemaFail } from './_helpers.js';

describe('TTYP schema compliance (036)', () => {
  it('zmy_ttyp.ttyp.json PASSes ttyp-v1.json', async () => {
    await expectSchemaPass('ttyp/zmy_ttyp.ttyp.json', 'TTYP');
  });

  it('invalid accessType fails ttyp-v1.json', async () => {
    await expectSchemaFail('TTYP', {
      formatVersion: '1',
      header: { description: 'bad', originalLanguage: 'EN' },
      accessType: 'invalid', // not in enum
      lineType: { rowType: 'string' },
    }, /must be equal to one of the allowed values/);
  });
});