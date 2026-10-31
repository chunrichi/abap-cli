import { describe, expect, it } from 'vitest';
import type {
  SearchResult,
  UnitTestAlert,
  UnitTestClass,
  UnitTestRunFlags,
  UnitTestMethod,
} from 'abap-adt-api';
import {
  buildRunFlags,
  parseDurationLevels,
  parseRiskLevels,
  resolveLevels,
  runUnitTest,
  summarizeUnitTests,
  validateObjectName,
  type UnitTestOptions,
} from '../../src/abap_cli/flows/core/unit-test.js';
import { AdtClientWrapper } from '../../src/abap_cli/clients/adt-client.js';
import { CliError } from '../../src/abap_cli/output/json.js';
import { categoryOf } from '../../src/abap_cli/output/error-codes.js';
import { exitCodeFor } from '../../src/abap_cli/output/exit-codes.js';

// `abap test` flow contract:
//   - object name required (USAGE) + type filter forwarded to resolveObject
//   - --risk / --duration comma-separated level validation, --all expansion
//   - run flags map to abap-adt-api's UnitTestRunFlags
//   - result projection: summary + failures only (passing methods stay hidden)
//   - failedAssertion / exception / --strict warning → TEST_FAILED (exit 7)
//   - object resolution errors pass through; ADT endpoint failures become
//     SAP_ERROR with nextSteps
//
// Every client is a local fake: no network, no SAP.

const OBJECT_HIT: SearchResult = {
  'adtcore:name': 'ZCL_FOO',
  'adtcore:type': 'CLAS/OC',
  'adtcore:uri': '/sap/bc/adt/oo/classes/zcl_foo',
  'adtcore:packageName': '$TMP',
};

function alert(kind: string, overrides: Record<string, unknown> = {}): UnitTestAlert {
  return {
    kind,
    severity: 'critical',
    details: ['Expected 3, actual 4'],
    stack: [],
    title: `${kind} alert`,
    ...overrides,
  } as unknown as UnitTestAlert;
}

function testMethod(overrides: Record<string, unknown> = {}): UnitTestMethod {
  return {
    'adtcore:uri': '/sap/bc/adt/oo/classes/zcl_foo/testclasses/ltc_test#method=TEST_ADD',
    'adtcore:type': 'CLAS/OC',
    'adtcore:name': 'TEST_ADD',
    executionTime: 0.002,
    uriType: 'semantic',
    unit: 'TEST',
    alerts: [],
    ...overrides,
  } as unknown as UnitTestMethod;
}

function testClass(overrides: Record<string, unknown> = {}): UnitTestClass {
  return {
    'adtcore:uri': '/sap/bc/adt/oo/classes/zcl_foo/testclasses/ltc_test',
    'adtcore:type': 'CLAS/OC',
    'adtcore:name': 'LTC_TEST',
    uriType: 'semantic',
    durationCategory: 'short',
    riskLevel: 'harmless',
    testmethods: [],
    alerts: [],
    ...overrides,
  } as unknown as UnitTestClass;
}

interface FakeCalls {
  search: { query: string; type?: string }[];
  unitRuns: { url: string; flags?: UnitTestRunFlags }[];
}

interface FakeOptions {
  hits?: SearchResult[];
  results?: UnitTestClass[] | ((url: string) => Promise<UnitTestClass[]>);
}

function fakeClient(options: FakeOptions = {}): { client: AdtClientWrapper; calls: FakeCalls } {
  const calls: FakeCalls = { search: [], unitRuns: [] };
  const client = {
    searchObject: async (query: string, type?: string) => {
      calls.search.push({ query, type });
      return options.hits ?? [OBJECT_HIT];
    },
    unitTestRun: async (url: string, flags?: UnitTestRunFlags) => {
      calls.unitRuns.push({ url, flags });
      if (typeof options.results === 'function') return options.results(url);
      return options.results ?? [];
    },
  } as unknown as AdtClientWrapper;
  return { client, calls };
}

async function thrown(fn: () => Promise<unknown>): Promise<CliError> {
  try {
    await fn();
    throw new Error('expected the flow to throw');
  } catch (error: unknown) {
    if (error instanceof CliError) return error;
    throw error;
  }
}

describe('unit-test flow: validateObjectName', () => {
  it('trims a normal object name', () => {
    expect(validateObjectName('  zcl_foo ')).toBe('zcl_foo');
  });

  it('rejects a missing object with USAGE (exit 2)', async () => {
    const error = await thrown(async () => validateObjectName(undefined));
    expect(error.code).toBe('USAGE');
    expect(categoryOf(error.code)).toBe('USAGE');
    expect(exitCodeFor(categoryOf(error.code))).toBe(2);
    expect(error.nextSteps?.length).toBeGreaterThan(0);
    expect(error.example).toContain('--json');
  });

  it('rejects a blank object', () => {
    expect(() => validateObjectName('   ')).toThrowError(CliError);
  });
});

describe('unit-test flow: level parsing', () => {
  it('defaults --risk to harmless only', () => {
    expect(parseRiskLevels(undefined)).toEqual(['harmless']);
  });

  it('defaults --duration to short only', () => {
    expect(parseDurationLevels(undefined)).toEqual(['short']);
  });

  it('accepts a comma-separated subset and normalizes case / blanks', () => {
    expect(parseRiskLevels(' HARMLESS , critical ')).toEqual(['harmless', 'critical']);
    expect(parseDurationLevels('medium,long')).toEqual(['medium', 'long']);
  });

  it('returns levels in canonical order regardless of input order', () => {
    expect(parseRiskLevels('critical,harmless')).toEqual(['harmless', 'critical']);
    expect(parseDurationLevels('long,short')).toEqual(['short', 'long']);
  });

  it('deduplicates repeated levels', () => {
    expect(parseRiskLevels('harmless,harmless')).toEqual(['harmless']);
  });

  it('rejects an unknown level with INVALID_ARGUMENT + allowedValues', async () => {
    const error = await thrown(async () => parseRiskLevels('harmless,banana'));
    expect(error.code).toBe('INVALID_ARGUMENT');
    expect(error.details?.allowedValues).toEqual(['harmless', 'dangerous', 'critical']);
    expect(error.nextSteps?.[0]).toContain('harmless, dangerous, critical');
  });

  it('rejects an empty level list', async () => {
    const error = await thrown(async () => parseDurationLevels(' , '));
    expect(error.code).toBe('INVALID_ARGUMENT');
    expect(error.details?.allowedValues).toEqual(['short', 'medium', 'long']);
  });

  it('resolveLevels applies the defaults when no flag is given', () => {
    expect(resolveLevels({})).toEqual({ risk: ['harmless'], duration: ['short'] });
  });

  it('resolveLevels --all expands to every risk and duration level', () => {
    expect(resolveLevels({ all: true })).toEqual({
      risk: ['harmless', 'dangerous', 'critical'],
      duration: ['short', 'medium', 'long'],
    });
  });

  it('rejects --all combined with an explicit level flag', async () => {
    const error = await thrown(async () => resolveLevels({ all: true, risk: 'harmless' }));
    expect(error.code).toBe('INVALID_ARGUMENT');
    expect(error.message).toContain('--all');
  });

  it('buildRunFlags maps level lists to the ADT run configuration', () => {
    expect(buildRunFlags(['harmless'], ['short'])).toEqual({
      harmless: true,
      dangerous: false,
      critical: false,
      short: true,
      medium: false,
      long: false,
    });
    expect(buildRunFlags(['harmless', 'dangerous', 'critical'], ['short', 'medium', 'long'])).toEqual({
      harmless: true,
      dangerous: true,
      critical: true,
      short: true,
      medium: true,
      long: true,
    });
  });
});

describe('unit-test flow: summarizeUnitTests', () => {
  it('counts passing methods and keeps the failure list empty', () => {
    const result = summarizeUnitTests(
      [
        testClass({
          testmethods: [
            testMethod({ executionTime: 0.002 }),
            testMethod({ executionTime: 0.001, 'adtcore:name': 'TEST_SUB' }),
          ],
        }),
      ],
      false,
    );
    expect(result.summary).toEqual({
      classes: 1,
      methods: 2,
      passed: 2,
      failed: 0,
      errored: 0,
      durationMs: 3,
    });
    expect(result.failures).toEqual([]);
  });

  it('handles an empty result set', () => {
    expect(summarizeUnitTests([], false)).toEqual({
      summary: { classes: 0, methods: 0, passed: 0, failed: 0, errored: 0, durationMs: 0 },
      failures: [],
    });
  });

  it('projects a failed assertion to the failure contract shape', () => {
    const result = summarizeUnitTests(
      [
        testClass({
          testmethods: [
            testMethod({
              alerts: [alert('failedAssertion', { severity: 'critical', title: 'Assertion failed' })],
            }),
          ],
        }),
      ],
      false,
    );
    expect(result.summary.failed).toBe(1);
    expect(result.summary.errored).toBe(0);
    expect(result.summary.passed).toBe(0);
    expect(result.failures).toEqual([
      {
        class: 'LTC_TEST',
        method: 'TEST_ADD',
        kind: 'failedAssertion',
        severity: 'critical',
        title: 'Assertion failed',
        details: ['Expected 3, actual 4'],
      },
    ]);
  });

  it('counts an exception as errored, not failed', () => {
    const result = summarizeUnitTests(
      [testClass({ testmethods: [testMethod({ alerts: [alert('exception', { title: 'CX_SY_DIVZERO' })] })] })],
      false,
    );
    expect(result.summary).toMatchObject({ passed: 0, failed: 0, errored: 1 });
    expect(result.failures[0]).toMatchObject({ kind: 'exception', title: 'CX_SY_DIVZERO' });
  });

  it('keeps warnings non-fatal without --strict', () => {
    const result = summarizeUnitTests(
      [testClass({ testmethods: [testMethod({ alerts: [alert('warning')] })] })],
      false,
    );
    expect(result.summary).toMatchObject({ passed: 1, failed: 0, errored: 0 });
    expect(result.failures).toEqual([]);
  });

  it('treats warnings as failures with --strict', () => {
    const result = summarizeUnitTests(
      [testClass({ testmethods: [testMethod({ alerts: [alert('warning')] })] })],
      true,
    );
    expect(result.summary).toMatchObject({ passed: 0, failed: 1, errored: 0 });
    expect(result.failures[0]).toMatchObject({ kind: 'warning' });
  });

  it('reports a class-level alert with an empty method name', () => {
    const result = summarizeUnitTests(
      [testClass({ alerts: [alert('exception', { title: 'Test class could not be instantiated' })] })],
      false,
    );
    expect(result.summary.errored).toBe(1);
    expect(result.failures[0]).toMatchObject({
      class: 'LTC_TEST',
      method: '',
      kind: 'exception',
      title: 'Test class could not be instantiated',
    });
  });
});

describe('unit-test flow: runUnitTest', () => {
  it('resolves the object and runs ABAP Unit with the default flags', async () => {
    const { client, calls } = fakeClient({
      results: [testClass({ testmethods: [testMethod()] })],
    });
    const result = await runUnitTest('zcl_foo', {}, client);

    expect(calls.search[0]?.query).toBe('ZCL_FOO');
    expect(calls.unitRuns).toEqual([
      {
        url: '/sap/bc/adt/oo/classes/zcl_foo',
        flags: { harmless: true, dangerous: false, critical: false, short: true, medium: false, long: false },
      },
    ]);
    expect(result.data.object).toEqual({ name: 'ZCL_FOO', type: 'CLAS/OC' });
    expect(result.data.riskLevels).toEqual(['harmless']);
    expect(result.data.durations).toEqual(['short']);
    expect(result.data.summary).toMatchObject({ classes: 1, methods: 1, passed: 1 });
    expect(result.data.failures).toEqual([]);
    expect(result.human).toContain('ABAP Unit ZCL_FOO (CLAS/OC)');
    expect(result.human).toContain('1 passed');
  });

  it('forwards --type to object resolution', async () => {
    const { client, calls } = fakeClient();
    await runUnitTest('ZCL_FOO', { type: 'CLAS' }, client);
    expect(calls.search[0]?.type).toBe('CLAS');
  });

  it('--all runs every risk and duration level', async () => {
    const { client, calls } = fakeClient();
    const result = await runUnitTest('ZCL_FOO', { all: true }, client);
    expect(calls.unitRuns[0]?.flags).toEqual({
      harmless: true,
      dangerous: true,
      critical: true,
      short: true,
      medium: true,
      long: true,
    });
    expect(result.data.riskLevels).toEqual(['harmless', 'dangerous', 'critical']);
    expect(result.data.durations).toEqual(['short', 'medium', 'long']);
  });

  it('--risk / --duration select the requested levels', async () => {
    const { client, calls } = fakeClient();
    const result = await runUnitTest('ZCL_FOO', { risk: 'dangerous', duration: 'medium' }, client);
    expect(calls.unitRuns[0]?.flags).toEqual({
      harmless: false,
      dangerous: true,
      critical: false,
      short: false,
      medium: true,
      long: false,
    });
    expect(result.data.riskLevels).toEqual(['dangerous']);
    expect(result.data.durations).toEqual(['medium']);
  });

  it('throws TEST_FAILED (exit 7) with summary + failures in details', async () => {
    const { client } = fakeClient({
      results: [
        testClass({
          testmethods: [
            testMethod(),
            testMethod({
              'adtcore:name': 'TEST_BROKEN',
              alerts: [alert('failedAssertion', { title: 'Assertion failed' })],
            }),
          ],
        }),
      ],
    });
    const error = await thrown(async () => runUnitTest('ZCL_FOO', {}, client));
    expect(error.code).toBe('TEST_FAILED');
    expect(categoryOf(error.code)).toBe('VALIDATION_ERROR');
    expect(exitCodeFor(categoryOf(error.code))).toBe(7);
    expect(error.message).toContain('1 failing test(s) for ZCL_FOO');
    expect(error.details).toMatchObject({
      object: { name: 'ZCL_FOO', type: 'CLAS/OC' },
      riskLevels: ['harmless'],
      durations: ['short'],
      summary: { classes: 1, methods: 2, passed: 1, failed: 1, errored: 0 },
    });
    expect((error.details!.failures as unknown[])[0]).toMatchObject({
      class: 'LTC_TEST',
      method: 'TEST_BROKEN',
      kind: 'failedAssertion',
    });
    expect(error.nextSteps?.some((step) => step.includes('--strict'))).toBe(true);
  });

  it('--strict turns a warning-only run into TEST_FAILED', async () => {
    const { client } = fakeClient({
      results: [testClass({ testmethods: [testMethod({ alerts: [alert('warning')] })] })],
    });
    const error = await thrown(async () => runUnitTest('ZCL_FOO', { strict: true }, client));
    expect(error.code).toBe('TEST_FAILED');
    expect((error.details!.failures as Array<{ kind: string }>)[0]?.kind).toBe('warning');
  });

  it('passes OBJECT_NOT_FOUND through from object resolution', async () => {
    const { client, calls } = fakeClient({ hits: [] });
    const error = await thrown(async () => runUnitTest('ZCL_MISSING', {}, client));
    expect(error.code).toBe('OBJECT_NOT_FOUND');
    expect(calls.unitRuns).toEqual([]);
  });

  it('maps an ADT endpoint failure to SAP_ERROR with nextSteps', async () => {
    const { client } = fakeClient({
      results: async () => {
        throw new Error('Resource /sap/bc/adt/abapunit/testruns not found');
      },
    });
    const error = await thrown(async () => runUnitTest('ZCL_FOO', {}, client));
    expect(error.code).toBe('SAP_ERROR');
    expect(error.details?.object).toBe('ZCL_FOO');
    expect(error.nextSteps?.length).toBeGreaterThan(0);
    expect(error.nextSteps?.[0]).toContain('abap doctor');
  });

  it('keeps an existing CliError (AUTH_ERROR) untouched', async () => {
    const authError = new CliError('AUTH_ERROR', '401', { nextSteps: ['profile test'] });
    const { client } = fakeClient({
      results: async () => {
        throw authError;
      },
    });
    const error = await thrown(async () => runUnitTest('ZCL_FOO', {}, client));
    expect(error.code).toBe('AUTH_ERROR');
    expect(error.nextSteps).toEqual(['profile test']);
  });

  it('validates the object name before creating any SAP client', async () => {
    const options: UnitTestOptions = {};
    // No client passed: validation must fire before AdtClientWrapper.create().
    const error = await thrown(async () => runUnitTest(undefined, options));
    expect(error.code).toBe('USAGE');
  });
});
