/**
 * F-05 / F-08 — activation failure must be diagnosable.
 *
 * F-05: SAP reports activation diagnostics against the *generated* include, so
 * the line numbers do not address the local file (an error at local line 16 was
 * reported as `line 1`). The error must say so instead of presenting the number
 * as a file line.
 *
 * F-08: a failed activation leaves the new source written-but-inactive. The
 * error must say the object was written and point at `inspect --activation`.
 */
import { describe, expect, it } from 'vitest';
import {
  parseActivationResponse,
  throwOnActivationFailure,
  type ActivationResult,
} from '../../src/abap_cli/clients/activation.js';
import { CliError } from '../../src/abap_cli/output/json.js';

function result(messages: ActivationResult['messages'], inactive: string[] = []): ActivationResult {
  return {
    messages,
    success: false,
    inactive,
    checkExecuted: true,
    activationExecuted: true,
    generationExecuted: true,
  };
}

describe('throwOnActivationFailure (F-05 / F-08)', () => {
  it('returns normally when SAP reported no errors', () => {
    expect(() =>
      throwOnActivationFailure(result([{ type: 'W', text: 'just a warning' }]), 'ZCL_X'),
    ).not.toThrow();
  });

  it('parses the accurate position out of the message href (#start=line,col)', () => {
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<chkl:messages xmlns:chkl="http://www.sap.com/adt/checkmessages">
  <msg type="E" line="1" href="/sap/bc/adt/programs/programs/zrep/source/main#start=6,2">
    <shortText><txt>Error in assignment: Expression missing.</txt></shortText>
  </msg>
</chkl:messages>`;
    const parsed = parseActivationResponse(body);
    const msg = parsed.messages[0];
    // SAP's `line` attribute is include-relative; the href carries the truth.
    expect(msg?.line).toBe(1);
    expect(msg?.startLine).toBe(6);
    expect(msg?.startColumn).toBe(2);
    expect(msg?.sourceUri).toBe('/sap/bc/adt/programs/programs/zrep/source/main');
  });

  it('prefers the href position over SAP\'s include-relative line', () => {
    let caught: CliError | undefined;
    try {
      throwOnActivationFailure(
        result([
          {
            type: 'E',
            text: 'Error in assignment: Expression missing.',
            line: 1,
            href: '/sap/bc/adt/programs/programs/zrep/source/main#start=6,2',
            startLine: 6,
            startColumn: 2,
            sourceUri: '/sap/bc/adt/programs/programs/zrep/source/main',
          },
        ]),
        'ZREP',
      );
    } catch (error) {
      caught = error as CliError;
    }
    expect(caught?.message).toContain('line 6');
    expect(caught?.message).not.toContain('line 1:');
    expect(caught?.details?.lineScope).toBe('source-uri');
  });

  it('flags the line scope instead of pretending the number is a local line', () => {
    let caught: CliError | undefined;
    try {
      throwOnActivationFailure(result([{ type: 'E', text: 'Error in assignment: Expression missing.', line: 1 }]), 'ZCL_X');
    } catch (error) {
      caught = error as CliError;
    }
    expect(caught?.code).toBe('ACTIVATION_FAILED');
    expect(caught?.message).toContain('line 1');
    expect(caught?.details?.lineScope).toBe('generated-include');
    expect(caught?.details?.messages).toEqual([
      { type: 'E', text: 'Error in assignment: Expression missing.', line: 1 },
    ]);
  });

  it('reports the half-written state and points at inspect --activation', () => {
    let caught: CliError | undefined;
    try {
      throwOnActivationFailure(result([{ type: 'E', text: 'boom' }]), 'ZCL_X');
    } catch (error) {
      caught = error as CliError;
    }
    expect(caught?.details?.written).toBe(true);
    expect(caught?.details?.activated).toBe(false);
    const steps = (caught?.nextSteps ?? []).join('\n');
    expect(steps).toContain('written to SAP but NOT activated');
    expect(steps).toContain('abap inspect ZCL_X --activation');
    expect(steps).toContain('abap check syntax');
    // The message must not be duplicated by a second wrapper prefix.
    expect(caught?.message.match(/Activation failed for ZCL_X/g)?.length).toBe(1);
  });

  it('falls back to the inactive marker when SAP reported no messages', () => {
    let caught: CliError | undefined;
    try {
      throwOnActivationFailure(result([], ['/sap/bc/adt/oo/classes/zcl_x']), 'ZCL_X');
    } catch (error) {
      caught = error as CliError;
    }
    expect(caught?.message).toContain('object left inactive');
    expect(caught?.details?.inactive).toEqual(['/sap/bc/adt/oo/classes/zcl_x']);
  });
});
