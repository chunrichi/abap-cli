/**
 * BDEF (behavior definition) local artifact.
 *
 * AFF `bdef-v1.json` is a thin metadata document (`formatVersion` + `header`,
 * optional `extendedBehaviorDefintion`); the executable body lives in the
 * sibling `<name>.bdef.abdl` file. The create flow therefore reads both files
 * before touching SAP, mirroring DDLS / DCLS / DDLA.
 */
import { defineJsonArtifact } from '../artifact.js';

export interface BdefLocal {
  formatVersion: '1';
  header: {
    description: string;
    originalLanguage: string;
    abapLanguageVersion?: 'standard' | 'keyUser' | 'cloudDevelopment';
  };
  extendedBehaviorDefintion?: { name?: string };
}

/** BDEF AFF artifact: file/schema plumbing only — the source is a sidecar. */
export const bdefArtifact = defineJsonArtifact<BdefLocal>({ type: 'BDEF' });
