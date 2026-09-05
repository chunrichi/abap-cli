import { describe, expect, it, vi } from 'vitest';
import { getObjectPartsWithMeta } from '../../src/abap_cli/formats/object-parts.js';

const objectStructure = vi.fn();
const objectStructureElements = vi.fn();

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: {
    create: async () => ({ objectStructure, objectStructureElements }),
  },
}));

/** Minimal stub matching what `client.objectStructure` returns. */
function structure(
  meta: Record<string, unknown>,
  includes?: Array<{ 'class:includeType': string; 'abapsource:sourceUri': string }>,
) {
  return { metaData: meta, ...(includes ? { includes } : {}) };
}

describe('getObjectPartsWithMeta — extended capture (T1.1)', () => {
  it('captures PROG programStatus / fixPointArithmetic / editLocked / authorizationGroup', async () => {
    objectStructure.mockResolvedValueOnce(
      structure({
        'adtcore:description': 'demo prog',
        'adtcore:masterLanguage': 'ZH',
        'adtcore:type': 'PROG/P',
        'adtcore:abapLanguageVersion': 'cloudDevelopment',
        'abapsource:sourceUri': 'source/main',
        'program:programType': 'executableProgram',
        'program:programStatus': 'customerProductionProgram',
        'abapsource:fixPointArithmetic': true,
        'program:lockedByEditor': true,
        'program:startsUsingVariant': false,
        'program:authorizationGroup': 'Z_AUTH',
        'program:application': 'Z_APP',
        'program:logicalDatabase': 'ZDB',
        'program:selectionScreen': '1000',
      }),
    );
    const result = await getObjectPartsWithMeta(
      { objectStructure, objectStructureElements } as never,
      { name: 'ZPROG', objectUrl: '/sap/bc/adt/programs/programs/zprog' },
    );
    expect(result.metadata.programStatus).toBe('customerProductionProgram');
    expect(result.metadata.fixPointArithmetic).toBe(true);
    expect(result.metadata.editLocked).toBe(true);
    expect(result.metadata.startsUsingVariant).toBe(false);
    expect(result.metadata.authorizationGroup).toBe('Z_AUTH');
    expect(result.metadata.application).toBe('Z_APP');
    expect(result.metadata.logicalDatabase).toBe('ZDB');
    expect(result.metadata.selectionScreen).toBe('1000');
  });

  it('captures CLAS category, messageClass and descriptions (types/methods)', async () => {
    objectStructure.mockResolvedValueOnce(
      structure(
        {
          'adtcore:description': 'demo class',
          'adtcore:masterLanguage': 'EN',
          'adtcore:type': 'CLAS/OC',
          'abapsource:sourceUri': 'source/main',
          'class:category': 'generalObjectType',
          'class:messageClass': 'ZCM_MSG',
          'abapsource:fixPointArithmetic': false,
        },
        [
          { 'class:includeType': 'main', 'abapsource:sourceUri': 'source/main' },
          { 'class:includeType': 'definitions', 'abapsource:sourceUri': 'source/definitions' },
          { 'class:includeType': 'implementations', 'abapsource:sourceUri': 'source/implementations' },
        ],
      ),
    );
    objectStructureElements.mockResolvedValueOnce([
      { name: 'T_DATA', type: 'CLAS/DT', description: 'data type' },
      { name: 'MO_HELPER', type: 'CLAS/DA', description: 'helper instance' },
      {
        name: 'DO_SOMETHING',
        type: 'CLAS/ME',
        description: 'does something',
        children: [
          { name: 'IV_INPUT', type: 'CLAS/MP', description: 'input value' },
          { name: 'CX_FAILED', type: 'CLAS/MX', description: 'failed' },
        ],
      },
    ]);

    const result = await getObjectPartsWithMeta(
      { objectStructure, objectStructureElements } as never,
      { name: 'ZCL_DEMO', objectUrl: '/sap/bc/adt/oo/classes/zcl_demo' },
    );
    expect(result.metadata.category).toBe('generalObjectType');
    expect(result.metadata.messageClass).toBe('ZCM_MSG');
    expect(result.metadata.descriptions?.types).toEqual([
      { name: 'T_DATA', description: 'data type' },
    ]);
    expect(result.metadata.descriptions?.attributes).toEqual([
      { name: 'MO_HELPER', description: 'helper instance' },
    ]);
    expect(result.metadata.descriptions?.methods?.[0]).toMatchObject({
      name: 'DO_SOMETHING',
      description: 'does something',
      parameters: [{ name: 'IV_INPUT', description: 'input value' }],
      exceptions: [{ name: 'CX_FAILED', description: 'failed' }],
    });
  });

  it('captures INTF category, proxy and descriptions.attributes', async () => {
    objectStructure.mockResolvedValueOnce(
      structure(
        {
          'adtcore:description': 'badi interface',
          'adtcore:masterLanguage': 'EN',
          'adtcore:type': 'INTF/OI',
          'abapsource:sourceUri': 'source/main',
          'interface:category': 'classicBadi',
          'interface:proxy': true,
        },
        [{ 'class:includeType': 'main', 'abapsource:sourceUri': 'source/main' }],
      ),
    );
    objectStructureElements.mockResolvedValueOnce([
      { name: 'ACTIVE', type: 'INTF/DA', description: 'active flag' },
    ]);

    const result = await getObjectPartsWithMeta(
      { objectStructure, objectStructureElements } as never,
      { name: 'ZIF_BADI', objectUrl: '/sap/bc/adt/oo/interfaces/zif_badi' },
    );
    expect(result.metadata.category).toBe('classicBadi');
    expect(result.metadata.proxy).toBe(true);
    expect(result.metadata.descriptions?.attributes?.[0]).toMatchObject({
      name: 'ACTIVE',
      description: 'active flag',
    });
  });

  it('falls back gracefully when objectStructureElements throws', async () => {
    objectStructure.mockResolvedValueOnce(
      structure(
        {
          'adtcore:description': 'class',
          'adtcore:type': 'CLAS/OC',
          'abapsource:sourceUri': 'source/main',
          'class:category': 'exceptionClass',
        },
        [{ 'class:includeType': 'main', 'abapsource:sourceUri': 'source/main' }],
      ),
    );
    objectStructureElements.mockRejectedValueOnce(new Error('not supported'));

    const result = await getObjectPartsWithMeta(
      { objectStructure, objectStructureElements } as never,
      { name: 'ZCL_X', objectUrl: '/sap/bc/adt/oo/classes/zcl_x' },
    );
    expect(result.metadata.category).toBe('exceptionClass');
    expect(result.metadata.descriptions).toBeUndefined();
  });

  it('falls back gracefully when objectStructureElements is absent (older client)', async () => {
    objectStructure.mockResolvedValueOnce(
      structure(
        {
          'adtcore:description': 'class',
          'adtcore:type': 'CLAS/OC',
          'abapsource:sourceUri': 'source/main',
          'class:category': 'generalObjectType',
        },
        [{ 'class:includeType': 'main', 'abapsource:sourceUri': 'source/main' }],
      ),
    );
    const result = await getObjectPartsWithMeta(
      // Cast through unknown to deliberately strip objectStructureElements.
      { objectStructure } as never,
      { name: 'ZCL_Y', objectUrl: '/sap/bc/adt/oo/classes/zcl_y' },
    );
    expect(result.metadata.category).toBe('generalObjectType');
    expect(result.metadata.descriptions).toBeUndefined();
  });

  it('preserves backward compat — keeps the 5 original fields populated', async () => {
    objectStructure.mockResolvedValueOnce(
      structure({
        'adtcore:description': 'old',
        'adtcore:masterLanguage': 'EN',
        'adtcore:type': 'PROG/P',
        'adtcore:abapLanguageVersion': 'standard',
        'abapsource:sourceUri': 'source/main',
        'program:programType': 'executableProgram',
      }),
    );
    const result = await getObjectPartsWithMeta(
      { objectStructure, objectStructureElements } as never,
      { name: 'ZPROG', objectUrl: '/sap/bc/adt/programs/programs/zprog' },
    );
    expect(result.metadata.description).toBe('old');
    expect(result.metadata.masterLanguage).toBe('EN');
    expect(result.metadata.objectType).toBe('PROG/P');
    expect(result.metadata.abapLanguageVersion).toBe('standard');
    expect(result.metadata.programType).toBe('executableProgram');
  });
});
