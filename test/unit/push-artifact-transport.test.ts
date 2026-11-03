/**
 * Shared package/transport resolution for AFF artifact pushes.
 *
 * `abap pull` writes abap-file-format documents without a `package`, so the
 * update path must read the existing object's package back from SAP and apply
 * the same local-package rule as the source push. These tests pin the decision
 * table (file value wins, local is transport-free, transportable falls back to
 * --tr > config > recorded > open request) and the best-effort search.
 */
import { describe, expect, it } from 'vitest';
import type { AdtClientWrapper } from '../../src/abap_cli/clients/adt-client.js';
import { resolveArtifactPushTransport } from '../../src/abap_cli/flows/edit/push-artifact-transport.js';

interface ClientState {
  searchResults?: Array<Record<string, string>>;
  searchError?: Error;
  configTransport?: string;
  openTransport?: string;
}

function fakeClient(state: ClientState = {}) {
  const calls: Array<{ query: string; type?: string }> = [];
  const client = {
    searchObject: async (query: string, type?: string) => {
      calls.push({ query, type });
      if (state.searchError) throw state.searchError;
      return state.searchResults ?? [];
    },
    getConfig: () => ({ sap: { username: 'MOCKUSER' }, transport: state.configTransport ?? '' }),
    userTransports: async () => ({
      workbench: state.openTransport ? [{ modifiable: [{ 'tm:number': state.openTransport }] }] : [],
      customizing: [],
    }),
  } as unknown as AdtClientWrapper;
  return { client, calls };
}

function searchHit(name: string, type: string, packageName: string) {
  return {
    'adtcore:name': name,
    'adtcore:type': type,
    'adtcore:uri': `/sap/bc/adt/ddic/tables/${name.toLowerCase()}`,
    'adtcore:packageName': packageName,
  };
}

const TARGET = { objectName: 'ZCLI_TC_TABL', objectType: 'TABL' };

describe('resolveArtifactPushTransport', () => {
  it('trusts the package a local file carries and skips the SAP search', async () => {
    const { client, calls } = fakeClient({ searchResults: [searchHit('ZCLI_TC_TABL', 'TABL/DT', '$TMP')] });
    const result = await resolveArtifactPushTransport(client, { ...TARGET, filePackage: '$TMP' });
    expect(result).toEqual({ packageName: '$TMP', transport: '' });
    expect(calls).toHaveLength(0);
  });

  it('treats an explicit non-local file package as transportable', async () => {
    const { client, calls } = fakeClient();
    const result = await resolveArtifactPushTransport(client, { ...TARGET, filePackage: ' zpkg ' }, 'TRN001');
    expect(result).toEqual({ packageName: 'ZPKG', transport: 'TRN001' });
    expect(calls).toHaveLength(0);
  });

  it('resolves a pulled file (no package) to the local-package rule via search', async () => {
    const { client, calls } = fakeClient({ searchResults: [searchHit('ZCLI_TC_TABL', 'TABL/DT', '$CRW')] });
    const result = await resolveArtifactPushTransport(client, TARGET, 'TRN001');
    expect(result).toEqual({ packageName: '$CRW', transport: '' });
    // The wildcard retry from resolve.ts only happens when the first search is empty.
    expect(calls[0]).toMatchObject({ query: 'ZCLI_TC_TABL', type: 'TABL' });
  });

  it('resolves a transportable target package and uses the open request', async () => {
    const { client } = fakeClient({
      searchResults: [searchHit('ZCLI_TC_TABL', 'TABL/DT', 'ZPKG')],
      openTransport: 'TRN_OPEN',
    });
    const result = await resolveArtifactPushTransport(client, TARGET);
    expect(result).toEqual({ packageName: 'ZPKG', transport: 'TRN_OPEN' });
  });

  it('prefers --tr over config and the file-recorded request', async () => {
    const { client } = fakeClient({
      searchResults: [searchHit('ZCLI_TC_TABL', 'TABL/DT', 'ZPKG')],
      configTransport: 'TRN_CONFIG',
      openTransport: 'TRN_OPEN',
    });
    await expect(
      resolveArtifactPushTransport(client, { ...TARGET, fileTransport: 'TRN_FILE' }, 'TRN_CLI'),
    ).resolves.toEqual({ packageName: 'ZPKG', transport: 'TRN_CLI' });
  });

  it('falls back to the file-recorded request when no --tr/config exists', async () => {
    const { client } = fakeClient({
      searchResults: [searchHit('ZCLI_TC_TABL', 'TABL/DT', 'ZPKG')],
      openTransport: 'TRN_OPEN',
    });
    await expect(resolveArtifactPushTransport(client, { ...TARGET, fileTransport: 'TRN_FILE' })).resolves.toEqual({
      packageName: 'ZPKG',
      transport: 'TRN_FILE',
    });
  });

  it('raises NO_TRANSPORT when a transportable target has no request anywhere', async () => {
    const { client } = fakeClient({ searchResults: [searchHit('ZCLI_TC_TABL', 'TABL/DT', 'ZPKG')] });
    await expect(resolveArtifactPushTransport(client, TARGET)).rejects.toMatchObject({ code: 'NO_TRANSPORT' });
  });

  it('keeps the old transport rule when the SAP search fails', async () => {
    const { client } = fakeClient({ searchError: new Error('search endpoint unavailable') });
    // Without a package the target cannot be proven local: an explicit --tr
    // still succeeds, otherwise the pre-existing NO_TRANSPORT guidance applies.
    await expect(resolveArtifactPushTransport(client, TARGET, 'TRN001')).resolves.toEqual({
      packageName: undefined,
      transport: 'TRN001',
    });
    await expect(resolveArtifactPushTransport(client, TARGET)).rejects.toMatchObject({ code: 'NO_TRANSPORT' });
  });

  it('ignores a search hit without a package name', async () => {
    const { client } = fakeClient({ searchResults: [searchHit('ZCLI_TC_TABL', 'TABL/DT', '')] });
    await expect(resolveArtifactPushTransport(client, TARGET, 'TRN001')).resolves.toEqual({
      packageName: undefined,
      transport: 'TRN001',
    });
  });
});
