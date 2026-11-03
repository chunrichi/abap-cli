/**
 * CHDO schema compliance — the vendored `chdo-v1.json` against a document
 * serialized by the reference release (SAP_BASIS 757) plus the shapes the CLI
 * must reject.
 *
 * The schema is the reference-release variant: upstream main later moved
 * `generatedObject` under `generalInformation` and replaced the
 * databaseInsertions/databaseDeletions flags, but the reference release still
 * emits the older v1 document (see `src/abap_cli/schema/README.md`).
 */
import { describe, expect, it } from 'vitest';
import { expectSchemaFail } from './_helpers.js';
import { validateAff } from '../../../src/abap_cli/aff/schema-validator.js';

/** Shape serialized by the reference release for `/ATL/FORECHIST`. */
const CHDO_EXAMPLE = {
  formatVersion: '1',
  header: {
    description: 'Foreclosure History',
    originalLanguage: 'en',
  },
  tablesAndStructures: [
    {
      name: '/ATL/FORECLOSURE',
      multipleChanges: false,
      deleteLogValues: false,
      deleteLogInitialValues: true,
      insertLogValues: false,
      insertLogInitialValues: true,
      referenceTable: '',
    },
  ],
  errorMessage: { id: 'CD', number: '600' },
  generatedObject: { name: '' },
};

describe('chdo-v1.json', () => {
  it('accepts a reference-release CHDO document', async () => {
    const r = await validateAff('CHDO', CHDO_EXAMPLE);
    expect(r.status).toBe('pass');
  });

  it('rejects a document without errorMessage', async () => {
    const { errorMessage: _omitted, ...withoutErrorMessage } = CHDO_EXAMPLE;
    await expectSchemaFail('CHDO', withoutErrorMessage, /required property 'errorMessage'/);
  });

  it('rejects unknown top-level properties (additionalProperties: false)', async () => {
    await expectSchemaFail(
      'CHDO',
      { ...CHDO_EXAMPLE, package: '$TMP' },
      /additionalProperties|must NOT have additional properties/,
    );
  });
});
