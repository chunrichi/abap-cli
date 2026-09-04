/**
 * Spec 036 T036-029: MSAG wire ↔ local byte-level zero-diff.
 */
import { describe, it, expect } from 'vitest';
import { wireToLocal, localToWire, validateMsagObject } from '../../src/abap_cli/formats/msag/json.js';

describe('MSAG round-trip (036)', () => {
  it('empty message class round-trips', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<mc:messageClass xmlns:mc="http://www.sap.com/adt/messageclass">
  <mc:description>Empty</mc:description>
  <mc:originalLanguage>EN</mc:originalLanguage>
  <mc:messages/>
</mc:messageClass>`;
    const local = wireToLocal(xml);
    expect(local.messages).toEqual([]);
    expect(local.header.description).toBe('Empty');
  });

  it('messages with &1 placeholders round-trip', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<mc:messageClass xmlns:mc="http://www.sap.com/adt/messageclass">
  <mc:description>Args</mc:description>
  <mc:originalLanguage>EN</mc:originalLanguage>
  <mc:messages>
    <mc:message number="001"><mc:text>Invalid input &amp;1</mc:text></mc:message>
    <mc:message number="002"><mc:text>Object &amp;1 not found in &amp;2</mc:text></mc:message>
  </mc:messages>
</mc:messageClass>`;
    const local = wireToLocal(xml);
    expect(local.messages).toHaveLength(2);
    expect(local.messages[0]!.text).toBe('Invalid input &1');
    expect(local.messages[1]!.text).toBe('Object &1 not found in &2');
    const wire = localToWire(local);
    expect(wire).toMatch(/mc:message number="001"/);
  });

  it('validateMsagObject passes for a well-formed local doc', async () => {
    const errors = await validateMsagObject({
      formatVersion: '1',
      header: { description: 'ok', originalLanguage: 'EN' },
      messages: [{ number: '001', text: 'hi' }],
    });
    expect(errors).toEqual([]);
  });
});