/**
 * SUSH (Authorization default assignment (SU22)) — authorization-family document spec.
 *
 * PLACEHOLDER: the SUSH owner replaces this module with the real AFF-shaped
 * document mapping after the design checkpoint
 * (see `tmp/auth-family/designs/sush.md`). Keep the export names
 * (`sushArtifact`, `sushSpec`) and the `AuthTypeSpec` contract stable — the family flows
 * and the wiring tables import them.
 */
import { defineWireArtifact } from '../artifact.js';
import { affObjectNameFromToken, affObjectToken } from '../file-resolver.js';
import type { AuthTypeSpec } from './spec.js';

/** Local SUSH document (replaced by the real AFF-shaped type). */
export interface SushLocal {
  formatVersion: '1';
  [key: string]: unknown;
}

export const sushArtifact = defineWireArtifact<SushLocal, Record<string, unknown>>({
  type: 'SUSH',
  toWire: (local) => local as unknown as Record<string, unknown>,
  fromWire: (wire) => {
    // GET adds read-side `name` / `package` on top of the document; the local
    // file must not carry them.
    const { name: _name, package: _package, ...document } = (wire ?? {}) as Record<string, unknown>;
    return { formatVersion: '1', ...document } as SushLocal;
  },
});

export const sushSpec: AuthTypeSpec<SushLocal> = {
  type: 'SUSH',
  route: 'sush',
  tadirObject: 'SUSH',
  schemaFile: 'sush-v1.json',
  description: 'Authorization default assignment (SU22)',
  nameMaxLength: 32,
  artifact: sushArtifact,
  normalizeName: (raw) => raw.trim().toUpperCase(),
  fileToken: (name) => affObjectToken(name),
  nameFromToken: (token, basename) => affObjectNameFromToken(token, basename),
  example: () => ({ formatVersion: '1' }),
};
