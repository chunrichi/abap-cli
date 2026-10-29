import { describe, expect, it } from 'vitest';
import { renderObjectMetadataJson } from '../../src/abap_cli/formats/object-metadata.js';
import type { ObjectMetadata } from '../../src/abap_cli/formats/object-parts.js';

function programTypeOf(meta: ObjectMetadata): string | undefined {
  return JSON.parse(renderObjectMetadataJson(meta)).generalInformation?.programType;
}

describe('renderObjectMetadataJson programType', () => {
  it('passes the enum through when the server already returns it (real SAP)', () => {
    expect(programTypeOf({ programType: 'executableProgram', objectType: 'PROG/P' })).toBe('executableProgram');
    expect(programTypeOf({ programType: 'modulePool' })).toBe('modulePool');
    expect(programTypeOf({ programType: 'subroutinePool' })).toBe('subroutinePool');
  });

  it('maps raw ADT values 1/M/S/I (mock-style)', () => {
    expect(programTypeOf({ programType: '1' })).toBe('executableProgram');
    expect(programTypeOf({ programType: 'M' })).toBe('modulePool');
    expect(programTypeOf({ programType: 'S' })).toBe('subroutinePool');
    expect(programTypeOf({ programType: 'I' })).toBe('include');
  });

  it('infers include from PROG/I when the attribute is missing (real SAP includes)', () => {
    expect(programTypeOf({ objectType: 'PROG/I' })).toBe('include');
  });

  it('omits generalInformation for non-PROG objects and unknown types', () => {
    expect(programTypeOf({})).toBeUndefined();
    expect(programTypeOf({ objectType: 'CLAS/OC' })).toBeUndefined();
    expect(programTypeOf({ programType: 'X' })).toBeUndefined();
  });
});

describe('renderObjectMetadataJson — PROG extended fields (T1.2)', () => {
  it('emits all generalInformation fields when set', () => {
    const json = JSON.parse(
      renderObjectMetadataJson({
        objectType: 'PROG/P',
        programType: 'executableProgram',
        programStatus: 'customerProductionProgram',
        fixPointArithmetic: true,
        editLocked: false,
        startsUsingVariant: true,
        authorizationGroup: 'Z_AUTH',
        application: 'Z_APP',
      }),
    );
    expect(json.generalInformation).toMatchObject({
      programType: 'executableProgram',
      programStatus: 'customerProductionProgram',
      fixPointArithmetic: true,
      editLocked: false,
      startsUsingVariant: true,
      authorizationGroup: 'Z_AUTH',
      application: 'Z_APP',
    });
  });

  it('emits logicalDatabase as a nested object when set', () => {
    const json = JSON.parse(
      renderObjectMetadataJson({
        objectType: 'PROG/P',
        logicalDatabase: 'ZDB',
        selectionScreen: '1000',
      }),
    );
    expect(json.logicalDatabase).toEqual({ name: 'ZDB', selectionScreen: '1000' });
  });

  it('omits logicalDatabase when neither field is set', () => {
    const json = JSON.parse(
      renderObjectMetadataJson({ objectType: 'PROG/P', programType: 'executableProgram' }),
    );
    expect(json.logicalDatabase).toBeUndefined();
  });

  it('translates raw programStatus letters (S/C/X/T) to enums', () => {
    expect(
      JSON.parse(
        renderObjectMetadataJson({
          objectType: 'PROG/P',
          programType: 'executableProgram',
          programStatus: 'S',
        }),
      ).generalInformation.programStatus,
    ).toBe('sapProductionProgram');
    expect(
      JSON.parse(
        renderObjectMetadataJson({
          objectType: 'PROG/P',
          programType: 'executableProgram',
          programStatus: 'X',
        }),
      ).generalInformation.programStatus,
    ).toBe('systemProgram');
  });

  it('does NOT emit abapLanguageVersion for PROG (CLAS/INTF only — T1.2 spec change)', () => {
    const json = JSON.parse(
      renderObjectMetadataJson({
        objectType: 'PROG/P',
        programType: 'executableProgram',
        abapLanguageVersion: 'cloudDevelopment',
      }),
    );
    expect(json.header.abapLanguageVersion).toBeUndefined();
  });
});

describe('renderObjectMetadataJson — CLAS branch (T1.2)', () => {
  it('renders category (16 enum values) verbatim', () => {
    const categories = [
      'generalObjectType',
      'exitClass',
      'testclassAbapUnit',
      'behaviorClass',
      'entityEventHandler',
      'persistentClass',
      'factoryForPersistentClass',
      'statusClassForPersistClass',
      'rfcProxyClass',
      'communicationConnectionClass',
      'exceptionClass',
      'areaClassSharedObjects',
      'businessClass',
      'bspApplicationClass',
      'basisClassBspElementHdlr',
      'webDynproRuntimeObject',
    ];
    for (const cat of categories) {
      const json = JSON.parse(
        renderObjectMetadataJson({ objectType: 'CLAS/OC', category: cat }),
      );
      expect(json.category).toBe(cat);
    }
  });

  it('translates SAP category code "00" to generalObjectType', () => {
    const json = JSON.parse(
      renderObjectMetadataJson({ objectType: 'CLAS/OC', category: '00' }),
    );
    expect(json.category).toBe('generalObjectType');
  });

  it('renders CLAS descriptions full tree (types / methods w/ parameters)', () => {
    const json = JSON.parse(
      renderObjectMetadataJson({
        objectType: 'CLAS/OC',
        category: 'generalObjectType',
        descriptions: {
          types: [{ name: 't_data', description: 'data type' }],
          attributes: [{ name: 'mo_helper', description: 'helper instance' }],
          methods: [
            {
              name: 'do_something',
              description: 'does something',
              parameters: [{ name: 'iv_input', description: 'input value' }],
              exceptions: [{ name: 'cx_failed', description: 'failed' }],
            },
          ],
        },
      }),
    );
    expect(json.descriptions.types[0].name).toBe('t_data');
    expect(json.descriptions.methods[0].parameters[0].name).toBe('iv_input');
    expect(json.descriptions.methods[0].exceptions[0].name).toBe('cx_failed');
  });

  it('skips undefined / empty fields gracefully', () => {
    const json = JSON.parse(
      renderObjectMetadataJson({
        objectType: 'CLAS/OC',
        fixPointArithmetic: undefined,
        messageClass: '',
      }),
    );
    expect(json.fixPointArithmetic).toBeUndefined();
    expect(json.messageClass).toBeUndefined();
  });
});

describe('renderObjectMetadataJson — INTF branch (T1.2)', () => {
  it('renders category (7 enum values) verbatim', () => {
    const categories = [
      'general',
      'classicBadi',
      'businessStaticComponents',
      'businessInstanceComponents',
      'dbProcedureProxy',
      'webDynproRuntime',
      'enterpriseService',
    ];
    for (const cat of categories) {
      const json = JSON.parse(
        renderObjectMetadataJson({ objectType: 'INTF/OI', category: cat }),
      );
      expect(json.category).toBe(cat);
    }
  });

  it('translates SAP category code "00" to general', () => {
    const json = JSON.parse(
      renderObjectMetadataJson({ objectType: 'INTF/OI', category: '00' }),
    );
    expect(json.category).toBe('general');
  });

  it('renders proxy flag', () => {
    const json = JSON.parse(
      renderObjectMetadataJson({ objectType: 'INTF/OI', proxy: true }),
    );
    expect(json.proxy).toBe(true);
  });

  it('emits abapLanguageVersion for INTF', () => {
    const json = JSON.parse(
      renderObjectMetadataJson({
        objectType: 'INTF/OI',
        abapLanguageVersion: 'cloudDevelopment',
      }),
    );
    expect(json.header.abapLanguageVersion).toBe('cloudDevelopment');
  });
});
