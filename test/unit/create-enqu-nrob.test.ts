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
});
