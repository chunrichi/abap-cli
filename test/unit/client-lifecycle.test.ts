/**
 * Client-lifecycle unit tests.
 *
 * Verifies the shared release path used by `session/registry.ts`,
 * `session/end-of-command.ts` and `session/signals.ts`:
 *   - normal close resolves quickly,
 *   - a stuck `close()` is bounded by the timeout,
 *   - per-client rejection never bubbles as unhandledRejection,
 *   - a WARN is emitted (and the exit path stays clean) when the timeout wins,
 *   - clients registered while a drain is running are still released,
 *   - a re-entrant call during shutdown returns the same promise,
 *   - registry wrapper functions (`registerAdtClient` / `registerIcfClient`)
 *     route through the same lifecycle, including the `adt` / `icf` filter.
 *
 * Timers are faked: every timeout is driven explicitly, so the suite does not
 * spend real seconds waiting on the 5s default budget. `close()` is invoked
 * from a microtask, so tests flush microtasks before asserting on it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetLifecycle,
  closeTrackedClients,
  DEFAULT_TIMEOUT_MS,
  trackClient,
  trackedLabels,
  untrackClient,
  type CloseableClient,
} from '../../src/abap_cli/clients/client-lifecycle.js';
import {
  drainClients,
  registerAdtClient,
  registerIcfClient,
  resetRegistry,
} from '../../src/abap_cli/session/registry.js';

function makeClient(label: string, closeImpl: () => Promise<void>): CloseableClient {
  return { label, close: closeImpl };
}

/** Let the lifecycle's `Promise.resolve().then(() => client.close())` run. */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

/** Capture stderr WARN lines without polluting the test output. */
function captureStderr(): { lines: () => string[]; restore: () => void } {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  return {
    lines: () => spy.mock.calls.map((call) => String(call[0])),
    restore: () => spy.mockRestore(),
  };
}

describe('client-lifecycle (timeout-bounded shutdown)', () => {
  beforeEach(() => {
    _resetLifecycle();
    resetRegistry();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    _resetLifecycle();
    resetRegistry();
  });

  it('releases a client that never resolves once the timeout elapses', async () => {
    const stderr = captureStderr();
    try {
      let closeCalled = false;
      trackClient(makeClient('stuck', () => new Promise(() => { closeCalled = true; })));
      const drain = closeTrackedClients(50);
      await flushMicrotasks();
      expect(closeCalled).toBe(true);

      // The close promise never settles — only the timer can finish the drain.
      let settled = false;
      void drain.then(() => { settled = true; });
      await vi.advanceTimersByTimeAsync(49);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      await expect(drain).resolves.toBeUndefined();
    } finally {
      stderr.restore();
    }
  });

  it('reports the timed-out client label on stderr without failing the drain', async () => {
    const stderr = captureStderr();
    try {
      trackClient(makeClient('adt', () => new Promise(() => {})));
      const drain = closeTrackedClients(50);
      await vi.advanceTimersByTimeAsync(50);
      await expect(drain).resolves.toBeUndefined();
      expect(stderr.lines().join('\n')).toContain('WARN: releasing the adt client timed out');
    } finally {
      stderr.restore();
    }
  });

  it('does not emit a warning when every client resolves fast', async () => {
    const stderr = captureStderr();
    try {
      trackClient(makeClient('a', async () => {}));
      trackClient(makeClient('b', async () => {}));
      await expect(closeTrackedClients(5_000)).resolves.toBeUndefined();
      expect(stderr.lines()).toEqual([]);
    } finally {
      stderr.restore();
    }
  });

  it('defaults to the 5s budget', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(5_000);
  });

  it('swallows a rejecting close() and never surfaces it as unhandledRejection', async () => {
    // Real timers here: this asserts on a Node-level event, not on the budget.
    vi.useRealTimers();
    const onUnhandled = vi.fn();
    process.on('unhandledRejection', onUnhandled);
    try {
      trackClient(
        makeClient('throws', () => Promise.reject(new Error('boom'))),
      );
      await expect(closeTrackedClients(100)).resolves.toBeUndefined();
      // give the microtask queue a tick to surface any late rejection
      await new Promise((r) => setImmediate(r));
      expect(onUnhandled).not.toHaveBeenCalled();
    } finally {
      process.removeListener('unhandledRejection', onUnhandled);
    }
  });

  it('returns the same in-flight promise on re-entry', async () => {
    let release: () => void = () => {};
    trackClient(
      makeClient('pending', () => new Promise<void>((r) => { release = r; })),
    );
    const first = closeTrackedClients(5_000);
    await flushMicrotasks();
    const second = closeTrackedClients(5_000);
    expect(second).toBe(first);
    release();
    await first;
  });

  it('releases clients registered while a drain is already running', async () => {
    let releaseFirst: () => void = () => {};
    trackClient(makeClient('early', () => new Promise<void>((r) => { releaseFirst = r; })));
    const drain = closeTrackedClients(5_000);
    await flushMicrotasks();
    // A late client appears mid-drain (e.g. from a second command path).
    const lateClosed = vi.fn(async () => {});
    trackClient(makeClient('late', lateClosed));

    releaseFirst();
    await drain;
    expect(lateClosed).toHaveBeenCalledTimes(1);
    expect(trackedLabels()).toEqual([]);
  });

  it('trackedLabels reflects registered and untracked clients', () => {
    const a = makeClient('a', async () => {});
    const b = makeClient('b', async () => {});
    trackClient(a);
    trackClient(b);
    expect(trackedLabels().sort()).toEqual(['a', 'b']);
    untrackClient(a);
    expect(trackedLabels()).toEqual(['b']);
  });
});

describe('session/registry facade', () => {
  beforeEach(() => {
    _resetLifecycle();
    resetRegistry();
  });
  afterEach(() => {
    _resetLifecycle();
    resetRegistry();
  });

  it('registerAdtClient logs out via the shared lifecycle', async () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    registerAdtClient({ logout } as never);
    await drainClients({ adt: true, icf: false });
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('registerIcfClient cleans up via the shared lifecycle', async () => {
    const cleanup = vi.fn();
    registerIcfClient({ cleanup } as never);
    await drainClients({ adt: false, icf: true });
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('honours the adt / icf filter instead of draining everything', async () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    const cleanup = vi.fn();
    registerAdtClient({ logout } as never);
    registerIcfClient({ cleanup } as never);

    await drainClients({ adt: true, icf: false });
    expect(logout).toHaveBeenCalledTimes(1);
    expect(cleanup).not.toHaveBeenCalled();
    // The skipped client stays tracked for a later drain.
    expect(trackedLabels()).toEqual(['icf']);

    await drainClients({ adt: false, icf: true });
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('caps a stuck logout so a slow SAP cannot block the agent loop', async () => {
    vi.useFakeTimers();
    try {
      const logout = vi.fn(() => new Promise(() => {}));
      const stderr = captureStderr();
      try {
        registerAdtClient({ logout } as never);
        const drain = drainClients({ adt: true, icf: false });
        // The lifecycle module owns its own 5s default; drive it explicitly.
        await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS);
        await expect(drain).resolves.toBeUndefined();
        expect(logout).toHaveBeenCalledTimes(1);
        expect(stderr.lines().join('\n')).toContain('timed out after 5000ms');
      } finally {
        stderr.restore();
      }
    } finally {
      vi.useRealTimers();
    }
  });
});
