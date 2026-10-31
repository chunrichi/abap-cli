/**
 * VIEW (DDIC database view) create flow via the ICF `/ddic/view` route.
 *
 * Mirrors `create-ddic.ts` / `create-enqu.ts`: read `--file` → validate
 * against `view-v1.json` + semantic rules → local → wire → POST. The
 * view name is capped at 16 characters (DDIC view object names); that
 * check runs locally so the user gets a clear error instead of a
 * `VIEW_WRITE_REFUSED` from `DDIF_VIEW_PUT`.
 */
import * as path from 'node:path';
import { IcfClient } from '../../clients/icf-client.js';
import { CliError, printResult, type OutputMode } from '../../output/json.js';
import type { ErrorCode } from '../../output/error-codes.js';
import { viewArtifact, VIEW_NAME_MAX_LENGTH, type ViewLocal } from '../../formats/view/json.js';
import { toOutputPath } from '../../core/path-output.js';
import { affObjectToken } from '../../formats/file-resolver.js';
import type { CreateOptions } from './create.js';
import type { CreateHandler } from './routing.js';

export async function runCreateView(
  objectName: string,
  opts: CreateOptions,
  mode: OutputMode,
): Promise<void> {
  const upper = objectName.trim().toUpperCase();
  if (!upper || upper.length > VIEW_NAME_MAX_LENGTH) {
    throw new CliError(
      'VIEW_NAME_INVALID',
      `VIEW name must be 1-${VIEW_NAME_MAX_LENGTH} characters (got "${objectName}")`,
      {
        object: upper,
        type: 'VIEW',
        nextSteps: [`Use a view name of at most ${VIEW_NAME_MAX_LENGTH} characters (DDIC view object limit).`],
        example: `abap create VIEW ZCLI_TC_DEMO --file src/zcli_tc_demo.view.json --package '$TMP' --yes`,
      },
    );
  }

  if (!opts.file) {
    throw new CliError('VALIDATION_ERROR', 'Type VIEW requires --file <path> with a view-v1 JSON', {
      object: upper,
      type: 'VIEW',
      nextSteps: ['See `abap create --schema VIEW` for the contract and a minimal example.'],
      example: `abap create VIEW ${upper} --file src/${affObjectToken(upper)}.view.json --yes`,
    });
  }

  const filePath = path.resolve(process.cwd(), opts.file);
  let local: ViewLocal;
  try {
    local = await viewArtifact.load(filePath);
  } catch (error: unknown) {
    if (error instanceof CliError) throw error;
    throw new CliError('VALIDATION_ERROR', `Cannot read VIEW file: ${error instanceof Error ? error.message : String(error)}`, {
      file: toOutputPath(opts.file),
      type: 'VIEW',
      object: upper,
    });
  }

  if (local.name && local.name.trim().toUpperCase() !== upper) {
    throw new CliError('VIEW_NAME_INVALID', `view name in ${toOutputPath(opts.file)} ("${local.name}") does not match the command argument "${upper}"`, {
      file: toOutputPath(opts.file),
      type: 'VIEW',
      object: upper,
      nextSteps: ['Rename the file / change the JSON `name` field, or pass the matching name to `abap create`.'],
    });
  }

  const targetPackage = (opts.package ?? local.package ?? '$TMP').trim().toUpperCase();
  if (targetPackage !== '$TMP' && !opts.tr) {
    throw new CliError('VALIDATION_ERROR', 'transportRequest is required when package is not $TMP', {
      object: upper,
      type: 'VIEW',
      nextSteps: ['Re-run with --tr <REQUEST>', 'Or use --package $TMP for local objects.'],
      example: `abap create VIEW ${upper} --file ${toOutputPath(opts.file)} --package ${opts.package} --tr <REQUEST> --yes`,
    });
  }

  const wire = viewArtifact.toWire(local);
  wire.name = upper;
  if (opts.description) wire.header = { ...wire.header, description: opts.description };
  wire.package = targetPackage;
  if (opts.tr) wire.transportRequest = opts.tr;

  const icf = await IcfClient.create();
  const resp = await icf.postDdic<{ name: string; type: string; action: 'created' | 'updated' }>('view', wire);
  if (resp.status !== 'success' || !resp.data) {
    const code = (resp.error?.code ?? 'VIEW_WRITE_FAILED') as ErrorCode;
    throw new CliError(code, resp.error?.message ?? `Failed to create VIEW ${upper}`, {
      object: upper,
      type: 'VIEW',
      details: resp.error?.details,
      nextSteps: [
        'Fix the cause above and re-run.',
        'Compare the file with `abap create --schema VIEW` (tables[] must list existing tables, fields[] must exist in them).',
      ],
    });
  }

  printResult(mode,
    {
      object: resp.data.name,
      type: 'VIEW',
      action: resp.data.action,
      file: toOutputPath(opts.file),
    },
    `Created VIEW ${resp.data.name} via ICF ${resp.data.action === 'created' ? '(new)' : '(overwritten)'}`,
  );
}

export const createViewHandler: CreateHandler = async ({ name, opts, mode }) => {
  await runCreateView(name, opts, mode);
};
