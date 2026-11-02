/**
 * SRVB (service binding) local artifact.
 *
 * AFF `srvb-v1.json` is metadata-only: binding type/category plus the service
 * name and the service versions it exposes. There is no source sidecar.
 * Creation is data-driven (`create SRVB --file`); push/update is not
 * implemented because the AFF document is lossy against the ADT binding model
 * (implementation/published/minor/patch versions are not represented).
 */
import { defineJsonArtifact } from '../artifact.js';

export interface SrvbLocal {
  formatVersion: '1';
  header: {
    description: string;
    originalLanguage: string;
    abapLanguageVersion?: 'standard' | 'keyUser' | 'cloudDevelopment';
  };
  /** ADT binding type + version, e.g. `"ODATA V4"`. */
  bindingType: string;
  bindingTypeCategory: 'ui' | 'webApi';
  services: Array<{
    name: string;
    versions: Array<{
      serviceVersion: string;
      serviceBuildVersion?: string;
      serviceDefinition: string;
    }>;
  }>;
}

/** SRVB AFF artifact: file/schema plumbing only; there is no source file. */
export const srvbArtifact = defineJsonArtifact<SrvbLocal>({ type: 'SRVB' });
