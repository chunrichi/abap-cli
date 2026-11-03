/**
 * Generic AFF bundle plumbing for the `/aff/<TYPE>/<NAME>` ICF channel.
 *
 * The bundled ICF endpoint hands the object to SAP's own AFF framework
 * (`IF_AFF_OBJECT_FILE_HANDLER`), so the endpoint — not the CLI — owns the
 * official file set of an object and its per-type layout. The CLI therefore
 * mirrors the files **verbatim**:
 *
 *   - pull writes every returned file flat into `--dir` (names and contents
 *     exactly as SAP serialized them; AFF names are lowercase,
 *     `<object-token>.<type>[.<sub-object>…].<ext>`);
 *   - create / push aggregate the whole local file group that carries the
 *     `<object-token>.<type-lower>.` prefix and POST/PUT it as one bundle.
 *
 * This module is the single place that knows the local naming rule, discovers
 * a bundle on disk, and validates the object document before it is sent. The
 * wire envelope itself lives with the client (`clients/icf-client.ts`) and the
 * flows (`flows/edit/*-aff.ts`).
 */
import * as fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import * as path from 'node:path';
import { CliError } from '../../output/json.js';
import { validateAff } from '../../aff/schema-validator.js';
import { affObjectToken } from '../file-resolver.js';

/** One AFF file as it travels over the wire (`content` is UTF-8 text). */
export interface AffBundleFile {
  name: string;
  content: string;
}

/** GET `/aff/<TYPE>/<NAME>` response payload (success envelope `data`). */
export interface AffBundle {
  type: string;
  name: string;
  package?: string;
  masterLanguage?: string;
  files: AffBundleFile[];
}

/** POST / PUT `/aff/<TYPE>/<NAME>` request payload. */
export interface AffWriteRequest {
  package?: string;
  transportRequest?: string;
  files: AffBundleFile[];
}

/** POST / PUT response payload (success envelope `data`). */
export interface AffWriteResult {
  type: string;
  name: string;
  package?: string;
  action: 'created' | 'updated';
  activated?: boolean;
  files?: string[];
}

/** DELETE response payload (success envelope `data`). */
export interface AffDeleteResult {
  type: string;
  name: string;
  package?: string;
  action: 'deleted';
}

/**
 * Local AFF filename prefix for an object: `<object-token>.<type-lower>.`.
 * Example: `ZCLI_AFF_ENHS` / `ENHS` → `zcli_aff_enhs.enhs.`.
 */
export function affLocalPrefix(objectName: string, type: string): string {
  return `${affObjectToken(objectName)}.${type.toLowerCase()}.`;
}

/**
 * Local filename of the object's main AFF document. Per the AFF specification
 * the main file is `<object-token>.<type-lower>.json`; multi-file objects add
 * sub-object/content tokens **after** that prefix, so the prefix is the group
 * key and this is the canonical entry point.
 */
export function affMainFileName(objectName: string, type: string): string {
  return `${affLocalPrefix(objectName, type)}json`;
}

/** Whether a bare filename belongs to the object's local AFF bundle. */
export function isAffBundleFileName(fileName: string, objectName: string, type: string): boolean {
  return path.basename(fileName).toLowerCase().startsWith(affLocalPrefix(objectName, type));
}

/**
 * Discover every local file of an object's AFF bundle in `dir`.
 *
 * AFF artifacts are flat (`<dir>/<token>.<type>…`), so discovery is a prefix
 * scan of the directory — there is no manifest and no per-object folder. The
 * main document sorts first so the first bundle entry is always the object
 * document; the rest keep a stable lexical order.
 */
export async function discoverAffBundleFiles(
  dir: string,
  objectName: string,
  type: string,
): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error: unknown) {
    throw new CliError(
      'AFF_FILE_INVALID',
      `Cannot scan ${dir} for the ${type} ${objectName} AFF bundle: ${error instanceof Error ? error.message : String(error)}`,
      { type, object: objectName, dir },
    );
  }
  const prefix = affLocalPrefix(objectName, type);
  const mainName = affMainFileName(objectName, type);
  const names = entries
    .filter((entry) => entry.isFile() && !entry.name.startsWith('.') && entry.name.toLowerCase().startsWith(prefix))
    .map((entry) => entry.name)
    .sort((a, b) => {
      const aMain = a.toLowerCase() === mainName;
      const bMain = b.toLowerCase() === mainName;
      if (aMain !== bMain) return aMain ? -1 : 1;
      return a.localeCompare(b);
    });
  return names.map((name) => path.join(dir, name));
}

/** Whether `files` contain the object's canonical main AFF document. */
export function hasAffMainFile(files: string[], objectName: string, type: string): boolean {
  const mainName = affMainFileName(objectName, type);
  return files.some((file) => path.basename(file).toLowerCase() === mainName);
}

/**
 * Read a local bundle into wire files (basename + verbatim UTF-8 content).
 * Read errors surface as `AFF_FILE_INVALID` with the failing path.
 */
export async function readAffBundle(files: string[]): Promise<AffBundleFile[]> {
  const out: AffBundleFile[] = [];
  for (const file of files) {
    try {
      out.push({ name: path.basename(file), content: await fs.readFile(file, 'utf8') });
    } catch (error: unknown) {
      throw new CliError(
        'AFF_FILE_INVALID',
        `Cannot read AFF file ${path.basename(file)}: ${error instanceof Error ? error.message : String(error)}`,
        { file },
      );
    }
  }
  return out;
}

/** A local bundle that passed discovery + validation. */
export interface LocalAffBundle {
  files: AffBundleFile[];
  /** Absolute path of the canonical main document. */
  mainFile: string;
}

/**
 * Validate an in-memory bundle against the AFF bundle contract.
 *
 * Structure rules: the canonical main document must be present; every `.json`
 * file must parse; the main document must satisfy the type's vendored AFF
 * schema. Companion JSON files are validated only as JSON — their schemas
 * belong to their own sub-object types, and for the single-file types this
 * channel currently serves there are none.
 */
export async function validateAffBundle(
  files: AffBundleFile[],
  objectName: string,
  type: string,
  schemaFile?: string,
): Promise<void> {
  const mainName = affMainFileName(objectName, type);
  const mainEntry = files.find((file) => file.name.toLowerCase() === mainName);
  if (!mainEntry) {
    const found = files.map((file) => file.name).join(', ') || '<none>';
    throw new CliError(
      'AFF_FILE_INVALID',
      `The ${type} ${objectName} AFF bundle has no main document ${mainName} (found: ${found})`,
      {
        type,
        object: objectName,
        expected: mainName,
        nextSteps: [
          `The main document is the AFF definition of the object: <object-token>.${type.toLowerCase()}.json.`,
          `Run \`abap pull ${objectName} --type ${type}\` to regenerate the canonical file set, or create it with the exact name ${mainName}.`,
        ],
      },
    );
  }

  for (const file of files) {
    if (!file.name.toLowerCase().endsWith('.json')) continue;
    let doc: unknown;
    try {
      doc = JSON.parse(file.content);
    } catch (error: unknown) {
      throw new CliError(
        'AFF_FILE_INVALID',
        `AFF file ${file.name} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        { type, object: objectName, file: file.name },
      );
    }
    if (file.name.toLowerCase() !== mainName) continue;
    const result = await validateAff(type, doc, schemaFile);
    if (result.status === 'fail') {
      const errors = result.errors.map((e) => `${e.instancePath || '/'}: ${e.message ?? ''}`);
      throw new CliError(
        'VALIDATION_ERROR',
        `Invalid ${type} AFF document ${file.name}: ${errors.join('; ')}`,
        {
          type,
          object: objectName,
          file: file.name,
          details: errors,
          nextSteps: [
            'Fix the reported fields and re-run.',
            `Run \`abap validate:aff ${file.name}\` for the same schema check.`,
          ],
        },
      );
    }
  }
}

/** Read the object's local bundle from `files` and validate it. */
export async function readValidatedAffBundle(
  files: string[],
  objectName: string,
  type: string,
  schemaFile?: string,
): Promise<LocalAffBundle> {
  const bundle = await readAffBundle(files);
  await validateAffBundle(bundle, objectName, type, schemaFile);
  const mainName = affMainFileName(objectName, type);
  return { files: bundle, mainFile: files.find((file) => path.basename(file).toLowerCase() === mainName)! };
}

/**
 * Parse the canonical main AFF document of a validated bundle.
 * Callers use it for the AFF header (description / originalLanguage).
 */
export function parseAffMainDocument(
  files: AffBundleFile[],
  objectName: string,
  type: string,
): Record<string, unknown> {
  const mainName = affMainFileName(objectName, type);
  const main = files.find((file) => file.name.toLowerCase() === mainName);
  if (!main) {
    throw new CliError('AFF_FILE_INVALID', `The ${type} ${objectName} AFF bundle has no main document ${mainName}`, {
      type,
      object: objectName,
      expected: mainName,
    });
  }
  try {
    const parsed: unknown = JSON.parse(main.content);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** The AFF header fields the CLI reads (description / originalLanguage). */
export interface AffHeaderInfo {
  description?: string;
  originalLanguage?: string;
}

/** Extract `header.description` / `header.originalLanguage` from a document. */
export function affHeaderInfo(doc: Record<string, unknown>): AffHeaderInfo {
  const header = doc.header;
  if (!header || typeof header !== 'object' || Array.isArray(header)) return {};
  const record = header as Record<string, unknown>;
  return {
    ...(typeof record.description === 'string' ? { description: record.description } : {}),
    ...(typeof record.originalLanguage === 'string'
      ? { originalLanguage: record.originalLanguage.toUpperCase() }
      : {}),
  };
}

/**
 * Reject a `--file` that is not the object's canonical main AFF document.
 * The object name and type live in the filename (AFF documents do not repeat
 * them), so a mismatched filename would silently create a different object.
 */
export function assertAffMainFile(file: string, objectName: string, type: string): void {
  const expected = affMainFileName(objectName, type);
  const actual = path.basename(file).toLowerCase();
  if (actual === expected) return;
  throw new CliError(
    'AFF_FILE_INVALID',
    `${path.basename(file)} is not the main AFF document of ${type} ${objectName}; expected ${expected}`,
    {
      type,
      object: objectName,
      file: path.basename(file),
      nextSteps: [
        `The file name carries the AFF object identity: <object-token>.${type.toLowerCase()}.json (lowercase, namespaced names use the (ns)name token).`,
        `Rename the file to ${expected}, or pass the matching name/type to the command.`,
      ],
    },
  );
}

/**
 * Apply a CLI `--description` override to the main AFF document.
 *
 * The description lives at `header.description` in every AFF schema; create
 * overrides it like the DDIC flow does with its wire payload. The returned
 * content is the re-serialized document (2-space JSON, trailing newline), so
 * the bytes that go to SAP are exactly the ones validated locally.
 */
export function applyAffDescription(file: AffBundleFile, description: string): AffBundleFile {
  let doc: unknown;
  try {
    doc = JSON.parse(file.content);
  } catch {
    return file;
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return file;
  const record = doc as Record<string, unknown>;
  const header = record.header;
  if (header && typeof header === 'object' && !Array.isArray(header)) {
    record.header = { ...(header as Record<string, unknown>), description };
  } else {
    record.header = { description };
  }
  return { ...file, content: JSON.stringify(record, null, 2) + '\n' };
}

/** Validate the wire `files` array from a GET response (envelope shape guard). */
export function assertAffBundlePayload(payload: unknown): AffBundle {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new CliError('AFF_READ_FAILED', 'AFF endpoint returned no bundle document', {
      nextSteps: ['Verify the deployed ICF service version (run `abap doctor`).', 'Re-deploy the ICF bundle.'],
    });
  }
  const record = payload as Record<string, unknown>;
  const files = record.files;
  if (!Array.isArray(files) || files.length === 0) {
    throw new CliError('AFF_READ_FAILED', 'AFF endpoint returned an empty file list', {
      type: typeof record.type === 'string' ? record.type : undefined,
      object: typeof record.name === 'string' ? record.name : undefined,
      nextSteps: [
        'Verify the object exists and the type is supported by the release (AFF serialization may be unavailable).',
        'Run `abap doctor` to confirm the deployed ICF service version.',
      ],
    });
  }
  const normalized: AffBundleFile[] = files.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new CliError('AFF_READ_FAILED', `AFF bundle file #${index + 1} is malformed`, {
        details: { entry },
      });
    }
    const file = entry as Record<string, unknown>;
    if (typeof file.name !== 'string' || file.name.trim() === '' || typeof file.content !== 'string') {
      throw new CliError('AFF_READ_FAILED', `AFF bundle file #${index + 1} has no name/content string`, {
        details: { entry },
        nextSteps: ['Verify the deployed ICF service version (run `abap doctor`).'],
      });
    }
    return { name: file.name, content: file.content };
  });
  return {
    type: typeof record.type === 'string' ? record.type.toUpperCase() : '',
    name: typeof record.name === 'string' ? record.name.toUpperCase() : '',
    ...(typeof record.package === 'string' ? { package: record.package.toUpperCase() } : {}),
    ...(typeof record.masterLanguage === 'string' ? { masterLanguage: record.masterLanguage } : {}),
    files: normalized,
  };
}

/**
 * Map a wire file name to a safe basename inside the output directory.
 * The endpoint owns the name; anything carrying a path (absolute, `..`, or a
 * separator) is rejected instead of written outside `--dir`.
 */
export function safeAffOutputName(name: string): string {
  const normalized = name.replace(/\\/g, '/');
  if (!normalized || normalized === '.' || normalized === '..' || normalized.includes('/')) {
    throw new CliError('AFF_READ_FAILED', `AFF endpoint returned an unsafe file name: ${name}`, {
      file: name,
      nextSteps: ['Verify the deployed ICF service version (run `abap doctor`).'],
    });
  }
  return normalized;
}
