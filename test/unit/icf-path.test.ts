/**
 * Tests for the ICF path centralization.
 *
 * The `/sap/zabap_vibe` URL prefix has been renamed to `/sap/abap_cli`. The
 * change is centralized in `clients/icf-version.ts#ICF_BASE_PATH` so every
 * client-side surface (IcfClient, probe, deploy, runtime-probe) shares the
 * same constant. These tests guard against accidental regressions.
 */
import { describe, expect, it } from 'vitest';
import { ICF_BASE_PATH, ICF_SERVICE_VERSION } from '../../src/abap_cli/clients/icf-version.js';

describe('ICF_BASE_PATH centralization', () => {
  it('is /sap/abap_cli', () => {
    expect(ICF_BASE_PATH).toBe('/sap/abap_cli');
  });

  it('version constant remains at 0.6.0 (path-only rename)', () => {
    expect(ICF_SERVICE_VERSION).toBe('0.6.0');
  });
});
