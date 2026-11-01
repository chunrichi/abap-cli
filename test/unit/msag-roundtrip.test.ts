/**
 * MSAG wire ↔ local round-trip against the real ADT EMF shape.
 *
 * Real GET body (S/4HANA, `/sap/bc/adt/messageclass/<name>`): the header lives
 * in `adtcore` attributes and every message is one `<mc:messages>` element with
 * `mc:msgno` / `mc:msgtext` attributes (element name is plural in the ADT
 * model). Messages may carry `<atom:link>` children for long text / navigation.
 */
import { describe, it, expect } from 'vitest';
import { msagArtifact, wireToLocal, localToWire } from '../../src/abap_cli/formats/msag/json.js';

const EMPTY_XML = `<?xml version="1.0" encoding="utf-8"?><mc:messageClass adtcore:name="ZMY_EMPTY" adtcore:type="MSAG/N" adtcore:description="Empty" adtcore:language="EN" xmlns:mc="http://www.sap.com/adt/MessageClass" xmlns:adtcore="http://www.sap.com/adt/core"/>`;

const ARGS_XML = `<?xml version="1.0" encoding="utf-8"?><mc:messageClass adtcore:responsible="SAP" adtcore:masterLanguage="EN" adtcore:name="SADT_TOOLS_CORE" adtcore:type="MSAG/N" adtcore:description="Messages for package SADT_TOOLS_CORE" adtcore:language="ZH" xmlns:mc="http://www.sap.com/adt/MessageClass" xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:packageRef adtcore:uri="/sap/bc/adt/packages/sadt_tools_core" adtcore:type="DEVC/K" adtcore:name="SADT_TOOLS_CORE"/><mc:messages mc:msgno="001" mc:msgtext="No URI-Mapping defined for URI &amp;1" mc:selfexplainatory="true" mc:documented="false" adtcore:name=""><atom:link href="/sap/bc/adt/messageclass/sadt_tools_core/messages/001" rel="http://www.sap.com/adt/relations/messageclasses/messages" xmlns:atom="http://www.w3.org/2005/Atom"/></mc:messages><mc:messages mc:msgno="002" mc:msgtext="Value &amp;1 &lt; &amp;2" mc:selfexplainatory="false" mc:documented="false" adtcore:name=""/></mc:messageClass>`;

describe('MSAG wire → local', () => {
  it('parses an empty message class from the ADT EMF shape', () => {
    const local = wireToLocal(EMPTY_XML);
    expect(local.messages).toEqual([]);
    expect(local.header.description).toBe('Empty');
    expect(local.header.originalLanguage).toBe('EN');
  });

  it('parses messages with placeholders and entity-escaped text', () => {
    const local = wireToLocal(ARGS_XML);
    expect(local.header.description).toBe('Messages for package SADT_TOOLS_CORE');
    // masterLanguage wins over the logon language.
    expect(local.header.originalLanguage).toBe('EN');
    expect(local.messages).toEqual([
      { number: '001', text: 'No URI-Mapping defined for URI &1' },
      { number: '002', text: 'Value &1 < &2' },
    ]);
  });

  it('falls back to adtcore:language when the master language is not exposed', () => {
    const xml = `<mc:messageClass adtcore:description="d" adtcore:language="ZH" xmlns:mc="http://www.sap.com/adt/MessageClass" xmlns:adtcore="http://www.sap.com/adt/core"/>`;
    expect(wireToLocal(xml).header.originalLanguage).toBe('ZH');
  });
});

describe('MSAG local → wire', () => {
  it('emits the ADT EMF shape the message-class endpoint accepts', () => {
    const wire = localToWire(
      {
        formatVersion: '1',
        header: { description: 'My "class" & more', originalLanguage: 'en' },
        messages: [{ number: '001', text: 'Object &1 <created>' }],
      },
      'zmy_msag',
    );
    expect(wire).toContain('xmlns:mc="http://www.sap.com/adt/MessageClass"');
    expect(wire).toContain('adtcore:name="ZMY_MSAG"');
    expect(wire).toContain('adtcore:type="MSAG/N"');
    expect(wire).toContain('adtcore:description="My &quot;class&quot; &amp; more"');
    expect(wire).toContain('adtcore:language="EN"');
    expect(wire).toContain('<mc:messages mc:msgno="001" mc:msgtext="Object &amp;1 &lt;created&gt;"/>');
    expect(wire).not.toContain('<mc:description>');
  });

  it('round-trips local → wire → local', () => {
    const local = {
      formatVersion: '1' as const,
      header: { description: 'Args', originalLanguage: 'EN' },
      messages: [
        { number: '001', text: 'Invalid input &1' },
        { number: '002', text: 'Object &1 not found in &2' },
      ],
    };
    expect(wireToLocal(localToWire(local, 'ZMY_ARGS'))).toEqual(local);
  });

  it('passes AFF schema validation for a well-formed local doc', async () => {
    const errors = await msagArtifact.validate({
      formatVersion: '1',
      header: { description: 'ok', originalLanguage: 'EN' },
      messages: [{ number: '001', text: 'hi' }],
    });
    expect(errors).toEqual([]);
  });
});
