/**
 * DEVC schema compliance — the vendored `devc-v1.json` against a canonical
 * package document plus the shapes the CLI must reject.
 */
import { describe, expect, it } from 'vitest';
import { expectSchemaFail, expectSchemaPass } from './_helpers.js';

describe('devc-v1.json', () => {
  it('accepts the canonical local package fixture', async () => {
    await expectSchemaPass('zmy_package.devc.json');
  });

  it('accepts the upstream AFF example shape (minimal header + generalInformation type)', async () => {
    const { validateAff } = await import('../../../src/abap_cli/aff/schema-validator.js');
    const result = await validateAff('DEVC', {
      formatVersion: '1',
      header: { description: 'Example package', originalLanguage: 'en' },
      generalInformation: { type: 'development', superPackage: '$TMP', softwareComponent: 'LOCAL' },
    });
    expect(result.status).toBe('pass');
  });

  it('rejects an unknown package type', async () => {
    await expectSchemaFail(
      'DEVC',
      {
        formatVersion: '1',
        header: { description: 'bad', originalLanguage: 'en' },
        generalInformation: { type: 'transportable' },
      },
      /generalInformation\/type/,
    );
  });

  it('rejects a missing header', async () => {
    await expectSchemaFail('DEVC', { formatVersion: '1' }, /header/);
  });

  it('rejects unknown top-level properties (additionalProperties: false)', async () => {
    await expectSchemaFail(
      'DEVC',
      {
        formatVersion: '1',
        header: { description: 'bad', originalLanguage: 'en' },
        generalInformation: { type: 'development' },
        name: 'ZMOCK',
      },
      /additionalProperties|must NOT have additional properties/,
    );
  });

  it('rejects an unknown useAccess severity', async () => {
    await expectSchemaFail(
      'DEVC',
      {
        formatVersion: '1',
        header: { description: 'bad', originalLanguage: 'en' },
        generalInformation: { type: 'development' },
        useAccesses: [{ packageInterface: 'SABP_MAIN_PUBLIC', severity: 'fatal' }],
      },
      /useAccesses\/0\/severity/,
    );
  });
});
