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
 *
 * Two optional hooks keep per-type behaviour without forking the contract:
 * `beforeWrite` gates the write (HTTP/TRAN validate the AFF core after
 * stripping the CLI envelope), `validate` overrides the schema check used by
 * `validate()` and `load()`.
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

export interface ArtifactSpec<TLocal> {
  /** Registry type code used for the AFF schema lookup and error details. */
  type: string;
  /**
   * Hook that runs before the document is written; throw to abort the write.
   * Used by types whose file layout needs validation the vendored schema does
   * not express on its own (e.g. HTTP/TRAN strip the CLI envelope first).
   */
  beforeWrite?: (doc: TLocal) => void | Promise<void>;
  /**
   * Validation override; defaults to the vendored AFF schema for `type`.
   * Both `load` and `validate` go through it.
   */
  validate?: (doc: unknown) => string[] | Promise<string[]>;
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
export function defineJsonArtifact<TLocal>(spec: ArtifactSpec<TLocal>): JsonArtifact<TLocal> {
  const { type, beforeWrite } = spec;
  const validateDoc = spec.validate ?? ((doc: unknown) => validateAgainstSchema(type, doc));
  return {
    type,
    read: (filePath) => readJson<TLocal>(filePath),
    write: async (filePath, doc) => {
      await beforeWrite?.(doc);
      await writeJson(filePath, doc);
    },
    validate: async (doc) => validateDoc(doc),
    load: async (filePath) => {
      const doc = await readJson<TLocal>(filePath);
      const errors = await validateDoc(doc);
      if (errors.length > 0) throw invalidArtifactError(type, filePath, errors);
      return doc;
    },
  };
}

/** File/schema plumbing plus a symmetric wire mapping. */
export function defineWireArtifact<TLocal, TWire>(
  spec: ArtifactSpec<TLocal> & {
    toWire: (local: TLocal) => TWire;
    fromWire: (wire: TWire) => TLocal;
  },
): WireArtifact<TLocal, TWire> {
  return {
    ...defineJsonArtifact<TLocal>(spec),
    toWire: spec.toWire,
    fromWire: spec.fromWire,
  };
}
