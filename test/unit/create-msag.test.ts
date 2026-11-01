/**
 * MSAG create — ADT path (collection POST creates the header, a locked PUT
 * writes the messages) and the runtime ICF fallback when a modern kernel does
 * not route the ADT endpoint.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const adtCreateMsag = vi.fn(async () => undefined);
const adtLock = vi.fn(async () => ({ LOCK_HANDLE: 'LH1' }));
const adtUpdateMsag = vi.fn(async () => undefined);
const adtUnlock = vi.fn(async () => undefined);
const icfPost = vi.fn(async () => ({ status: 'success' as const, data: {}, error: null }));

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: {
    create: async () => ({
      createMsag: adtCreateMsag,
      lock: adtLock,
      updateMsag: adtUpdateMsag,
      unLock: adtUnlock,
    }),
  },
}));
vi.mock('../../src/abap_cli/clients/icf-client.js', () => ({
  IcfClient: { create: async () => ({ post: icfPost }) },
}));
// The create flow always derives the channel from the workspace config.
vi.mock('../../src/abap_cli/config/project-config.js', () => ({
  loadConfig: async () => ({ systemVersion: '789' }),
}));
// Capture the printed result without touching stdout.
vi.mock('../../src/abap_cli/output/json.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/abap_cli/output/json.js')>();
  return { ...actual, printResult: vi.fn() };
});

import { printResult } from '../../src/abap_cli/output/json.js';
import type { CreateOptions } from '../../src/abap_cli/flows/edit/create.js';

const printResultMock = vi.mocked(printResult);

const MSAG_DOC = {
  formatVersion: '1',
  header: { description: 'Probe class', originalLanguage: 'EN' },
  messages: [{ number: '001', text: 'Object &1 created' }],
};

let cwd: string;
beforeEach(() => {
  vi.clearAllMocks();
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'create-msag-'));
});
afterEach(() => {
  fs.rmSync(cwd, { recursive: true, force: true });
});

function writeDoc(name = 'zmy_msag.msag.json'): string {
  const file = path.join(cwd, name);
  fs.writeFileSync(file, JSON.stringify(MSAG_DOC, null, 2));
  return file;
}

async function run(opts: Partial<CreateOptions> = {}) {
  const { clearChannelCache } = await import('../../src/abap_cli/flows/edit/channel-detect.js');
  clearChannelCache();
  const { runCreateMsag } = await import('../../src/abap_cli/flows/edit/create-msag.js');
  await runCreateMsag('ZMY_MSAG', { package: '$TMP', description: 'Probe class', file: writeDoc(), ...opts }, 'json');
}

describe('runCreateMsag — ADT channel', () => {
  it('creates the header, then writes the messages through a locked PUT', async () => {
    await run();

    expect(adtCreateMsag).toHaveBeenCalledWith('ZMY_MSAG', {
      packageName: '$TMP',
      description: 'Probe class',
      language: 'EN',
    });
    expect(adtLock).toHaveBeenCalledWith('/sap/bc/adt/messageclass/ZMY_MSAG');
    expect(adtUpdateMsag).toHaveBeenCalledWith(
      'ZMY_MSAG',
      expect.stringContaining('mc:msgtext="Object &amp;1 created"'),
      'LH1',
      undefined,
    );
    expect(adtUnlock).toHaveBeenCalledWith('/sap/bc/adt/messageclass/ZMY_MSAG', 'LH1');
    expect(icfPost).not.toHaveBeenCalled();
    expect(printResultMock).toHaveBeenCalledWith('json', expect.objectContaining({ channel: 'adt' }), expect.any(String));
  });

  it('drops a stray --tr for a local package', async () => {
    await run({ tr: 'NDK900001' });

    expect(adtCreateMsag).toHaveBeenCalledWith('ZMY_MSAG', expect.not.objectContaining({ transport: 'NDK900001' }));
    expect(adtUpdateMsag).toHaveBeenCalledWith('ZMY_MSAG', expect.any(String), 'LH1', undefined);
  });
});

describe('runCreateMsag — runtime ADT endpoint fallback', () => {
  it('falls back to the ICF create when the ADT endpoint answers "No URI-Mapping"', async () => {
    adtCreateMsag.mockRejectedValueOnce(new Error('No URI-Mapping defined for URI'));
    await run();

    expect(icfPost).toHaveBeenCalledWith('/ddic/msag/ZMY_MSAG', { main: MSAG_DOC });
    expect(printResultMock).toHaveBeenCalledWith('json', expect.objectContaining({ channel: 'icf' }), expect.any(String));
  });

  it('does not swallow unrelated ADT failures', async () => {
    adtCreateMsag.mockRejectedValueOnce(new Error('401 unauthorized'));
    await expect(run()).rejects.toThrow('401 unauthorized');
    expect(icfPost).not.toHaveBeenCalled();
  });
});
