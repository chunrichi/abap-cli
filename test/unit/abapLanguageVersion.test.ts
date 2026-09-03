import { describe, it, expect } from 'vitest';
import { renderObjectMetadataJson } from '../../src/abap_cli/formats/object-metadata.js';
import type { ObjectMetadata } from '../../src/abap_cli/formats/object-parts.js';

describe('032 P0: abapLanguageVersion pull', () => {
  it('writes header.abapLanguageVersion when metadata carries it', () => {
    const meta: ObjectMetadata = {
      description: 'Demo class',
      masterLanguage: 'EN',
      objectType: 'CLAS/OC',
      abapLanguageVersion: 'cloudDevelopment',
    };
    const doc = JSON.parse(renderObjectMetadataJson(meta));
    expect(doc.header.abapLanguageVersion).toBe('cloudDevelopment');
  });

  it('omits abapLanguageVersion when metadata is undefined (on-prem default)', () => {
    const meta: ObjectMetadata = {
      description: 'Demo class',
      masterLanguage: 'EN',
      objectType: 'CLAS/OC',
    };
    const doc = JSON.parse(renderObjectMetadataJson(meta));
    expect(doc.header).not.toHaveProperty('abapLanguageVersion');
  });

  it('renders standard fallback when metadata carries "standard"', () => {
    const meta: ObjectMetadata = {
      description: 'Demo program',
      masterLanguage: 'EN',
      objectType: 'PROG/P',
      programType: 'executableProgram',
      abapLanguageVersion: 'standard',
    };
    const doc = JSON.parse(renderObjectMetadataJson(meta));
    expect(doc.header.abapLanguageVersion).toBe('standard');
  });
});
