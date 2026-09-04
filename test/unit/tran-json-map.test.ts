/**
 * Transaction (SE93) JSON helpers — local↔wire conversion, validation, namespace.
 * Mirrors ddic-json-map.test.ts and http-json-map.test.ts but for the TRAN object type.
 */
import { describe, expect, it } from 'vitest';
import {
  localToWire,
  wireToLocal,
  validateTranObject,
  type TranObjectLocal,
  type TranWirePayload,
} from '../../src/abap_cli/formats/transport/json.js';

describe('TRAN JSON helpers', () => {
  describe('localToWire', () => {
    it('maps the abap-file-format nested shape to nested wire (037 S07)', () => {
      const local: TranObjectLocal = {
        name: 'ztran_test',
        formatVersion: '1',
        header: { description: 'Sample transaction', originalLanguage: 'en', abapLanguageVersion: 'standard' },
        generalInformation: {
          transactionType: 'parameterTransaction',
          lockStatus: 'notLocked',
          parameterTransaction: {
            parParentTransactionCode: 'SE16',
            skipInitialScreenMode: 'skip',
            parameterValues: [{ parameterName: 'DATABROWSE-TABLENAME', parameterValue: 'TSTC' }],
          },
        },
      };
      const wire = localToWire(local);
      expect(wire).toMatchObject({
        name: 'ZTRAN_TEST',
        formatVersion: '1',
        header: {
          description: 'Sample transaction',
          originalLanguage: 'en',
          abapLanguageVersion: 'standard',
        },
        generalInformation: {
          transactionType: 'parameterTransaction',
          lockStatus: 'notLocked',
          parameterTransaction: {
            parParentTransactionCode: 'SE16',
            skipInitialScreenMode: 'skip',
            parameterValues: [{ parameterName: 'DATABROWSE-TABLENAME', parameterValue: 'TSTC' }],
          },
        },
      });
    });

    it('uppercases the name', () => {
      const local: TranObjectLocal = {
        name: 'ztran_lower',
        formatVersion: '1',
        header: { description: 'd', originalLanguage: 'EN' },
        generalInformation: { transactionType: 'dialogTransaction' },
      };
      expect(localToWire(local).name).toBe('ZTRAN_LOWER');
    });
  });

  describe('wireToLocal', () => {
    it('produces the abap-file-format nested shape from nested wire', () => {
      const wire: TranWirePayload = {
        name: 'ZTRAN_TEST',
        formatVersion: '1',
        header: { description: 'Sample transaction', originalLanguage: 'EN' },
        generalInformation: {
          transactionType: 'dialogTransaction',
          dialogTransaction: { programName: 'SAPMZTST', programDynnr: '0100', stvMaintenanceMode: 'notAllowed' },
        },
        userInterface: {
          uiAttributes: {
            uiClassification: 'professionalUserTransaction',
            webguiMode: 'supported',
            platinMode: 'supported',
            win32Mode: 'supported',
          },
        },
      };
      const local = wireToLocal(wire);
      expect(local.name).toBe('ZTRAN_TEST');
      expect(local.formatVersion).toBe('1');
      expect(local.header.description).toBe('Sample transaction');
      expect(local.generalInformation.transactionType).toBe('dialogTransaction');
      expect(local.generalInformation.dialogTransaction).toEqual(wire.generalInformation?.dialogTransaction);
      expect(local.userInterface?.uiAttributes?.uiClassification).toBe('professionalUserTransaction');
    });

    it('omits empty wire fields from the local shape', () => {
      const wire: TranWirePayload = {
        name: 'ZTRAN',
        formatVersion: '1',
        generalInformation: { transactionType: 'reportTransaction' },
      };
      const local = wireToLocal(wire);
      expect(local.header.description).toBe('');
      expect(local.header.originalLanguage).toBe('');
      expect(local.header.abapLanguageVersion).toBeUndefined();
      expect(local.transactionServices).toBeUndefined();
      expect(local.authorizations).toBeUndefined();
    });
  });

  describe('validateTranObject', () => {
    const validDialog: TranObjectLocal = {
      name: 'ZTRAN_TEST',
      formatVersion: '1',
      header: { description: 'Sample', originalLanguage: 'en' },
      generalInformation: {
        transactionType: 'dialogTransaction',
        dialogTransaction: { programName: 'SAPMZTST', programDynnr: '0100', stvMaintenanceMode: 'notAllowed' },
      },
    };

    it('passes a valid dialog transaction', () => {
      expect(validateTranObject(validDialog)).toEqual([]);
    });

    it('passes a valid parameter transaction', () => {
      const local: TranObjectLocal = {
        name: 'ZTRAN_PARAM',
        formatVersion: '1',
        header: { description: 'P', originalLanguage: 'EN' },
        generalInformation: {
          transactionType: 'parameterTransaction',
          parameterTransaction: { parParentTransactionCode: 'SE16' },
        },
      };
      expect(validateTranObject(local)).toEqual([]);
    });

    it('passes a valid OO transaction (class + method required)', () => {
      const local: TranObjectLocal = {
        name: 'ZTRAN_OO',
        formatVersion: '1',
        header: { description: 'OO', originalLanguage: 'EN' },
        generalInformation: {
          transactionType: 'ooTransaction',
          ooTransaction: { className: 'ZCL_TEST', methodName: 'RUN' },
        },
      };
      expect(validateTranObject(local)).toEqual([]);
    });

    it('passes a valid report transaction (sub-object optional)', () => {
      const local: TranObjectLocal = {
        name: 'ZTRAN_REP',
        formatVersion: '1',
        header: { description: 'R', originalLanguage: 'EN' },
        generalInformation: { transactionType: 'reportTransaction' },
      };
      expect(validateTranObject(local)).toEqual([]);
    });

    it('passes a valid variant transaction (parent required)', () => {
      const local: TranObjectLocal = {
        name: 'ZTRAN_VAR',
        formatVersion: '1',
        header: { description: 'V', originalLanguage: 'EN' },
        generalInformation: {
          transactionType: 'variantTransaction',
          variantTransaction: { varParentTransactionCode: 'SE38' },
        },
      };
      expect(validateTranObject(local)).toEqual([]);
    });

    it('rejects missing name', () => {
      const local: TranObjectLocal = {
        formatVersion: '1',
        header: { description: 'd', originalLanguage: 'EN' },
        generalInformation: { transactionType: 'dialogTransaction' },
      };
      expect(validateTranObject(local)).toContain('Missing required field: name');
    });

    it('rejects invalid namespace (non-Z/Y/slash)', () => {
      const local: TranObjectLocal = {
        name: 'XTRAN',
        formatVersion: '1',
        header: { description: 'd', originalLanguage: 'EN' },
        generalInformation: { transactionType: 'dialogTransaction' },
      };
      expect(validateTranObject(local).some((e) => e.includes('Invalid namespace'))).toBe(true);
    });

    it('rejects name over 20 characters', () => {
      const local: TranObjectLocal = {
        name: 'Z' + 'A'.repeat(20),
        formatVersion: '1',
        header: { description: 'd', originalLanguage: 'EN' },
        generalInformation: { transactionType: 'dialogTransaction' },
      };
      expect(validateTranObject(local).some((e) => e.includes('name too long'))).toBe(true);
    });

    it('rejects missing description / originalLanguage', () => {
      const local: TranObjectLocal = {
        name: 'ZTRAN_TEST',
        formatVersion: '1',
        header: { description: '', originalLanguage: '' },
        generalInformation: { transactionType: 'dialogTransaction' },
      };
      const errors = validateTranObject(local);
      expect(errors.some((e) => e.includes('header.description'))).toBe(true);
      expect(errors.some((e) => e.includes('header.originalLanguage'))).toBe(true);
    });

    it('rejects description over 80 characters', () => {
      const local: TranObjectLocal = {
        name: 'ZTRAN_TEST',
        formatVersion: '1',
        header: { description: 'd'.repeat(81), originalLanguage: 'EN' },
        generalInformation: { transactionType: 'dialogTransaction' },
      };
      expect(validateTranObject(local).some((e) => e.includes('header.description too long'))).toBe(true);
    });

    it('rejects invalid abapLanguageVersion', () => {
      const local: TranObjectLocal = {
        name: 'ZTRAN_TEST',
        formatVersion: '1',
        header: { description: 'd', originalLanguage: 'EN', abapLanguageVersion: 'nonsense' },
        generalInformation: { transactionType: 'dialogTransaction' },
      };
      expect(validateTranObject(local).some((e) => e.includes('Invalid abapLanguageVersion')) ||
             validateTranObject(local).some((e) => e.includes('abapLanguageVersion must be'))).toBe(true);
    });

    it('rejects unknown transactionType', () => {
      const local = {
        name: 'ZTRAN_TEST',
        formatVersion: '1' as const,
        header: { description: 'd', originalLanguage: 'EN' },
        generalInformation: { transactionType: 'unknownType' },
      };
      expect(validateTranObject(local).some((e) => e.includes('transactionType'))).toBe(true);
    });

    it('rejects OO transaction missing className', () => {
      const local: TranObjectLocal = {
        name: 'ZTRAN_OO',
        formatVersion: '1',
        header: { description: 'OO', originalLanguage: 'EN' },
        generalInformation: { transactionType: 'ooTransaction', ooTransaction: { methodName: 'RUN' } },
      };
      expect(validateTranObject(local).some((e) => e.includes('ooTransaction.className'))).toBe(true);
    });

    it('rejects OO transaction missing methodName', () => {
      const local: TranObjectLocal = {
        name: 'ZTRAN_OO',
        formatVersion: '1',
        header: { description: 'OO', originalLanguage: 'EN' },
        generalInformation: { transactionType: 'ooTransaction', ooTransaction: { className: 'ZCL_TEST' } },
      };
      expect(validateTranObject(local).some((e) => e.includes('ooTransaction.methodName'))).toBe(true);
    });

    it('rejects parameter transaction missing parent code', () => {
      const local: TranObjectLocal = {
        name: 'ZTRAN_PARAM',
        formatVersion: '1',
        header: { description: 'P', originalLanguage: 'EN' },
        generalInformation: { transactionType: 'parameterTransaction', parameterTransaction: {} },
      };
      expect(validateTranObject(local).some((e) => e.includes('parParentTransactionCode'))).toBe(true);
    });

    it('rejects className over 30 characters', () => {
      const local: TranObjectLocal = {
        name: 'ZTRAN_OO',
        formatVersion: '1',
        header: { description: 'OO', originalLanguage: 'EN' },
        generalInformation: {
          transactionType: 'ooTransaction',
          ooTransaction: { className: 'Z' + 'A'.repeat(30), methodName: 'RUN' },
        },
      };
      expect(validateTranObject(local).some((e) => e.includes('ooTransaction.className too long'))).toBe(true);
    });

    it('rejects methodName over 61 characters', () => {
      const local: TranObjectLocal = {
        name: 'ZTRAN_OO',
        formatVersion: '1',
        header: { description: 'OO', originalLanguage: 'EN' },
        generalInformation: {
          transactionType: 'ooTransaction',
          ooTransaction: { className: 'ZCL_TEST', methodName: 'M' + 'A'.repeat(61) },
        },
      };
      expect(validateTranObject(local).some((e) => e.includes('ooTransaction.methodName too long'))).toBe(true);
    });

    it('rejects non-numeric programDynnr for dialog', () => {
      const local: TranObjectLocal = {
        name: 'ZTRAN_TEST',
        formatVersion: '1',
        header: { description: 'd', originalLanguage: 'EN' },
        generalInformation: {
          transactionType: 'dialogTransaction',
          dialogTransaction: { programName: 'SAPMZTST', programDynnr: 'ABCD' },
        },
      };
      expect(validateTranObject(local).some((e) => e.includes('programDynnr'))).toBe(true);
    });
  });
});
