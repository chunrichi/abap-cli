/**
 * APLO schema compliance — the vendored `aplo-v1.json` against the upstream
 * AFF example document plus the shapes the CLI must reject.
 */
import { describe, expect, it } from 'vitest';
import { expectSchemaFail } from './_helpers.js';
import { validateAff } from '../../../src/abap_cli/aff/schema-validator.js';

/** Upstream `file-formats/aplo/examples/z_aff_example_aplo.aplo.json`. */
const APLO_EXAMPLE = {
  formatVersion: '1',
  header: {
    description: 'Application Log Test Object',
    originalLanguage: 'en',
  },
  subobjects: [
    { name: 'SUBOBJECT1', description: 'Subobject 1' },
    { name: 'SUBOBJECT2', description: 'Subobject 2' },
  ],
};

describe('aplo-v1.json', () => {
  it('accepts the upstream AFF example', async () => {
    const r = await validateAff('APLO', APLO_EXAMPLE);
    expect(r.status).toBe('pass');
  });

  it('rejects a document without subobjects', async () => {
    await expectSchemaFail(
      'APLO',
      { formatVersion: '1', header: { description: 'no subobjects', originalLanguage: 'en' } },
      /required property 'subobjects'/,
    );
  });

  it('rejects unknown top-level properties (additionalProperties: false)', async () => {
    await expectSchemaFail(
      'APLO',
      { ...APLO_EXAMPLE, package: '$TMP' },
      /additionalProperties|must NOT have additional properties/,
    );
  });
});
