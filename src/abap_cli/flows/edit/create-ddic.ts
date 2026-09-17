/**
 * DDIC (TABL / STRU / DOMA / DTEL) create flow.
 *
 * Reads the abap-file-format JSON from `--file`, validates it, converts to wire
 * schema, and POSTs /ddic/<type>. Command-line --description overrides the file's
 * description. Other required fields (package, transport for non-$TMP) are validated
 * client-side before the round-trip.
 *
 * For TABL/STRU, the file `--file` is the *abap-file-format* main JSON
 * (`<name>.tabl.json` / `<name>.stru.json`). When the same directory also has
 * the sibling `<name>.tabl.ddic` (DDL source of truth) and optionally
 * `<name>.tabl.settings.json`, those sidecars are read together and merged
 * into the wire payload — i.e. we honor the full abap-file-format three-piece
 * layout. When only the main JSON is present we fall back to the legacy
 * wire-flat single-file shape (top-level name/description/fields) for
 * backwards compatibility.
 */
import * as path from 'node:path';
import { IcfClient } from '../../clients/icf-client.js';
import { CliError, printResult, type OutputMode } from '../../output/json.js';
import type { ErrorCode } from '../../output/error-codes.js';
import {
  readDdicObjectForCreate,
  localToWire,
  validateDdicObject,
  getDdicFlatJsonExample,
  type DdicSupportedType,
} from '../../formats/ddic/json.js';
import { toOutputPath } from '../../core/path-output.js';
import type { CreateOptions } from './create.js';
import { registerCreateHandler, DDIC_TYPES, type CreateHandler } from '../../types/registry.js';

export async function runCreateDdic(
  type: DdicSupportedType,
  objectName: string,
  opts: CreateOptions,
  mode: OutputMode,
): Promise<void> {
  const filePath = path.resolve(process.cwd(), opts.file ?? '');
  let local;
  try {
    local = await readDdicObjectForCreate(filePath, type);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const outFile = toOutputPath(opts.file);
    if (error instanceof CliError) throw error;
    const isTablDdlError = (type === 'TABL' || type === 'STRU')
      && (message.includes('Table and Structure DDL') || message.includes('Incomplete Table and Structure'));
    const code: ErrorCode = isTablDdlError ? 'TABL_DDL_INVALID' : 'INVALID_ARGUMENT';
    const nextSteps = isTablDdlError
      ? [
        'Inspect the .tabl.ddic / .stru.ddic sidecar: it must start with `define table|structure <name> {` and end with `}`.',
        'See the abap-file-format schema (tabl-v1.json / tabt-v1.json) for the supported DDL syntax.',
      ]
      : [
        'Verify the file exists and is valid JSON.',
        'For TABL/STRU, see the abap-file-format three-piece layout (`.tabl.json` + `.tabl.ddic` + `.tabl.settings.json`).',
      ];
    throw new CliError(code, `Cannot read DDIC file ${outFile}: ${message}`, {
      file: outFile,
      type,
      object: objectName,
      nextSteps,
    });
  }

  const errors = validateDdicObject(local, type);
  if (errors.length > 0) {
    const outFile = toOutputPath(opts.file);
    const example = getDdicFlatJsonExample(type);
    throw new CliError('VALIDATION_ERROR', `Invalid ${type} definition in ${outFile}: ${errors.join('; ')}`, {
      file: outFile,
      type,
      object: objectName,
      details: errors,
      nextSteps: [
        'Fix the errors above and re-run.',
        `Run \`abap create ${type} --schema\` for the per-type contract, or check the assets/tabl-templates/schemas/ JSON Schemas in the repo.`,
      ],
      example: `${example}\n# expected top-level fields: name, description, fields[]; description may also live under header.description`,
    });
  }

  const targetPackage = (opts.package ?? '$TMP').trim().toUpperCase();
  if (targetPackage !== '$TMP' && !opts.tr) {
    throw new CliError('VALIDATION_ERROR', 'transportRequest is required when package is not $TMP', {
      nextSteps: ['Re-run with --tr <REQUEST>', 'Or use --package $TMP for local objects.'],
      example: `abap create ${type} ${objectName} --file ${toOutputPath(opts.file)} --package ${opts.package} --tr <REQUEST> --description "..."`,
    });
  }

  const wire = localToWire(type, local);
  if (opts.description) wire.description = opts.description;
  if (opts.package) wire.package = opts.package;
  if (opts.tr) wire.transportRequest = opts.tr;

  const icf = await IcfClient.create();
  const resp = await icf.postDdic<{ name: string; type: string; action: 'created' | 'updated' }>(type.toLowerCase(), wire);
  if (resp.status !== 'success' || !resp.data) {
    const code = (resp.error?.code ?? 'DDIC_CREATE_FAILED') as ErrorCode;
    throw new CliError(code, resp.error?.message ?? `Failed to create ${type} ${objectName}`, {
      object: objectName,
      type,
      details: resp.error?.details,
      nextSteps: [
        'Verify the file conforms to the abap-file-format JSON schema.',
        'Re-run after fixing the cause above.',
      ],
    });
  }

  printResult(mode,
    {
      object: resp.data.name,
      type,
      action: resp.data.action,
      file: toOutputPath(opts.file),
    },
    `Created ${type} ${resp.data.name} via ICF ${resp.data.action === 'created' ? '(new)' : '(overwritten)'}`,
  );
}

// Module-load side effect: register all 4 DDIC types. Decision 2A.
// The dispatcher already enforces `requiresFile` for these types; the
// `--file` guard below is the defensive copy for direct callers.
const ddicHandler: CreateHandler = async ({ type, name, opts, mode }) => {
  await runCreateDdic(type as DdicSupportedType, name, opts as CreateOptions, mode);
};
for (const t of DDIC_TYPES) registerCreateHandler(t, ddicHandler);
