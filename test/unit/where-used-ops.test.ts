/**
 * where-used: pure mapping/filtering coverage.
 *
 * `runWhereUsed` is driven with a stub AdtClientWrapper so no SAP call is made;
 * the ADT transport itself is a thin client.usageReferences wrapper.
 */
import { describe, expect, it } from 'vitest';
import type { UsageReference } from 'abap-adt-api/build/api/syntax.js';
import type { AdtClientWrapper } from '../../src/abap_cli/clients/adt-client.js';
import { CliError } from '../../src/abap_cli/output/json.js';
import {
  normalizeReferences,
  rootObjectType,
  runWhereUsed,
  validateWhereUsedType,
  MAX_WHERE_USED_LIMIT,
} from '../../src/abap_cli/flows/where-used-ops.js';

function usageRef(overrides: Partial<UsageReference> & { uri: string }): UsageReference {
  return {
    'adtcore:name': 'ZCL_CALLER',
    'adtcore:type': 'CLAS/OC',
    ...overrides,
  } as UsageReference;
}

/** Stub wrapper: searchObject feeds resolveObject, usageReferences feeds the flow. */
function stubClient(refs: UsageReference[], hit?: Record<string, string>): AdtClientWrapper {
  return {
    searchObject: async () => [
      {
        'adtcore:name': 'ZCL_TARGET',
        'adtcore:type': 'CLAS/OC',
        'adtcore:uri': '/sap/bc/adt/oo/classes/zcl_target',
        'adtcore:packageName': 'ZPKG',
        ...hit,
      },
    ],
    usageReferences: async () => refs,
  } as unknown as AdtClientWrapper;
}

describe('where-used: rootObjectType', () => {
  it.each([
    ['CLAS/OC', 'CLAS'],
    ['TABL/DT', 'TABL'],
    ['  intf/oi ', 'INTF'],
    ['PROG', 'PROG'],
  ])('reduces %s to %s', (input, expected) => {
    expect(rootObjectType(input)).toBe(expected);
  });
});

describe('where-used: validateWhereUsedType', () => {
  it('returns undefined for an unset value', () => {
    expect(validateWhereUsedType(undefined, '--type')).toBeUndefined();
    expect(validateWhereUsedType('  ', '--type')).toBeUndefined();
  });

  it('normalizes a qualified ADT type', () => {
    expect(validateWhereUsedType('clas/oc', '--type')).toBe('CLAS');
  });

  it('rejects an unsupported type with TYPE_NOT_SUPPORTED', () => {
    try {
      validateWhereUsedType('DTEL', '--ref-type');
      throw new Error('expected validateWhereUsedType to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      expect((error as CliError).code).toBe('TYPE_NOT_SUPPORTED');
    }
  });
});

describe('where-used: normalizeReferences', () => {
  it('drops entries missing a name or uri', () => {
    const refs = [
      usageRef({ uri: '/a' }),
      usageRef({ uri: '', 'adtcore:name': 'X' } as never),
      usageRef({ uri: '/b', 'adtcore:name': '  ' } as never),
    ];
    expect(normalizeReferences(refs).map((r) => r.uri)).toEqual(['/a']);
  });

  it('collapses duplicates by uri + usage context', () => {
    const refs = [
      usageRef({ uri: '/a', usageInformation: 'line 10' }),
      usageRef({ uri: '/a', usageInformation: 'line 10' }),
      usageRef({ uri: '/a', usageInformation: 'line 20' }),
    ];
    expect(normalizeReferences(refs)).toHaveLength(2);
  });
});

describe('where-used: runWhereUsed', () => {
  it('reports queryStatus=empty when there are no references', async () => {
    const result = await runWhereUsed(stubClient([]), 'ZCL_TARGET', {});
    expect(result.queryStatus).toBe('empty');
    expect(result.count).toBe(0);
    expect(result.totalCount).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it('carries the resolved target including its package', async () => {
    const result = await runWhereUsed(stubClient([usageRef({ uri: '/a' })]), 'ZCL_TARGET', {});
    expect(result.target).toEqual({
      name: 'ZCL_TARGET',
      type: 'CLAS/OC',
      uri: '/sap/bc/adt/oo/classes/zcl_target',
      packageName: 'ZPKG',
    });
  });

  it('filters by --ref-type on the reference root type', async () => {
    const refs = [
      usageRef({ uri: '/a', 'adtcore:type': 'CLAS/OC' }),
      usageRef({ uri: '/b', 'adtcore:type': 'PROG/P' }),
    ];
    const result = await runWhereUsed(stubClient(refs), 'ZCL_TARGET', { refType: 'PROG' });
    expect(result.references.map((r) => r.uri)).toEqual(['/b']);
    expect(result.totalCount).toBe(1);
  });

  it('filters by --package case-insensitively', async () => {
    const refs = [
      usageRef({ uri: '/a', packageRef: { 'adtcore:name': 'ZONE' } as never }),
      usageRef({ uri: '/b', packageRef: { 'adtcore:name': 'ZTWO' } as never }),
    ];
    const result = await runWhereUsed(stubClient(refs), 'ZCL_TARGET', { packageName: 'ztwo' });
    expect(result.references.map((r) => r.uri)).toEqual(['/b']);
  });

  it('truncates at --limit and suggests a next step', async () => {
    const refs = [1, 2, 3].map((n) => usageRef({ uri: `/ref${n}` }));
    const result = await runWhereUsed(stubClient(refs), 'ZCL_TARGET', { limit: 2 });
    expect(result.count).toBe(2);
    expect(result.totalCount).toBe(3);
    expect(result.truncated).toBe(true);
    expect(result.nextSteps?.[0]).toContain(String(MAX_WHERE_USED_LIMIT));
  });

  it('omits nextSteps when nothing was truncated', async () => {
    const result = await runWhereUsed(stubClient([usageRef({ uri: '/a' })]), 'ZCL_TARGET', {});
    expect(result).not.toHaveProperty('nextSteps');
  });

  it('rejects a target whose resolved type is unsupported', async () => {
    const client = stubClient([], { 'adtcore:type': 'DTEL/DE' });
    await expect(runWhereUsed(client, 'ZDTEL', {})).rejects.toThrow(CliError);
  });
});
