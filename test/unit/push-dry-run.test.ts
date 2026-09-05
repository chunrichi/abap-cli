import { describe, expect, it, vi } from 'vitest';
import { pushObject, type PushOptions } from '../../src/abap_cli/flows/edit/push-object.js';
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

describe('push dry-run ', () => {
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

  it('a failed unlock surfaces as UNLOCK_WARNING via onWarning, not an error (US-5)', async () => {
    const client = mockClient();
    (client.lock as ReturnType<typeof vi.fn>).mockResolvedValue({ LOCK_HANDLE: 'h1' });
    (client.setObjectSource as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (client.unLock as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('unlock boom'));
    const warnings: unknown[] = [];
    await expect(
      pushObject(
        client,
        { name: 'ZCL_DEMO', type: 'CLAS', objectUrl: '/x' },
        [{ subtype: 'main', sourceUrl: '/x/source/main', content: '' }],
        { transport: 'T1', checkOnly: true, onWarning: (w) => warnings.push(w) },
      ),
    ).resolves.toBeUndefined(); // success — no throw for unlock failure
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ code: 'UNLOCK_WARNING', details: { unlock: 'failed' } });
  });

  // ----- T2.4 stage-order assertion -----

  it('records all stages in lock → write → activate → unlock order (full push, no separate check)', async () => {
    const client = mockClient();
    (client.lock as ReturnType<typeof vi.fn>).mockResolvedValue({ LOCK_HANDLE: 'h1' });
    (client.setObjectSource as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (client.activate as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (client.unLock as ReturnType<typeof vi.fn>).mockResolvedValue({});
    const stages: string[] = [];
    await pushObject(
      client,
      { name: 'ZCL_FULL', type: 'CLAS', objectUrl: '/x' },
      [
        { subtype: 'main', sourceUrl: '/x/source/main', content: 'class ZCL_FULL.' },
        { subtype: 'testclasses', sourceUrl: '/x/source/test', content: '' },
      ],
      { transport: 'T1', checkOnly: false, onStage: (s) => stages.push(s) },
    );
    // Full push: lock → 2× write → activate → unlock.
    // No explicit 'check' stage in full mode — the activation itself runs
    // the server-side syntax check (see push-object.ts:130 comment).
    expect(stages).toEqual([
      'lock',
      'write',
      'write',
      'activate',
      'unlock',
    ]);
  });

  it('skips the activate stage when checkOnly=true', async () => {
    const client = mockClient();
    (client.lock as ReturnType<typeof vi.fn>).mockResolvedValue({ LOCK_HANDLE: 'h1' });
    (client.setObjectSource as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (client.syntaxCheckContent as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (client.unLock as ReturnType<typeof vi.fn>).mockResolvedValue({});
    const stages: string[] = [];
    await pushObject(
      client,
      { name: 'ZCL_CHECK', type: 'CLAS', objectUrl: '/x' },
      [{ subtype: 'main', sourceUrl: '/x/source/main', content: 'class ZCL_CHECK.' }],
      { transport: 'T1', checkOnly: true, onStage: (s) => stages.push(s) },
    );
    expect(stages).toEqual(['lock', 'write', 'check', 'unlock']);
    expect(stages).not.toContain('activate');
  });

  it('skips the activate stage when activate=false (write-only mode)', async () => {
    const client = mockClient();
    (client.lock as ReturnType<typeof vi.fn>).mockResolvedValue({ LOCK_HANDLE: 'h1' });
    (client.setObjectSource as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (client.unLock as ReturnType<typeof vi.fn>).mockResolvedValue({});
    const stages: string[] = [];
    await pushObject(
      client,
      { name: 'ZCL_NOACT', type: 'CLAS', objectUrl: '/x' },
      [{ subtype: 'main', sourceUrl: '/x/source/main', content: 'class ZCL_NOACT.' }],
      { transport: 'T1', checkOnly: false, activate: false, onStage: (s) => stages.push(s) },
    );
    expect(stages).toEqual(['lock', 'write', 'unlock']);
    expect(client.activate).not.toHaveBeenCalled();
  });
});