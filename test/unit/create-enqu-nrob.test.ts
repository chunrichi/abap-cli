import { describe, expect, it } from 'vitest';
import { runCreateEnqu } from '../../src/abap_cli/flows/edit/create-enqu.js';
import { runCreateNrob } from '../../src/abap_cli/flows/edit/create-nrob.js';
import { runPushNrob } from '../../src/abap_cli/flows/edit/push-nrob.js';
import type { CreateOptions } from '../../src/abap_cli/flows/edit/create.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

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

describe('push NROB — local validation', () => {
  // Minimal AFF shape that passes `nrob-v1.json` schema validation. The
  // schema requires `interval.numberLengthDomain`, `interval.percentWarning`,
  // and `interval.subType`; everything else has safe defaults.
  const validNrob = {
    formatVersion: '1',
    header: { description: 'test', originalLanguage: 'en' },
    interval: {
      numberLengthDomain: 'ZNR_TEST',
      percentWarning: 10,
      subType: 'ZNR_TEST_T',
      untilYear: false,
      rolling: true,
      prefix: true,
    },
    configuration: { buffering: 'mainBuffer', bufferedNumbers: 10 },
  };

  async function writeFixture(name: string, intervalDomain: string): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'abap-nrob-test-'));
    const file = path.join(dir, `${name.toLowerCase()}.nrob.json`);
    const data = { ...validNrob, interval: { ...validNrob.interval, numberLengthDomain: intervalDomain } };
    await fs.writeFile(file, JSON.stringify(data));
    return file;
  }

  it('rejects a file whose basename does not match numberLengthDomain', async () => {
    const file = await writeFixture('ZNR_OTHER', 'ZNR_TEST');
    await expect(runPushNrob(file)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('parses the object name from the filename basename (uppercase)', async () => {
    const file = await writeFixture('ZNR_TEST', 'ZNR_TEST');
    // Pin the channel so the test does not depend on the active profile.
    // Once it tries to talk to SAP, it will fail with OBJECT_NOT_FOUND
    // (ADT read) — we only care that local validation passes first.
    await expect(runPushNrob(file, { profile: { kernelRelease: '793' } })).rejects.toMatchObject({
      code: expect.stringMatching(/OBJECT_NOT_FOUND|SAP_ERROR|AUTH_ERROR|CONFIG_ERROR|NROB_CREATE_FAILED|NROB_PUSH_FAILED/),
    });
  });
});
