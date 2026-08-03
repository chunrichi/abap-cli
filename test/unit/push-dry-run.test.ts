import { describe, expect, it, vi } from 'vitest';
import { pushObject, type PushOptions } from '../../src/abap_cli/sync/push-flow.js';
import type { AdtClientWrapper } from '../../src/abap_cli/clients/adt-client.js';

function mockClient(): AdtClientWrapper {
  return {
    lock: vi.fn(),
    setObjectSource: vi.fn(),
    syntaxCheck: vi.fn(),
    syntaxCheckContent: vi.fn(),
    activate: vi.fn(),
    unLock: vi.fn(),
  } as unknown as AdtClientWrapper;
}

describe('push dry-run (FR-012, SC-005)', () => {
  it('pushObject with dryRun makes zero mutating calls and records stages', async () => {
    const client = mockClient();
    const stages: string[] = [];
    const opts: PushOptions = { transport: 'TRN1', checkOnly: false, dryRun: true, onStage: (s) => stages.push(s) };
    await pushObject(
      client,
      { name: 'ZCL_DEMO', type: 'CLAS', objectUrl: '/sap/bc/adt/oo/classes/zcl_demo' },
      [{ subtype: 'main', sourceUrl: '/sap/.../source/main', content: 'REPORT zdemo.' }],
      opts,
    );
    expect(client.lock).not.toHaveBeenCalled();
    expect(client.setObjectSource).not.toHaveBeenCalled();
    expect(client.activate).not.toHaveBeenCalled();
    expect(client.unLock).not.toHaveBeenCalled();
    expect(stages).toContain('lock');
    expect(stages).toContain('write');
    expect(stages).toContain('check');
    expect(stages).toContain('activate');
    expect(stages).toContain('unlock');
  });

  it('pushObject without dryRun still calls lock()', async () => {
    const client = mockClient();
    // lock() returns an object with LOCK_HANDLE; we mock that here
    (client.lock as ReturnType<typeof vi.fn>).mockResolvedValue({ LOCK_HANDLE: 'h1' });
    (client.setObjectSource as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (client.unLock as ReturnType<typeof vi.fn>).mockResolvedValue({});
    const stages: string[] = [];
    await pushObject(
      client,
      { name: 'ZCL_DEMO', type: 'CLAS', objectUrl: '/x' },
      [{ subtype: 'main', sourceUrl: '/x/source/main', content: '' }],
      { transport: 'T1', checkOnly: true, onStage: (s) => stages.push(s) },
    );
    expect(client.lock).toHaveBeenCalled();
    expect(client.unLock).toHaveBeenCalled();
    expect(stages).toContain('unlock');
  });
});