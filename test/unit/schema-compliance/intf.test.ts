import { describe, it, expect } from 'vitest';
import { expectSchemaPass, expectSchemaFail, readJsonFixture } from './_helpers.js';
import { validateAff } from '../../../src/abap_cli/aff/schema-validator.js';

describe('schema-compliance / intf (T033-015)', () => {
  it('upstream example z_aff_example_intf.intf.json passes', async () => {
    await expectSchemaPass('intf/z_aff_example_intf.intf.json');
  });

  it('INTF fixture with extra unknown top-level key fails', async () => {
    const doc = await readJsonFixture('intf/z_aff_example_intf.intf.json');
    const tampered = { ...(doc as Record<string, unknown>), unknown: 'x' };
    await expectSchemaFail('INTF', tampered, /additionalProperties/i);
  });
});
