/**
 * Shared contract for abap-file-format JSON artifacts (`.json` side of the
 * local ↔ wire mapping).
 *
 * Every `formats/<type>/json.ts` module used to repeat the same four
 * functions — read the JSON, write it with a trailing newline, validate it
 * against the vendored AFF schema, and load+throw. The wire mapping differs per
 * type (XML envelope, JSON document, asymmetric CDS source), so that part stays
 * in the module; this contract only owns the file/schema plumbing.
 *
 * `defineJsonArtifact` covers artifacts without a symmetric wire mapping
 * (DDLS carries the source in a sibling `.acds` file); `defineWireArtifact`
 * additionally wires `toWire` / `fromWire`.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { CliError } from '../output/json.js';
import { validateAff } from '../aff/schema-validator.js';

export interface JsonArtifact<TLocal> {
  /** Registry type code used for the AFF schema lookup and error details. */
  readonly type: string;
  read(filePath: string): Promise<TLocal>;
  write(filePath: string, doc: TLocal): Promise<void>;
  /** Schema errors, rendered as `<path>: <message>`; empty when valid. */
  validate(doc: unknown): Promise<string[]>;
  /** read + validate; throws `AFF_FIXTURE_INVALID` on schema errors. */
  load(filePath: string): Promise<TLocal>;
}

export interface WireArtifact<TLocal, TWire> extends JsonArtifact<TLocal> {
  toWire(local: TLocal): TWire;
  fromWire(wire: TWire): TLocal;
}

async function readJson<TLocal>(filePath: string): Promise<TLocal> {
  return JSON.parse(await fs.readFile(filePath, 'utf8')) as TLocal;
}

async function writeJson<TLocal>(filePath: string, doc: TLocal): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(doc, null, 2) + '\n', 'utf8');
}

async function validateAgainstSchema(type: string, doc: unknown): Promise<string[]> {
  const result = await validateAff(type, doc);
  if (result.status === 'pass' || result.status === 'warn') return [];
  return result.errors.map((e) => `${e.instancePath || '/'}: ${e.message ?? ''}`);
}

function invalidArtifactError(type: string, filePath: string, errors: string[]): CliError {
  return new CliError('AFF_FIXTURE_INVALID', `${type} file ${filePath} failed schema validation: ${errors.join('; ')}`, {
    file: filePath,
    details: errors,
  });
}

/** File/schema plumbing for an AFF JSON artifact. */
export function defineJsonArtifact<TLocal>(type: string): JsonArtifact<TLocal> {
  return {
    type,
    read: (filePath) => readJson<TLocal>(filePath),
    write: (filePath, doc) => writeJson(filePath, doc),
    validate: (doc) => validateAgainstSchema(type, doc),
    load: async (filePath) => {
      const doc = await readJson<TLocal>(filePath);
      const errors = await validateAgainstSchema(type, doc);
      if (errors.length > 0) throw invalidArtifactError(type, filePath, errors);
      return doc;
    },
  };
}

/** File/schema plumbing plus a symmetric wire mapping. */
export function defineWireArtifact<TLocal, TWire>(spec: {
  type: string;
  toWire: (local: TLocal) => TWire;
  fromWire: (wire: TWire) => TLocal;
}): WireArtifact<TLocal, TWire> {
  return {
    ...defineJsonArtifact<TLocal>(spec.type),
    toWire: spec.toWire,
    fromWire: spec.fromWire,
  };
}
