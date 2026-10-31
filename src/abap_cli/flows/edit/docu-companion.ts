/**
 * DOMA/DTEL long-text companion plumbing shared by `abap pull` / `abap push`.
 *
 * The companion file is 0..1 and optional: DOMA/DTEL objects without a long
 * text have no `<name>.<type>.docu.json`, and its absence is never an error.
 * It is only validated when it exists (AFF `docu-v1.json`), and `lines: []`
 * deletes the SAP-side long text.
 *
 * Pull contract:
 *   - remote text exists  → write the companion (document validated first)
 *   - `DOCU_NOT_FOUND`    → keep the main object file; default: leave any stale
 *                           local companion alone; `--overwrite`: delete it with
 *                           a `DOCU_LOCAL_STALE_REMOVED` warning
 *   - any other failure   → `DOCU_PULL_FAILED` warning; the main object pull
 *                           still succeeds (an old ICF deployment without the
 *                           docu route must not break ordinary pulls)
 *
 * Push contract:
 *   - companion validated before the main object is written (a broken docu
 *     document must not leave a half-pushed object on SAP)
 *   - companion POSTed only after the main object POST succeeded
 *   - `lines: []` → the server deletes the long text (`action: 'deleted'`)
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { IcfClient } from '../../clients/icf-client.js';
import { CliError } from '../../output/json.js';
import { collectWarning } from '../../output/meta.js';
import { toRelativeOutputPath } from '../../core/path-output.js';
import {
  DOCU_FORMAT_VERSION,
  docuArtifact,
  docuCompanionPathFor,
  docuDocumentFromWire,
  isDocuSupportedType,
  type DocuDocument,
  type DocuSupportedType,
} from '../../formats/docu/json.js';

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Envelope codes an ICF deployment without the docu route answers with. They
 * mean "no documentation route / object" rather than a failed pull, so the
 * main object pull stays warning-free on older deployments.
 */
const DOCU_ROUTE_ABSENT_CODES = new Set(['DDIC_OBJECT_NOT_FOUND', 'NOT_FOUND', 'METHOD_NOT_ALLOWED']);

/** Absolute path of `<name>.<type>.docu.json` next to a main object document. */
function companionOf(mainFile: string): string | undefined {
  return docuCompanionPathFor(path.resolve(process.cwd(), mainFile));
}

/** Outcome of the pull-side documentation step. */
export interface PulledDocuCompanion {
  /** cwd-relative companion path written this run. */
  written?: string;
  /** cwd-relative stale companion removed this run (`--overwrite` only). */
  deleted?: string;
}

/**
 * Pull the long text for a DOMA/DTEL object. Never throws: documentation is a
 * best-effort companion, so every failure degrades to a structured warning and
 * the main object file stays as pulled.
 */
export async function pullDocuCompanion(args: {
  icf: IcfClient;
  objectName: string;
  type: DocuSupportedType;
  /** Main object document path as it was written (absolute). */
  mainFile: string;
  /** `--overwrite` was given — stale local companions may be cleaned up. */
  overwrite?: boolean;
}): Promise<PulledDocuCompanion> {
  const { icf, objectName, type, mainFile, overwrite } = args;
  const companion = docuCompanionPathFor(mainFile);
  if (!companion) return {};

  const removeStale = async (): Promise<PulledDocuCompanion> => {
    if (!overwrite || !(await fileExists(companion))) return {};
    try {
      await fs.unlink(companion);
      const out = toRelativeOutputPath(companion);
      collectWarning(
        'DOCU_LOCAL_STALE_REMOVED',
        `${type} ${objectName} has no documentation on SAP; removed the stale local companion ${out}`,
        { object: objectName, type, file: out },
      );
      return { deleted: out };
    } catch (error: unknown) {
      collectWarning(
        'DOCU_PULL_FAILED',
        `${type} ${objectName} has no documentation on SAP, but the stale local companion ${toRelativeOutputPath(companion)} could not be removed: ${errorMessage(error)}`,
        { object: objectName, type },
      );
      return {};
    }
  };

  let resp;
  try {
    resp = await icf.getDdicDocu<Record<string, unknown>>(type.toLowerCase() as 'doma' | 'dtel', objectName);
  } catch (error: unknown) {
    collectWarning(
      'DOCU_PULL_FAILED',
      `${type} ${objectName} long text could not be pulled: ${errorMessage(error)}. The main object file was written; re-run \`abap pull ${objectName} --type ${type} --overwrite\` after fixing the cause.`,
      { object: objectName, type },
    );
    return {};
  }

  if (resp.status !== 'success' || !resp.data) {
    if (resp.error?.code === 'DOCU_NOT_FOUND') return removeStale();
    // Older ICF deployments predate the docu route: `/ddic/<type>/<name>/docu`
    // falls through to the DDIC object lookup, which answers *_OBJECT_NOT_FOUND
    // (or NOT_FOUND / METHOD_NOT_ALLOWED at the front controller). That is
    // "no documentation available on this deployment", not a pull failure —
    // skipping keeps ordinary `abap pull DOMA/DTEL` warning-free until the
    // refreshed ICF bundle is deployed.
    if (DOCU_ROUTE_ABSENT_CODES.has(resp.error?.code ?? '')) return {};
    collectWarning(
      'DOCU_PULL_FAILED',
      `${type} ${objectName} long text could not be pulled: ${resp.error?.message ?? 'unknown ICF error'}${resp.error?.code ? ` (${resp.error.code})` : ''}. The main object file was written; re-run \`abap pull ${objectName} --type ${type} --overwrite\` after fixing the cause.`,
      { object: objectName, type, code: resp.error?.code },
    );
    return {};
  }

  const document = docuDocumentFromWire(resp.data);
  // A success envelope without lines means "no long text" on the SAP side.
  if (!document) return removeStale();

  let errors: string[];
  try {
    errors = await docuArtifact.validate(document);
  } catch (error: unknown) {
    collectWarning(
      'DOCU_PULL_FAILED',
      `${type} ${objectName} long text could not be validated against docu-v1.json: ${errorMessage(error)}`,
      { object: objectName, type },
    );
    return {};
  }
  if (errors.length > 0) {
    collectWarning(
      'DOCU_PULL_INVALID',
      `${type} ${objectName} long text from SAP does not satisfy docu-v1.json and was not written: ${errors.join('; ')}`,
      { object: objectName, type, details: errors },
    );
    return {};
  }

  try {
    await fs.mkdir(path.dirname(companion), { recursive: true });
    await docuArtifact.write(companion, document);
  } catch (error: unknown) {
    collectWarning(
      'DOCU_PULL_FAILED',
      `${type} ${objectName} long text was read from SAP but the local companion could not be written: ${errorMessage(error)}`,
      { object: objectName, type, file: toRelativeOutputPath(companion) },
    );
    return {};
  }
  return { written: toRelativeOutputPath(companion) };
}

/** A validated local companion ready to be POSTed after the main object. */
export interface DocuPushPlan {
  /** cwd-relative path of the companion file (for output / errors). */
  file: string;
  /** Validated AFF document with `lines` normalized (missing → []). */
  document: DocuDocument;
  /** `saved` for non-empty lines, `deleted` for `lines: []`. */
  action: 'saved' | 'deleted';
}

/**
 * Read + validate the companion of a DOMA/DTEL main document, if any.
 * Returns undefined when the object type cannot own documentation or the
 * companion file does not exist. Throws `AFF_FIXTURE_INVALID` when the file
 * exists but does not satisfy `docu-v1.json`.
 */
export async function readDocuCompanion(
  mainFile: string,
  type: string | undefined,
): Promise<DocuPushPlan | undefined> {
  if (!isDocuSupportedType(type)) return undefined;
  const companion = companionOf(mainFile);
  if (!companion || !(await fileExists(companion))) return undefined;

  const outFile = toRelativeOutputPath(companion);
  let raw: unknown;
  try {
    raw = await docuArtifact.read(companion);
  } catch (error: unknown) {
    throw new CliError(
      'INVALID_ARGUMENT',
      `Cannot read documentation companion ${outFile}: ${errorMessage(error)}`,
      {
        file: outFile,
        type: 'DOCU',
        nextSteps: ['Fix the JSON syntax, or delete the companion to push the object without long-text changes.'],
      },
    );
  }
  const errors = await docuArtifact.validate(raw);
  if (errors.length > 0) {
    throw new CliError(
      'AFF_FIXTURE_INVALID',
      `Documentation companion ${outFile} is not a valid docu-v1 document: ${errors.join('; ')}`,
      {
        file: outFile,
        type: 'DOCU',
        details: errors,
        nextSteps: [
          'Fix the companion: formatVersion "1", lines[] entries with format (≤2 chars) and line (≤72 chars).',
          'Or delete the companion file to push the main object without long-text changes.',
        ],
      },
    );
  }
  const doc = raw as DocuDocument;
  const lines = Array.isArray(doc.lines) ? doc.lines : [];
  return {
    file: outFile,
    document: {
      formatVersion: doc.formatVersion ?? DOCU_FORMAT_VERSION,
      lines,
    },
    action: lines.length > 0 ? 'saved' : 'deleted',
  };
}

/**
 * POST a readDocuCompanion() plan to `/ddic/<type>/<name>/docu`.
 * `lines: []` makes the server delete the long text.
 */
export async function pushDocuCompanion(
  icf: IcfClient,
  type: DocuSupportedType,
  objectName: string,
  plan: DocuPushPlan,
): Promise<'saved' | 'deleted'> {
  const resp = await icf.postDdicDocu(type.toLowerCase() as 'doma' | 'dtel', objectName, plan.document);
  if (resp.status === 'success' && resp.data) return plan.action;
  const serverMessage = resp.error?.message ?? 'unknown ICF error';
  throw new CliError(
    'DOCU_PUSH_FAILED',
    `Failed to push ${type} ${objectName} long text from ${plan.file}: ${serverMessage}`,
    {
      object: objectName,
      type,
      file: plan.file,
      // The main object POST already succeeded; surface that through the same
      // `details.written` contract the push aggregate uses for activation
      // failures (`written: true`, `activated: false`).
      details: { written: true, serverCode: resp.error?.code, serverDetails: resp.error?.details },
      nextSteps: [
        'The main object was written; only its documentation companion failed.',
        `Fix the cause and re-run \`abap push ${plan.file.replace(/\.docu\.json$/, '.json')}\`.`,
      ],
    },
  );
}

/** True when a DOMA/DTEL main document has a local companion (dry-run planning). */
export async function hasDocuCompanion(mainFile: string, type: string | undefined): Promise<boolean> {
  if (!isDocuSupportedType(type)) return false;
  const companion = companionOf(mainFile);
  return companion !== undefined && fileExists(companion);
}

/** `--atomic` phase: read + validate the companion without posting it. */
export async function validateDocuCompanion(mainFile: string, type: string | undefined): Promise<void> {
  await readDocuCompanion(mainFile, type);
}

/** Re-export so callers do not import two format modules. */
export { DOCU_TYPES, isDocuSupportedType, type DocuSupportedType } from '../../formats/docu/json.js';
