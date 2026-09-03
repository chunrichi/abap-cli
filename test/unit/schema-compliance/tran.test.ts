import { describe, it, expect } from 'vitest';
import { expectSchemaPass } from './_helpers.js';
import { validateAff } from '../../../src/abap_cli/aff/schema-validator.js';

describe('schema-compliance / tran (T033-016)', () => {
  it('upstream example z_aff_example_tran.tran.json passes', async () => {
    await expectSchemaPass('tran/z_aff_example_tran.tran.json');
  });

  it('abapLanguageVersion is allowed for TRAN main header', async () => {
    const r = await validateAff('TRAN', {
      formatVersion: '1',
      header: {
        description: 'with version',
        originalLanguage: 'EN',
        abapLanguageVersion: 'standard',
      },
      generalInformation: {
        transactionType: 'reportTransaction',
        reportTransaction: {
          reportName: 'ZMM_REPORT',
        },
      },
    });
    expect(r.status).toBe('pass');
  });
});
