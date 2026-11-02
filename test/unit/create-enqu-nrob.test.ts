import { describe, expect, it } from 'vitest';
import { runCreateEnqu } from '../../src/abap_cli/flows/edit/create-enqu.js';
import { runCreateNrob } from '../../src/abap_cli/flows/edit/create-nrob.js';
import type { CreateOptions } from '../../src/abap_cli/flows/edit/create.js';

const baseOpts = { package: '$TMP', description: 'test' } as CreateOptions;

describe('create ENQU — local validation', () => {
  it('rejects a name that is not EZ* / EY* / namespaced', async () => {
    await expect(runCreateEnqu('ZMY_LOCK', baseOpts, 'json')).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
  });

  it('rejects a missing --file', async () => {
    await expect(runCreateEnqu('EZMY_LOCK', baseOpts, 'json')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });
});

describe('create NROB — local validation', () => {
  it('rejects a name that is not Z* / Y* / namespaced', async () => {
    await expect(runCreateNrob('MY_RANGE', baseOpts, 'json')).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
  });

  it('rejects a missing --file', async () => {
    await expect(runCreateNrob('ZMY_RANGE', baseOpts, 'json')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('rejects a name longer than TNRO-NROBJ (10 chars) before any SAP call', async () => {
    await expect(runCreateNrob('ZCLI_TCNROBX', baseOpts, 'json')).rejects.toMatchObject({
      code: 'NROB_NAME_INVALID',
    });
  });

  it('accepts a 10-character name (length gate passes, --file gate follows)', async () => {
    await expect(runCreateNrob('ZCLI_TCNR1', baseOpts, 'json')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });
});
