import { describe, expect, it } from 'vitest';
import { runRun } from '../../src/abap_cli/flows/data/run.js';
import { AdtClientWrapper } from '../../src/abap_cli/clients/adt-client.js';
import { CliError } from '../../src/abap_cli/output/json.js';
import { categoryOf } from '../../src/abap_cli/output/error-codes.js';
import { exitCodeFor } from '../../src/abap_cli/output/exit-codes.js';

// Error-code mapping (data-model §5): SAP/wrapper code → CLI ErrorCode →
// category → exit code, plus special-case semantics (details, nextSteps,
// references, INSTANCE/ACCESS_DENIED collapses).
//
// Cases drive category/exit asserts; semantic assertions live in dedicated
// `details`/`nextSteps`/`references` describes below.

function fakeClient(stdout: string): AdtClientWrapper {
  return { runClass: async () => stdout } as unknown as AdtClientWrapper;
}

function envelope(code: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({ status: 'error', code, message: 'x', ...extra });
}

async function expectThrown(
  code: string,
  extra: Record<string, unknown> = {},
): Promise<CliError> {
  try {
    await runRun('ZCL_FOO', { method: 'x' }, fakeClient(envelope(code, extra)));
    expect.fail('should have thrown');
  } catch (e) {
    return e as CliError;
  }
}

describe('run-flow error mapping (data-model §5)', () => {
  const cases: Array<{
    code: string;
    expected: string;
    category: string;
    exit: number;
  }> = [
    { code: 'METHOD_FAILED', expected: 'METHOD_FAILED', category: 'VALIDATION_ERROR', exit: 7 },
    { code: 'METHOD_NOT_SUPPORTED', expected: 'METHOD_NOT_SUPPORTED', category: 'VALIDATION_ERROR', exit: 7 },
    { code: 'CLASS_NOT_RUNNABLE', expected: 'CLASS_NOT_RUNNABLE', category: 'VALIDATION_ERROR', exit: 7 },
    { code: 'OBJECT_NOT_ACTIVE', expected: 'OBJECT_NOT_ACTIVE', category: 'SAP_ERROR', exit: 6 },
    { code: 'LOCAL_CLASS_NOT_RUNNABLE', expected: 'LOCAL_CLASS_NOT_RUNNABLE', category: 'SAP_ERROR', exit: 6 },
    { code: 'TIMEOUT', expected: 'TIMEOUT', category: 'SAP_ERROR', exit: 6 },
    { code: 'WRAPPER_NOT_DEPLOYED', expected: 'WRAPPER_NOT_DEPLOYED', category: 'NOT_FOUND', exit: 8 },
    { code: 'OBJECT_NOT_FOUND', expected: 'OBJECT_NOT_FOUND', category: 'NOT_FOUND', exit: 8 },
    { code: 'LOCKED', expected: 'LOCKED', category: 'LOCKED', exit: 9 },
  ];

  for (const c of cases) {
    it(`maps ${c.code} → ${c.expected} (exit ${c.exit})`, async () => {
      const err = await expectThrown(c.code);
      expect(err.code).toBe(c.expected);
      expect(categoryOf(err.code)).toBe(c.category);
      expect(exitCodeFor(categoryOf(err.code))).toBe(c.exit);
    });
  }

  it('falls back to SAP_ERROR for unmapped codes', async () => {
    const err = await expectThrown('UNKNOWN_RANDOM');
    expect(err.code).toBe('SAP_ERROR');
  });

  it('INSTANCE_METHOD_NOT_SUPPORTED collapses to METHOD_NOT_SUPPORTED', async () => {
    const err = await expectThrown('INSTANCE_METHOD_NOT_SUPPORTED');
    expect(err.code).toBe('METHOD_NOT_SUPPORTED');
  });

  it('ACCESS_DENIED collapses to AUTH_ERROR (runner semantics)', async () => {
    const err = await expectThrown('ACCESS_DENIED');
    expect(err.code).toBe('AUTH_ERROR');
  });
});

describe('run-flow error semantics (details / nextSteps / references)', () => {
  it('METHOD_FAILED attaches details.class + details.method', async () => {
    const err = await expectThrown('METHOD_FAILED', {
      class: 'ZCL_FOO',
      method: 'compute',
      message: 'CX_SY_ARITHMETIC_ERROR: division by zero',
    });
    expect(err.details?.class).toBe('ZCL_FOO');
    expect(err.details?.method).toBe('compute');
    expect(err.message).toMatch(/CX_SY/);
    expect(err.nextSteps?.some((s) => s.includes('inspect'))).toBe(true);
  });

  it('METHOD_NOT_SUPPORTED carries message + nextSteps', async () => {
    const err = await expectThrown('METHOD_NOT_SUPPORTED', {
      class: 'ZCL_FOO',
      method: 'compute',
      message: 'method signature contains CHANGING/TABLES',
    });
    expect(err.message).toMatch(/CHANGING/);
    expect(err.details?.class).toBe('ZCL_FOO');
    expect(err.details?.method).toBe('compute');
    expect((err.nextSteps ?? []).length).toBeGreaterThan(0);
  });

  it('OBJECT_NOT_ACTIVE nextSteps point at activate + inspect', async () => {
    const err = await expectThrown('OBJECT_NOT_ACTIVE', {
      class: 'ZCL_FOO',
      method: 'x',
      message: 'class is inactive',
    });
    const ns = err.nextSteps ?? [];
    expect(ns.some((s) => s.includes('activate'))).toBe(true);
    expect(ns.some((s) => s.includes('inspect'))).toBe(true);
  });

  it('WRAPPER_NOT_DEPLOYED nextSteps reference "abap deploy"', async () => {
    const err = await expectThrown(
      'WRAPPER_NOT_DEPLOYED',
      { message: 'ZCL_ABAP_VIBE_RUNNER missing on target system' },
    );
    expect(err.nextSteps?.some((s) => s.includes('abap deploy'))).toBe(true);
    // 025 重构：WRAPPER_NOT_DEPLOYED 修复动作在 abap-cli-setup（deploy）
    expect(err.references).toBe('skills/abap-cli-setup/references/errors.md');
  });

  it('METHOD_FAILED references the abap-cli-data errors doc', async () => {
    const err = await expectThrown('METHOD_FAILED', { message: 'target raised cx_root' });
    // 025 重构：其他 run 错误归 abap-cli-data（运行时消费域）
    expect(err.references).toBe('skills/abap-cli-data/references/errors.md');
  });
});