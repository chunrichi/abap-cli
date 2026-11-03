/**
 * SUSC (Authorization object class (SU21)) — authorization-family document spec.
 *
 * PLACEHOLDER: the SUSC owner replaces this module with the real AFF-shaped
 * document mapping after the design checkpoint
 * (see `tmp/auth-family/designs/susc.md`). Keep the export names
 * (`suscArtifact`, `suscSpec`) and the `AuthTypeSpec` contract stable — the family flows
 * and the wiring tables import them.
 */
import { defineWireArtifact } from '../artifact.js';
import { affObjectNameFromToken, affObjectToken } from '../file-resolver.js';
import type { AuthTypeSpec } from './spec.js';

/** Local SUSC document (replaced by the real AFF-shaped type). */
export interface SuscLocal {
  formatVersion: '1';
  [key: string]: unknown;
}

export const suscArtifact = defineWireArtifact<SuscLocal, Record<string, unknown>>({
  type: 'SUSC',
  toWire: (local) => local as unknown as Record<string, unknown>,
  fromWire: (wire) => {
    // GET adds read-side `name` / `package` on top of the document; the local
    // file must not carry them.
    const { name: _name, package: _package, ...document } = (wire ?? {}) as Record<string, unknown>;
    return { formatVersion: '1', ...document } as SuscLocal;
  },
});

export const suscSpec: AuthTypeSpec<SuscLocal> = {
  type: 'SUSC',
  route: 'susc',
  tadirObject: 'SUSC',
  schemaFile: 'susc-v1.json',
  description: 'Authorization object class (SU21)',
  nameMaxLength: 4,
  artifact: suscArtifact,
  normalizeName: (raw) => raw.trim().toUpperCase(),
  fileToken: (name) => affObjectToken(name),
  nameFromToken: (token, basename) => affObjectNameFromToken(token, basename),
  example: () => ({ formatVersion: '1' }),
};
