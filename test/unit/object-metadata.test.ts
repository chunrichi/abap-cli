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
