/**
 * DEVC delete flow (`abap delete <name> --type DEVC`).
 *
 * Packages are deleted without the lock/unlock cycle every other type uses.
 * The flow reads the package first (existence + software component), applies
 * the transport rule, and retries once on a fresh session when SAP reports the
 * package as locked (a stale ADT session from an earlier command).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { CliError } from '../../src/abap_cli/output/json.js';
import { runDeleteDevc } from '../../src/abap_cli/flows/edit/delete-devc.js';

const getPackage = vi.fn();
const deletePackage = vi.fn();
const logout = vi.fn();

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: {
    create: async () => ({ getPackage, deletePackage, logout }),
  },
}));

function packageXml(name: string, softwareComponent: string, superPackage = ''): string {
  return `<?xml version="1.0" encoding="utf-8"?><pak:package xmlns:pak="http://www.sap.com/adt/packages" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:responsible="MOCKUSER" adtcore:masterLanguage="EN" adtcore:name="${name}" adtcore:type="DEVC/K" adtcore:version="active" adtcore:description="package ${name}" adtcore:language="EN"><pak:attributes pak:packageType="development" pak:isAddingObjectsAllowed="false" pak:isEncapsulated="false" pak:recordChanges="false" pak:languageVersion=""/>${
    superPackage ? `<pak:superPackage adtcore:type="DEVC/K" adtcore:name="${superPackage}"/>` : '<pak:superPackage/>'
  }<pak:applicationComponent pak:name=""/><pak:transport><pak:softwareComponent pak:name="${softwareComponent}"/><pak:transportLayer pak:name=""/></pak:transport><pak:useAccesses pak:isVisible="false"/><pak:subPackages/></pak:package>`;
}

beforeEach(() => {
  vi.clearAllMocks();
  getPackage.mockImplementation(async (name: string) => {
    if (name === '$ZCLI_TC_PKG01') return packageXml('$ZCLI_TC_PKG01', 'LOCAL', '$TMP');
    if (name === 'TEST_ZCLI_PKG') return packageXml('TEST_ZCLI_PKG', 'LOCAL', '$TMP');
    if (name === 'ZDEV') return packageXml('ZDEV', 'ZLOCAL', 'ZLOCAL');
    throw new CliError('OBJECT_NOT_FOUND', `Package ${name} not found`, { object: name, type: 'DEVC' });
  });
  deletePackage.mockResolvedValue(undefined);
  logout.mockResolvedValue(undefined);
});

const yes = { yes: true };

describe('delete DEVC — happy path', () => {
  it('deletes a LOCAL $TMP sub package without a lock and reports the super package', async () => {
    const result = await runDeleteDevc('$zcli_tc_pkg01', { ...yes });
    expect(getPackage).toHaveBeenCalledWith('$ZCLI_TC_PKG01');
    expect(deletePackage).toHaveBeenCalledWith('$ZCLI_TC_PKG01', undefined);
    expect(result.data).toMatchObject({
      object: '$ZCLI_TC_PKG01',
      type: 'DEVC',
      packageName: '$TMP',
      deleted: true,
      lockReleased: false,
    });
    expect(result.human).toContain('Deleted DEVC $ZCLI_TC_PKG01');
  });

  it('treats a TEST-prefixed package as local', async () => {
    const result = await runDeleteDevc('test_zcli_pkg', { ...yes });
    expect(deletePackage).toHaveBeenCalledWith('TEST_ZCLI_PKG', undefined);
    expect(result.data.deleted).toBe(true);
  });
});

describe('delete DEVC — transport rule', () => {
  it('requires --tr for a transportable package and never calls delete', async () => {
    await expect(runDeleteDevc('ZDEV', { ...yes })).rejects.toMatchObject({
      code: 'MISSING_TRANSPORT',
    });
    expect(deletePackage).not.toHaveBeenCalled();
  });

  it('forwards --tr for a transportable package', async () => {
    await runDeleteDevc('ZDEV', { ...yes, tr: 'NDK900123' });
    expect(deletePackage).toHaveBeenCalledWith('ZDEV', 'NDK900123');
  });
});

describe('delete DEVC — lock retry', () => {
  it('drops the reused session and retries once when SAP reports the package as locked', async () => {
    deletePackage
      .mockRejectedValueOnce(new CliError('SAP_ERROR', '包 $ZCLI_TC_PKG01 已锁定'))
      .mockResolvedValueOnce(undefined);
    const result = await runDeleteDevc('$ZCLI_TC_PKG01', { ...yes });
    expect(logout).toHaveBeenCalledTimes(1);
    expect(deletePackage).toHaveBeenCalledTimes(2);
    expect(result.data.deleted).toBe(true);
  });

  it('surfaces DELETE_FAILED when the retry also fails', async () => {
    deletePackage.mockRejectedValue(new CliError('SAP_ERROR', 'package is locked by user OTHER'));
    await expect(runDeleteDevc('$ZCLI_TC_PKG01', { ...yes })).rejects.toMatchObject({
      code: 'DELETE_FAILED',
    });
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('does not retry other delete failures', async () => {
    deletePackage.mockRejectedValue(new CliError('SAP_ERROR', 'No authorization'));
    await expect(runDeleteDevc('$ZCLI_TC_PKG01', { ...yes })).rejects.toMatchObject({
      code: 'DELETE_FAILED',
    });
    expect(logout).not.toHaveBeenCalled();
  });
});

describe('delete DEVC — guards', () => {
  it('requires --yes', async () => {
    await expect(runDeleteDevc('$ZCLI_TC_PKG01', { type: 'DEVC', yes: false })).rejects.toMatchObject({
      code: 'USAGE',
    });
    expect(deletePackage).not.toHaveBeenCalled();
  });

  it('propagates OBJECT_NOT_FOUND for a missing package', async () => {
    await expect(runDeleteDevc('$NO_SUCH', { ...yes })).rejects.toMatchObject({
      code: 'OBJECT_NOT_FOUND',
    });
    expect(deletePackage).not.toHaveBeenCalled();
  });
});
