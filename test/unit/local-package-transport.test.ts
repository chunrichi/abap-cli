/**
 * Local-package detection drives transport-free writes for `$TMP`, `$CRW` and
 * every other `$`-prefixed SAP local package. Only the `$` prefix is treated as
 * transport-free: the DEVC creation rule also accepts `TEST...` names for local
 * packages, but that is a package-naming constraint, not a transport guarantee.
 */
import { describe, expect, it } from 'vitest';
import { isLocalPackageName, resolveTransport, transportForPackage } from '../../src/abap_cli/core/transport.js';

describe('isLocalPackageName', () => {
  it.each(['$TMP', '$CRW', '$ZADT_TEST', '  $crw  '])('treats %s as a local package', (name) => {
    expect(isLocalPackageName(name)).toBe(true);
  });

  it.each(['TEST_SCRATCH', 'TEST', 'ZCRW', 'ZDMA_PKG', 'ZLOCAL', 'TEMP_LOCAL', '', undefined, null])(
    'treats %s as transportable',
    (name) => {
      expect(isLocalPackageName(name)).toBe(false);
    },
  );
});

/** Minimal AdtClientWrapper surface used by `resolveTransport`. */
function transportClient() {
  return {
    getConfig: () => ({ sap: { username: 'MOCKUSER' }, transport: 'TRN_CONFIG' }),
    userTransports: async () => ({
      workbench: [{ modifiable: [{ 'tm:number': 'TRN_OPEN' }] }],
      customizing: [],
    }),
  } as unknown as Parameters<typeof resolveTransport>[0];
}

describe('resolveTransport', () => {
  it('returns no transport for a local package even with --tr / config / open requests', async () => {
    await expect(resolveTransport(transportClient(), 'TRN_EXPLICIT', 'TRN_CONFIG', { transportOptional: true })).resolves.toBe('');
    await expect(resolveTransport(transportClient(), undefined, undefined, { transportOptional: true })).resolves.toBe('');
  });

  it('resolves --tr > config > open request for transportable objects', async () => {
    await expect(resolveTransport(transportClient(), 'TRN_EXPLICIT')).resolves.toBe('TRN_EXPLICIT');
    await expect(resolveTransport(transportClient(), undefined, 'TRN_CONFIG')).resolves.toBe('TRN_CONFIG');
    await expect(resolveTransport(transportClient())).resolves.toBe('TRN_OPEN');
  });
});

describe('transportForPackage', () => {
  it.each(['$TMP', '$CRW', '  $crw  '])('drops a stray --tr for the local package %s', (pkg) => {
    expect(transportForPackage(pkg, 'NDK900123')).toBeUndefined();
  });

  it.each(['ZPKG', 'TEST_SCRATCH'])('keeps the request for the transportable package %s', (pkg) => {
    expect(transportForPackage(pkg, 'NDK900123')).toBe('NDK900123');
  });

  it('returns undefined when no request was given', () => {
    expect(transportForPackage('ZPKG', undefined)).toBeUndefined();
  });
});
