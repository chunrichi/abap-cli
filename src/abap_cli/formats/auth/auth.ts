/**
 * AUTH (Authorization field (SU20)) — authorization-family document spec.
 *
 * PLACEHOLDER: the AUTH owner replaces this module with the real AFF-shaped
 * document mapping after the design checkpoint
 * (see `tmp/auth-family/designs/auth.md`). Keep the export names
 * (`authArtifact`, `authSpec`) and the `AuthTypeSpec` contract stable — the family flows
 * and the wiring tables import them.
 */
import { defineWireArtifact } from '../artifact.js';
import { affObjectNameFromToken, affObjectToken } from '../file-resolver.js';
import type { AuthTypeSpec } from './spec.js';

/** Local AUTH document (replaced by the real AFF-shaped type). */
export interface AuthLocal {
  formatVersion: '1';
  [key: string]: unknown;
}

export const authArtifact = defineWireArtifact<AuthLocal, Record<string, unknown>>({
  type: 'AUTH',
  toWire: (local) => local as unknown as Record<string, unknown>,
  fromWire: (wire) => {
    // GET adds read-side `name` / `package` on top of the document; the local
    // file must not carry them.
    const { name: _name, package: _package, ...document } = (wire ?? {}) as Record<string, unknown>;
    return { formatVersion: '1', ...document } as AuthLocal;
  },
});

export const authSpec: AuthTypeSpec<AuthLocal> = {
  type: 'AUTH',
  route: 'auth',
  tadirObject: 'AUTH',
  schemaFile: 'auth-v1.json',
  description: 'Authorization field (SU20)',
  nameMaxLength: 30,
  artifact: authArtifact,
  normalizeName: (raw) => raw.trim().toUpperCase(),
  fileToken: (name) => affObjectToken(name),
  nameFromToken: (token, basename) => affObjectNameFromToken(token, basename),
  example: () => ({ formatVersion: '1' }),
};
