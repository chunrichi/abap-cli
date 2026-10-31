/**
 * Activation `*Executed` flags are the difference between "activated" and
 * "SAP answered HTTP 200 but did nothing".
 *
 * Real SAP answers the wrong request shape with a silent no-op: HTTP 200, no
 * message, and `checkExecuted="false" activationExecuted="false"
 * generationExecuted="false"`. The source is written, the active version is
 * unchanged, and a caller that only inspects messages sees success. On a write
 * path (push) that must be a failure; a standalone `abap activate` can hit the
 * same flags for an already-active object, so it warns instead of throwing.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import {
  assertActivationExecuted,
  enforceActivationOutcome,
  parseActivationResponse,
} from '../../src/abap_cli/clients/activation.js';
import { CliError } from '../../src/abap_cli/output/json.js';
import { getWarnings, resetWarnings } from '../../src/abap_cli/output/meta.js';

const SILENT_NOOP =
  '<?xml version="1.0" encoding="utf-8"?><chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist">' +
  '<chkl:properties checkExecuted="false" activationExecuted="false" generationExecuted="false"/></chkl:messages>';

const EXECUTED =
  '<?xml version="1.0" encoding="utf-8"?><chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist">' +
  '<chkl:properties checkExecuted="true" activationExecuted="true" generationExecuted="true"/></chkl:messages>';

function catchError(run: () => void): CliError | undefined {
  try {
    run();
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

  it('fails the push path with ACTIVATION_FAILED and all three executed flags', () => {
    const error = catchError(() =>
      enforceActivationOutcome(parseActivationResponse(SILENT_NOOP), 'ZCL_FOO', { requireExecuted: true }),
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

  it('does not throw when the flags report execution', () => {
    const error = catchError(() =>
      enforceActivationOutcome(parseActivationResponse(EXECUTED), 'ZCL_FOO', { requireExecuted: true }),
    );
    expect(error).toBeUndefined();
    expect(getWarnings()).toEqual([]);
  });

  it('standalone activate keeps succeeding but records a warning', () => {
    expect(() =>
      enforceActivationOutcome(parseActivationResponse(SILENT_NOOP), 'ZCL_FOO'),
    ).not.toThrow();
    const warnings = getWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      code: 'ACTIVATION_NOT_EXECUTED',
      details: { object: 'ZCL_FOO', activationExecuted: false },
    });
  });

  it('hard failures still win over the executed flag', () => {
    const body =
      '<?xml version="1.0" encoding="utf-8"?><chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist">' +
      '<chkl:properties checkExecuted="true" activationExecuted="false" generationExecuted="false"/>' +
      '<msg type="E" line="1"><shortText><txt>Field "GC_X" is unknown.</txt></shortText></msg>' +
      '</chkl:messages>';
    const error = catchError(() =>
      enforceActivationOutcome(parseActivationResponse(body), 'ZCL_FOO', { requireExecuted: true }),
    );
    expect(error?.code).toBe('ACTIVATION_FAILED');
    expect(error?.message).toContain('Field "GC_X" is unknown.');
    expect(error?.details?.silentNoop).toBeUndefined();
    expect(error?.details?.activationExecuted).toBe(false);
  });

  it('assertActivationExecuted is a no-op once activation ran', () => {
    expect(() =>
      assertActivationExecuted(parseActivationResponse(EXECUTED), 'ZCL_FOO'),
    ).not.toThrow();
  });
});
