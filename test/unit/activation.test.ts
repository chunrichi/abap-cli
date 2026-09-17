import { describe, expect, it } from 'vitest';
import {
  buildActivationRequest,
  parseActivationResponse,
  throwOnActivationFailure,
} from '../../src/abap_cli/clients/activation.js';

/**
 * Regression cover for the activation request shape and response parsing.
 *
 * The request-shape assertions encode a real-SAP finding (vhcala4hci): sending
 * `adtcore:type` / `adtcore:parentUri` on the object reference makes
 * /sap/bc/adt/activation answer HTTP 200 with every `*Executed` flag false and
 * no message — a silent no-op that leaves sources written-but-inactive.
 */
describe('buildActivationRequest', () => {
  it('emits only uri + name on each object reference', () => {
    const body = buildActivationRequest([{ uri: '/sap/bc/adt/oo/classes/zcl_foo', name: 'ZCL_FOO' }]);
    expect(body).toContain('adtcore:uri="/sap/bc/adt/oo/classes/zcl_foo"');
    expect(body).toContain('adtcore:name="ZCL_FOO"');
    expect(body).not.toContain('adtcore:type');
    expect(body).not.toContain('adtcore:parentUri');
  });

  it('renders one reference per item', () => {
    const body = buildActivationRequest([
      { uri: '/sap/bc/adt/oo/classes/zcl_foo', name: 'ZCL_FOO' },
      { uri: '/sap/bc/adt/oo/classes/zcl_foo#method', name: 'ZCL_FOO' },
    ]);
    expect(body.match(/adtcore:objectReference /g)).toHaveLength(2);
  });

  it('escapes XML-special characters in names and uris', () => {
    const body = buildActivationRequest([{ uri: '/a&b', name: 'Z<X>"Y"' }]);
    expect(body).toContain('adtcore:uri="/a&amp;b"');
    expect(body).toContain('adtcore:name="Z&lt;X&gt;&quot;Y&quot;"');
  });
});

describe('parseActivationResponse', () => {
  it('reads the silent no-op shape (all flags false, no messages)', () => {
    const body =
      '<?xml version="1.0" encoding="utf-8"?><chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist">' +
      '<chkl:properties checkExecuted="false" activationExecuted="false" generationExecuted="false"/></chkl:messages>';
    const result = parseActivationResponse(body);
    expect(result.checkExecuted).toBe(false);
    expect(result.activationExecuted).toBe(false);
    expect(result.generationExecuted).toBe(false);
    expect(result.messages).toEqual([]);
    expect(result.success).toBe(true);
  });

  it('reads a successful activation', () => {
    const body =
      '<?xml version="1.0" encoding="utf-8"?><chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist">' +
      '<chkl:properties checkExecuted="true" activationExecuted="true" generationExecuted="true"/></chkl:messages>';
    const result = parseActivationResponse(body);
    expect(result.activationExecuted).toBe(true);
    expect(result.success).toBe(true);
  });

  it('collects error messages with their source line and text', () => {
    // Trimmed copy of a real response captured while the split class still had
    // missing constants in lcl_data.
    const body =
      '<?xml version="1.0" encoding="utf-8"?><chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist">' +
      '<chkl:properties checkExecuted="true" activationExecuted="false" generationExecuted="false"/>' +
      '<msg objDescr="" type="W" line="0" href=""><shortText><txt>Activation was cancelled.</txt><txt>"Editing canceled" (EU 202)</txt></shortText></msg>' +
      '<msg objDescr="Class ZCL_ABAP_VIBE_ICF" type="E" line="1" href="/sap/bc/adt/oo/classes/zcl_abap_vibe_icf/includes/implementations#start=32,4">' +
      '<shortText><txt>Field "GC_QUERY_LIMIT_MAX" is unknown.</txt></shortText></msg>' +
      '</chkl:messages>';
    const result = parseActivationResponse(body);
    expect(result.activationExecuted).toBe(false);
    expect(result.success).toBe(false);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[1]).toMatchObject({
      type: 'E',
      line: 1,
      text: 'Field "GC_QUERY_LIMIT_MAX" is unknown.',
    });
    expect(result.messages[0].text).toBe('Activation was cancelled. "Editing canceled" (EU 202)');
  });

  it('reports objects SAP left inactive', () => {
    const body =
      '<?xml version="1.0" encoding="utf-8"?><chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist">' +
      '<chkl:properties checkExecuted="true" activationExecuted="true" generationExecuted="true"/></chkl:messages>' +
      '<ioc:inactiveObjects xmlns:ioc="http://www.sap.com/adt/checklist"><ioc:entry>' +
      '<ioc:object><ioc:ref adtcore:uri="/sap/bc/adt/oo/classes/zcl_foo" xmlns:adtcore="http://www.sap.com/adt/core"/></ioc:object>' +
      '</ioc:entry></ioc:inactiveObjects>';
    const result = parseActivationResponse(body);
    expect(result.inactive).toEqual(['/sap/bc/adt/oo/classes/zcl_foo']);
    expect(result.success).toBe(false);
  });

  it('treats an unparseable body as an empty result rather than throwing', () => {
    const result = parseActivationResponse('500 Session Timed Out');
    expect(result.messages).toEqual([]);
    expect(result.success).toBe(true);
  });
});

describe('throwOnActivationFailure', () => {
  const base = {
    messages: [],
    success: true,
    inactive: [],
    checkExecuted: true,
    activationExecuted: true,
    generationExecuted: true,
  };

  it('does not throw when SAP reported no errors', () => {
    expect(() => throwOnActivationFailure(base, 'ZCL_FOO')).not.toThrow();
  });

  it('does not throw for warnings only', () => {
    expect(() =>
      throwOnActivationFailure(
        { ...base, messages: [{ type: 'W', text: 'The regex standard POSIX is deprecated' }] },
        'ZCL_FOO',
      ),
    ).not.toThrow();
  });

  it('throws with the SAP message text and line when activation failed', () => {
    expect(() =>
      throwOnActivationFailure(
        {
          ...base,
          success: false,
          activationExecuted: false,
          messages: [{ type: 'E', text: 'Field "GC_X" is unknown.', line: 32 }],
        },
        'ZCL_FOO',
      ),
    ).toThrow(/line 32: Field "GC_X" is unknown\./);
  });

  it('throws when SAP still lists the object as inactive', () => {
    expect(() =>
      throwOnActivationFailure({ ...base, success: false, inactive: ['/sap/bc/adt/oo/classes/zcl_foo'] }, 'ZCL_FOO'),
    ).toThrow(/object left inactive/);
  });
});
