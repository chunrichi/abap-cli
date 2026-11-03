/**
 * SUCU (Authorization group (TBRG_AUTH)) — authorization-family document spec.
 *
 * PLACEHOLDER: the SUCU owner replaces this module with the real AFF-shaped
 * document mapping after the design checkpoint
 * (see `tmp/auth-family/designs/sucu.md`). Keep the export names
 * (`sucuArtifact`, `sucuSpec`) and the `AuthTypeSpec` contract stable — the family flows
 * and the wiring tables import them.
 */
import { defineWireArtifact } from '../artifact.js';
import { affObjectNameFromToken, affObjectToken } from '../file-resolver.js';
import type { AuthTypeSpec } from './spec.js';

/** Local SUCU document (replaced by the real AFF-shaped type). */
export interface SucuLocal {
  formatVersion: '1';
  [key: string]: unknown;
}

export const sucuArtifact = defineWireArtifact<SucuLocal, Record<string, unknown>>({
  type: 'SUCU',
  toWire: (local) => local as unknown as Record<string, unknown>,
  fromWire: (wire) => {
    // GET adds read-side `name` / `package` on top of the document; the local
    // file must not carry them.
    const { name: _name, package: _package, ...document } = (wire ?? {}) as Record<string, unknown>;
    return { formatVersion: '1', ...document } as SucuLocal;
  },
});

export const sucuSpec: AuthTypeSpec<SucuLocal> = {
  type: 'SUCU',
  route: 'sucu',
  tadirObject: 'SUCU',
  schemaFile: 'sucu-v1.json',
  description: 'Authorization group (TBRG_AUTH)',
  nameMaxLength: 40,
  artifact: sucuArtifact,
  normalizeName: (raw) => raw.trim().toUpperCase(),
  fileToken: (name) => affObjectToken(name),
  nameFromToken: (token, basename) => affObjectNameFromToken(token, basename),
  example: () => ({ formatVersion: '1' }),
};
