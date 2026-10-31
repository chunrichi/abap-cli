/**
 * Activation `*Executed` flags are the difference between "activated" and
 * "SAP answered HTTP 200 but did nothing".
 *
 * Real SAP answers the wrong request shape with a silent no-op: HTTP 200, no
 * message, and `checkExecuted="false" activationExecuted="false"
 * generationExecuted="false"`. The source is written, the active version is
 * unchanged, and a caller that only inspects messages sees success.
 *
 * On a write path (push) that must be a failure — but a push of *unchanged*
 * source produces the same flags for a legitimate reason (nothing to
 * activate). The pending-inactive probe separates the two; verified against
 * S/4HANA: an unchanged re-push leaves `hasPendingInactiveVersion=false` and
 * every part active.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import {
  assertActivationExecuted,
  parseActivationResponse,
  resolveActivationOutcome,
} from '../../src/abap_cli/clients/activation.js';
import { CliError } from '../../src/abap_cli/output/json.js';
import { getWarnings, resetWarnings } from '../../src/abap_cli/output/meta.js';

const SILENT_NOOP =
  '<?xml version="1.0" encoding="utf-8"?><chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist">' +
  '<chkl:properties checkExecuted="false" activationExecuted="false" generationExecuted="false"/></chkl:messages>';

const EXECUTED =
  '<?xml version="1.0" encoding="utf-8"?><chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist">' +
  '<chkl:properties checkExecuted="true" activationExecuted="true" generationExecuted="true"/></chkl:messages>';

async function catchAsyncError(run: () => Promise<void>): Promise<CliError | undefined> {
  try {
    await run();
    return undefined;
  } catch (error) {
    return error as CliError;
  }
}

beforeEach(() => {
  resetWarnings();
});

describe('silent no-op (HTTP 200 + activationExecuted=false)', () => {
  it('leaves parsing neutral: the flags are reported, success is not invented', () => {
    const result = parseActivationResponse(SILENT_NOOP);
    expect(result.messages).toEqual([]);
    expect(result.activationExecuted).toBe(false);
    expect(result.success).toBe(true);
  });

  it('fails the push path when a pending inactive version remains', async () => {
    const error = await catchAsyncError(() =>
      resolveActivationOutcome(parseActivationResponse(SILENT_NOOP), 'ZCL_FOO', { requireExecuted: true }, async () => true),
    );
    expect(error?.code).toBe('ACTIVATION_FAILED');
    expect(error?.message).toMatch(/silently skipped/);
    expect(error?.message).toMatch(/activationExecuted=false/);
    expect(error?.details).toMatchObject({
      silentNoop: true,
      checkExecuted: false,
      activationExecuted: false,
      generationExecuted: false,
      written: true,
      activated: false,
    });
    const steps = (error?.nextSteps ?? []).join('\n');
    expect(steps).toContain('abap inspect ZCL_FOO --activation');
    expect(steps).toContain('abap activate ZCL_FOO --yes');
  });

  it('is fail-closed when no pending-state probe is supplied', async () => {
    const error = await catchAsyncError(() =>
      resolveActivationOutcome(parseActivationResponse(SILENT_NOOP), 'ZCL_FOO', { requireExecuted: true }),
    );
    expect(error?.code).toBe('ACTIVATION_FAILED');
  });

  it('succeeds with a warning when nothing is pending (unchanged re-push)', async () => {
    await expect(
      resolveActivationOutcome(parseActivationResponse(SILENT_NOOP), 'ZCL_FOO', { requireExecuted: true }, async () => false),
    ).resolves.toBeUndefined();
    const warnings = getWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      code: 'ACTIVATION_NOT_EXECUTED',
      details: { object: 'ZCL_FOO', pendingInactiveVersion: false },
    });
    expect(warnings[0]!.message).toMatch(/no inactive version was pending/);
  });

  it('warns instead of failing when the pending state cannot be verified', async () => {
    await expect(
      resolveActivationOutcome(parseActivationResponse(SILENT_NOOP), 'ZCL_FOO', { requireExecuted: true }, async () => undefined),
    ).resolves.toBeUndefined();
    const warnings = getWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.message).toMatch(/could not verify/);
    expect(warnings[0]!.details).toMatchObject({ pendingInactiveVersion: undefined });
  });

  it('does not warn when the flags report execution', async () => {
    const error = await catchAsyncError(() =>
      resolveActivationOutcome(parseActivationResponse(EXECUTED), 'ZCL_FOO', { requireExecuted: true }, async () => true),
    );
    expect(error).toBeUndefined();
    expect(getWarnings()).toEqual([]);
  });

  it('standalone activate keeps succeeding but records a warning', async () => {
    await expect(
      resolveActivationOutcome(parseActivationResponse(SILENT_NOOP), 'ZCL_FOO'),
    ).resolves.toBeUndefined();
    const warnings = getWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      code: 'ACTIVATION_NOT_EXECUTED',
      details: { object: 'ZCL_FOO', activationExecuted: false },
    });
  });

  it('hard failures still win over the executed flag', async () => {
    const body =
      '<?xml version="1.0" encoding="utf-8"?><chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist">' +
      '<chkl:properties checkExecuted="true" activationExecuted="false" generationExecuted="false"/>' +
      '<msg type="E" line="1"><shortText><txt>Field "GC_X" is unknown.</txt></shortText></msg>' +
      '</chkl:messages>';
    const error = await catchAsyncError(() =>
      resolveActivationOutcome(parseActivationResponse(body), 'ZCL_FOO', { requireExecuted: true }, async () => true),
    );
    expect(error?.code).toBe('ACTIVATION_FAILED');
    expect(error?.message).toContain('Field "GC_X" is unknown.');
    expect(error?.details?.silentNoop).toBeUndefined();
    expect(error?.details?.activationExecuted).toBe(false);
  });

  it('assertActivationExecuted is a no-op once activation ran', () => {
    expect(() => assertActivationExecuted(parseActivationResponse(EXECUTED), 'ZCL_FOO')).not.toThrow();
  });
});
