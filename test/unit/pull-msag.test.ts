/**
 * Spec 036 T036-030 + T036-048: MSAG pull — ADT primary channel and the ICF
 * fallback selected by channel-detect on an ECC EHP6 kernel.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const MSAG_EMPTY_XML = `<?xml version="1.0" encoding="UTF-8"?>
<mc:messageClass xmlns:mc="http://www.sap.com/adt/messageclass">
  <mc:description>Empty class</mc:description>
  <mc:originalLanguage>EN</mc:originalLanguage>
  <mc:messages/>
</mc:messageClass>`;

const MSAG_WITH_ARGS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<mc:messageClass xmlns:mc="http://www.sap.com/adt/messageclass">
  <mc:description>Args class</mc:description>
  <mc:originalLanguage>EN</mc:originalLanguage>
  <mc:messages>
    <mc:message number="001"><mc:text>Object &amp;1 created</mc:text></mc:message>
    <mc:message number="002"><mc:text>Object &amp;1 not found in &amp;2</mc:text></mc:message>
    <mc:message number="003"><mc:text>Plain message</mc:text></mc:message>
    <mc:message number="004"><mc:text>Value &amp;1 &lt; &amp;2</mc:text></mc:message>
    <mc:message number="005"><mc:text>Done</mc:text></mc:message>
  </mc:messages>
</mc:messageClass>`;

const ICF_MSAG_DOC = {
  formatVersion: '1',
  header: { description: 'ECC fallback message class', originalLanguage: 'EN' },
  messages: [{ number: '001', text: 'ICF sourced message' }],
};

const adtGetMsag = vi.fn(async () => MSAG_EMPTY_XML);
const icfGet = vi.fn(async () => ({
  status: 'success' as const,
  data: { main: ICF_MSAG_DOC },
  error: null,
}));

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: { create: async () => ({ getMsag: adtGetMsag }) },
}));
vi.mock('../../src/abap_cli/clients/icf-client.js', () => ({
  IcfClient: { create: async () => ({ get: icfGet }) },
}));
// Every test supplies an explicit profile + rootDir, so the workspace config
// is never consulted — stub it out so no keychain/native module is loaded.
vi.mock('../../src/abap_cli/config/project-config.js', () => ({
  loadConfig: async () => ({ systemVersion: '756' }),
  findWorkspaceConfig: () => undefined,
}));

const ADT_PROFILE = { kernelRelease: '756' };
const ECC_PROFILE = { kernelRelease: '731' };

let root: string;
beforeEach(() => {
  vi.clearAllMocks();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'pull-msag-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

async function load() {
  const { runPullMsag } = await import('../../src/abap_cli/flows/edit/pull-msag.js');
  const { clearChannelCache } = await import('../../src/abap_cli/flows/edit/channel-detect.js');
  clearChannelCache();
  return runPullMsag;
}

describe('runPullMsag — ADT channel (036 US3)', () => {
  it('pulls an empty message class via ADT', async () => {
    const runPullMsag = await load();
    const result = await runPullMsag('zmy_empty', { profile: ADT_PROFILE, rootDir: root });

    expect(result.channel).toBe('adt');
    expect(result.doc.messages).toEqual([]);
    expect(adtGetMsag).toHaveBeenCalledTimes(1);
    expect(icfGet).not.toHaveBeenCalled();

    const json = JSON.parse(fs.readFileSync(path.join(root, 'msag/zmy_empty/zmy_empty.msag.json'), 'utf8'));
    expect(json.header.description).toBe('Empty class');
  });

  it('decodes &1 placeholders across all five messages', async () => {
    adtGetMsag.mockResolvedValueOnce(MSAG_WITH_ARGS_XML);
    const runPullMsag = await load();
    const result = await runPullMsag('zmy_with_args', { profile: ADT_PROFILE, rootDir: root });

    expect(result.doc.messages).toHaveLength(5);
    expect(result.doc.messages[0]).toEqual({ number: '001', text: 'Object &1 created' });
    expect(result.doc.messages[1]!.text).toBe('Object &1 not found in &2');
    expect(result.doc.messages[3]!.text).toBe('Value &1 < &2');
  });
});

describe('runPullMsag — ICF fallback (036 US5 / SC-003)', () => {
  it('routes to ICF on ECC EHP6 with the message-class fallback reason', async () => {
    const runPullMsag = await load();
    const result = await runPullMsag('zmy_msag', { profile: ECC_PROFILE, rootDir: root });

    expect(result.channel).toBe('icf');
    expect(result.fallbackReason).toBe('ECC_EHP6_NO_ADT_MESSAGECLASS');
    expect(icfGet).toHaveBeenCalledWith('/ddic/msag/ZMY_MSAG');
    expect(adtGetMsag).not.toHaveBeenCalled();
  });

  it('maps an ICF NOT_FOUND response onto OBJECT_NOT_FOUND', async () => {
    icfGet.mockResolvedValueOnce({
      status: 'error' as never,
      data: null as never,
      error: { code: 'NOT_FOUND', message: 'MSAG ZMY_GONE not found' } as never,
    });
    const runPullMsag = await load();
    await expect(runPullMsag('zmy_gone', { profile: ECC_PROFILE, rootDir: root })).rejects.toMatchObject({
      code: 'OBJECT_NOT_FOUND',
    });
  });
});
