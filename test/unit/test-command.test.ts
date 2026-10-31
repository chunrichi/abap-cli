import { describe, expect, it, vi } from 'vitest';
import type { UnitTestClass, UnitTestRunFlags } from 'abap-adt-api';
import { registerTestCommand } from '../../src/abap_cli/commands/test.js';
import { makeProgram, runCommand } from './cli-helper.js';

// `abap test` command surface:
//   - --schema never calls SAP and declares the frozen option set
//   - missing object / bad level flags fail before any client is created
//   - a passing run prints the summary + no failures
//   - a failing run maps to the TEST_FAILED error envelope (exit 7)
//
// The ADT client is mocked: these tests never touch the network.

const createFn = vi.fn();

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: {
    create: (...args: unknown[]) => createFn(...args),
  },
}));

const OBJECT_HIT = {
  'adtcore:name': 'ZCL_FOO',
  'adtcore:type': 'CLAS/OC',
  'adtcore:uri': '/sap/bc/adt/oo/classes/zcl_foo',
};

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

function testMethod(overrides: Record<string, unknown> = {}) {
  return {
    'adtcore:uri': '/sap/bc/adt/oo/classes/zcl_foo/testclasses/ltc_test#method=TEST_ADD',
    'adtcore:type': 'CLAS/OC',
    'adtcore:name': 'TEST_ADD',
    executionTime: 0.001,
    uriType: 'semantic',
    unit: 'TEST',
    alerts: [],
    ...overrides,
  };
}

function fakeClient(classes: UnitTestClass[]) {
  const calls = {
    search: [] as { query: string; type?: string }[],
    unitRuns: [] as { url: string; flags?: UnitTestRunFlags }[],
  };
  const client = {
    searchObject: async (query: string, type?: string) => {
      calls.search.push({ query, type });
      return [OBJECT_HIT];
    },
    unitTestRun: async (url: string, flags?: UnitTestRunFlags) => {
      calls.unitRuns.push({ url, flags });
      return classes;
    },
  };
  return { client, calls };
}

function program(): ReturnType<typeof makeProgram> {
  const p = makeProgram();
  registerTestCommand(p);
  return p;
}

describe('abap test --schema', () => {
  it('prints the schema with reduced meta and no SAP call', async () => {
    createFn.mockClear();
    const res = await runCommand(program(), ['test', '--schema', '--json']);
    expect(res.exitCode).toBeUndefined();
    expect(createFn).not.toHaveBeenCalled();
    const envelope = JSON.parse(res.stdout);
    expect(envelope.status).toBe('success');
    expect(Object.keys(envelope.meta).sort()).toEqual(['command', 'durationMs', 'version']);
    expect(envelope.data.command).toBe('test');
    expect(envelope.data.scope).toBe('sap');
    expect(envelope.data.arguments).toEqual([
      { name: 'object', type: 'string', required: true, description: expect.any(String) },
    ]);
  });

  it('declares the frozen option set', async () => {
    const res = await runCommand(program(), ['test', '--schema', '--json']);
    const schema = JSON.parse(res.stdout).data;
    const options = schema.options as Array<{ name: string; allowedValues?: string[]; default?: unknown }>;
    expect(options.map((option) => option.name)).toEqual(
      expect.arrayContaining(['--type', '--risk', '--duration', '--all', '--strict', '--schema']),
    );
    const risk = options.find((option) => option.name === '--risk');
    expect(risk?.default).toBe('harmless');
    expect(risk?.allowedValues).toEqual(['harmless', 'dangerous', 'critical']);
    const duration = options.find((option) => option.name === '--duration');
    expect(duration?.default).toBe('short');
    expect(duration?.allowedValues).toEqual(['short', 'medium', 'long']);
    expect(schema.exclusiveGroups).toEqual([['--all', '--risk'], ['--all', '--duration']]);
  });

  it('documents the TEST_FAILED exit contract', async () => {
    const res = await runCommand(program(), ['test', '--schema', '--json']);
    const codes = (JSON.parse(res.stdout).data.errors as Array<{ code: string; category: string; exitCode: number }>);
    expect(codes).toContainEqual({ code: 'TEST_FAILED', category: 'VALIDATION_ERROR', exitCode: 7 });
  });
});

describe('abap test: pre-flight validation', () => {
  it('fails with USAGE (exit 2) when the object is missing', async () => {
    createFn.mockClear();
    const res = await runCommand(program(), ['test', '--json']);
    expect(res.exitCode).toBe(2);
    const envelope = JSON.parse(res.stderr);
    expect(envelope.status).toBe('error');
    expect(envelope.error.code).toBe('USAGE');
    expect(createFn).not.toHaveBeenCalled();
  });

  it('rejects an unknown --risk level before calling SAP', async () => {
    createFn.mockClear();
    const res = await runCommand(program(), ['test', 'ZCL_FOO', '--risk', 'banana', '--json']);
    expect(res.exitCode).toBe(2);
    const envelope = JSON.parse(res.stderr);
    expect(envelope.error.code).toBe('INVALID_ARGUMENT');
    expect(envelope.error.details.allowedValues).toEqual(['harmless', 'dangerous', 'critical']);
    expect(createFn).not.toHaveBeenCalled();
  });

  it('rejects --all combined with --risk', async () => {
    const res = await runCommand(program(), ['test', 'ZCL_FOO', '--all', '--risk', 'harmless', '--json']);
    expect(res.exitCode).toBe(2);
    expect(JSON.parse(res.stderr).error.code).toBe('INVALID_ARGUMENT');
  });
});

describe('abap test: run outcome', () => {
  it('prints the success envelope with summary and no failures', async () => {
    const { client, calls } = fakeClient([testClass({ testmethods: [testMethod()] })]);
    createFn.mockResolvedValue(client);
    const res = await runCommand(program(), ['test', 'ZCL_FOO', '--json']);
    expect(res.exitCode).toBeUndefined();
    const envelope = JSON.parse(res.stdout);
    expect(envelope.status).toBe('success');
    expect(envelope.data.object).toEqual({ name: 'ZCL_FOO', type: 'CLAS/OC' });
    expect(envelope.data.summary).toEqual({
      classes: 1,
      methods: 1,
      passed: 1,
      failed: 0,
      errored: 0,
      durationMs: 1,
    });
    // stripEmpty drops the empty failures array from the envelope.
    expect(envelope.data.failures).toBeUndefined();
    expect(calls.unitRuns[0]).toEqual({
      url: '/sap/bc/adt/oo/classes/zcl_foo',
      flags: { harmless: true, dangerous: false, critical: false, short: true, medium: false, long: false },
    });
  });

  it('prints a human summary in human mode', async () => {
    const { client } = fakeClient([testClass({ testmethods: [testMethod()] })]);
    createFn.mockResolvedValue(client);
    const res = await runCommand(program(), ['test', 'ZCL_FOO']);
    expect(res.exitCode).toBeUndefined();
    expect(res.stdout).toContain('ABAP Unit ZCL_FOO (CLAS/OC)');
    expect(res.stdout).toContain('1 passed');
  });

  it('fails with TEST_FAILED (exit 7) and failure details', async () => {
    const { client } = fakeClient([
      testClass({
        testmethods: [
          testMethod(),
          testMethod({
            'adtcore:name': 'TEST_BROKEN',
            alerts: [
              {
                kind: 'failedAssertion',
                severity: 'critical',
                details: ['Expected 3, actual 4'],
                stack: [],
                title: 'Assertion failed',
              },
            ],
          }),
        ],
      }),
    ]);
    createFn.mockResolvedValue(client);
    const res = await runCommand(program(), ['test', 'ZCL_FOO', '--json']);
    expect(res.exitCode).toBe(7);
    expect(res.stdout).toBe('');
    const envelope = JSON.parse(res.stderr);
    expect(envelope.status).toBe('error');
    expect(envelope.error.code).toBe('TEST_FAILED');
    expect(envelope.error.category).toBe('VALIDATION_ERROR');
    expect(envelope.error.details.summary).toMatchObject({ failed: 1, passed: 1 });
    expect(envelope.error.details.failures[0]).toMatchObject({
      class: 'LTC_TEST',
      method: 'TEST_BROKEN',
      kind: 'failedAssertion',
    });
  });
});
