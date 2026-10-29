/**
 * F-02 — `abap pull` version semantics.
 *
 * `pull` fetches ADT's working-area (`latest`) version, but `abap run` executes
 * the *active* version. When a failed `push` leaves the new source unactivated,
 * the two diverge and the pulled source silently misrepresents what will run.
 *
 * These tests pin down:
 *  - `versionKind` is always reported in the pull envelope,
 *  - `--active` reaches the source fetch,
 *  - a pending inactive version produces an actionable `meta.warnings` entry.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

// vi.mock factories are hoisted above imports/top-level consts, so the mocks
// must live inside vi.hoisted().
const mocks = vi.hoisted(() => ({
  getObjectSource: vi.fn(async () => 'LATEST'),
  getActiveObjectSource: vi.fn(async () => 'ACTIVE'),
  inactiveObjects: vi.fn(async () => [] as unknown[]),
  pullObject: vi.fn(async () => ({ entries: [], written: [], skipped: [], failed: [] })),
  resolveObject: vi.fn(async () => ({
    name: 'ZCL_X',
    type: 'CLAS/OC',
    objectUrl: '/sap/bc/adt/oo/classes/zcl_x',
    parts: [],
  })),
}));

const { getObjectSource, getActiveObjectSource, inactiveObjects, pullObject, resolveObject } = mocks;

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: {
    create: async () => ({
      getObjectSource: mocks.getObjectSource,
      getActiveObjectSource: mocks.getActiveObjectSource,
      inactiveObjects: mocks.inactiveObjects,
    }),
  },
}));
vi.mock('../../src/abap_cli/core/resolve.js', () => ({ resolveObject: mocks.resolveObject }));
vi.mock('../../src/abap_cli/flows/edit/pull-source.js', () => ({
  pullObject: mocks.pullObject,
  humanSummary: () => 'summary',
}));

import { runPull } from '../../src/abap_cli/flows/edit/pull.js';
import { fetchPullSource } from '../../src/abap_cli/formats/pull-strategy.js';
import { getWarnings, resetWarnings } from '../../src/abap_cli/output/meta.js';

const client = { getObjectSource, getActiveObjectSource } as never;

beforeEach(() => {
  vi.clearAllMocks();
  resetWarnings();
  inactiveObjects.mockImplementation(async () => [] as unknown[]);
});

describe('fetchPullSource', () => {
  it('defaults to the working-area (latest) version', async () => {
    await expect(fetchPullSource(client, '/source/main', undefined)).resolves.toBe('LATEST');
    expect(getActiveObjectSource).not.toHaveBeenCalled();
  });

  it("fetches the active version when 'active' is requested", async () => {
    await expect(fetchPullSource(client, '/source/main', 'active')).resolves.toBe('ACTIVE');
    expect(getObjectSource).not.toHaveBeenCalled();
  });
});

describe('runPull version semantics', () => {
  it("reports versionKind 'latest' by default", async () => {
    const res = await runPull('ZCL_X', { dir: '/tmp/x' });
    expect(res.data.versionKind).toBe('latest');
  });

  it("reports versionKind 'active' and forwards it to the strategy", async () => {
    const res = await runPull('ZCL_X', { dir: '/tmp/x', versionKind: 'active' });
    expect(res.data.versionKind).toBe('active');
    const opts = pullObject.mock.calls[0]?.[2] as { versionKind?: string };
    expect(opts.versionKind).toBe('active');
  });

  it('warns when the object has an unactivated version', async () => {
    inactiveObjects.mockImplementation(async () => [
      { object: { deleted: false, 'adtcore:uri': '/sap/bc/adt/oo/classes/zcl_x' } },
    ]);
    await runPull('ZCL_X', { dir: '/tmp/x' });
    const warning = getWarnings().find((w) => w.code === 'PENDING_INACTIVE_VERSION');
    expect(warning).toBeDefined();
    expect(warning?.message).toContain('abap run');
    expect(warning?.message).toContain('--active');
  });

  it('does not warn when the active version was explicitly requested', async () => {
    inactiveObjects.mockImplementation(async () => [
      { object: { deleted: false, 'adtcore:uri': '/sap/bc/adt/oo/classes/zcl_x' } },
    ]);
    await runPull('ZCL_X', { dir: '/tmp/x', versionKind: 'active' });
    expect(getWarnings().some((w) => w.code === 'PENDING_INACTIVE_VERSION')).toBe(false);
  });

  it('ignores deleted marker entries and tolerates an unavailable endpoint', async () => {
    inactiveObjects.mockImplementation(async () => {
      throw new Error('endpoint unavailable');
    });
    const res = await runPull('ZCL_X', { dir: '/tmp/x' });
    expect(res.data.versionKind).toBe('latest');
    expect(getWarnings().some((w) => w.code === 'PENDING_INACTIVE_VERSION')).toBe(false);
  });
});
