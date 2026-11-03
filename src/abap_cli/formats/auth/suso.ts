/**
 * SUSO (Authorization object (SU21)) — authorization-family document spec.
 *
 * PLACEHOLDER: the SUSO owner replaces this module with the real AFF-shaped
 * document mapping after the design checkpoint
 * (see `tmp/auth-family/designs/suso.md`). Keep the export names
 * (`susoArtifact`, `susoSpec`) and the `AuthTypeSpec` contract stable — the family flows
 * and the wiring tables import them.
 */
import { defineWireArtifact } from '../artifact.js';
import { affObjectNameFromToken, affObjectToken } from '../file-resolver.js';
import type { AuthTypeSpec } from './spec.js';

/** Local SUSO document (replaced by the real AFF-shaped type). */
export interface SusoLocal {
  formatVersion: '1';
  [key: string]: unknown;
}

export const susoArtifact = defineWireArtifact<SusoLocal, Record<string, unknown>>({
  type: 'SUSO',
  toWire: (local) => local as unknown as Record<string, unknown>,
  fromWire: (wire) => {
    // GET adds read-side `name` / `package` on top of the document; the local
    // file must not carry them.
    const { name: _name, package: _package, ...document } = (wire ?? {}) as Record<string, unknown>;
    return { formatVersion: '1', ...document } as SusoLocal;
  },
});

export const susoSpec: AuthTypeSpec<SusoLocal> = {
  type: 'SUSO',
  route: 'suso',
  tadirObject: 'SUSO',
  schemaFile: 'suso-v1.json',
  description: 'Authorization object (SU21)',
  nameMaxLength: 10,
  artifact: susoArtifact,
  normalizeName: (raw) => raw.trim().toUpperCase(),
  fileToken: (name) => affObjectToken(name),
  nameFromToken: (token, basename) => affObjectNameFromToken(token, basename),
  example: () => ({ formatVersion: '1' }),
};
