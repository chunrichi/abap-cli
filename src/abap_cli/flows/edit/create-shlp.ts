/**
 * SHLP (DDIC database shlp) create flow via the ICF `/ddic/shlp` route.
 *
 * Mirrors `create-ddic.ts` / `create-enqu.ts`: read `--file` → validate
 * against `shlp-v1.json` + semantic rules → local → wire → POST. The
 * shlp name is capped at 16 characters (DDIC shlp object names); that
 * check runs locally so the user gets a clear error instead of a
 * `SHLP_WRITE_REFUSED` from `DDIF_SHLP_PUT`.
 */
import * as path from 'node:path';
import { IcfClient } from '../../clients/icf-client.js';
import { CliError, printResult, type OutputMode } from '../../output/json.js';
import type { ErrorCode } from '../../output/error-codes.js';
import { shlpArtifact, SHLP_NAME_MAX_LENGTH, type ShlpLocal } from '../../formats/shlp/json.js';
import { toOutputPath } from '../../core/path-output.js';
import { affObjectToken } from '../../formats/file-resolver.js';
import type { CreateOptions } from './create.js';
import type { CreateHandler } from './routing.js';

export async function runCreateShlp(
  objectName: string,
  opts: CreateOptions,
  mode: OutputMode,
): Promise<void> {
  const upper = objectName.trim().toUpperCase();
  if (!upper || upper.length > SHLP_NAME_MAX_LENGTH) {
    throw new CliError(
      'SHLP_NAME_INVALID',
      `SHLP name must be 1-${SHLP_NAME_MAX_LENGTH} characters (got "${objectName}")`,
      {
        object: upper,
        type: 'SHLP',
        nextSteps: [`Use a shlp name of at most ${SHLP_NAME_MAX_LENGTH} characters (DDIC shlp object limit).`],
        example: `abap create SHLP ZCLI_TC_DEMO --file src/zcli_tc_demo.shlp.json --package '$TMP' --yes`,
      },
    );
  }

  if (!opts.file) {
    throw new CliError('VALIDATION_ERROR', 'Type SHLP requires --file <path> with a shlp-v1 JSON', {
      object: upper,
      type: 'SHLP',
      nextSteps: ['See `abap create --schema SHLP` for the contract and a minimal example.'],
      example: `abap create SHLP ${upper} --file src/${affObjectToken(upper)}.shlp.json --yes`,
    });
  }

  const filePath = path.resolve(process.cwd(), opts.file);
  let local: ShlpLocal;
  try {
    local = await shlpArtifact.load(filePath);
  } catch (error: unknown) {
    if (error instanceof CliError) throw error;
    throw new CliError('VALIDATION_ERROR', `Cannot read SHLP file: ${error instanceof Error ? error.message : String(error)}`, {
      file: toOutputPath(opts.file),
      type: 'SHLP',
      object: upper,
    });
  }

  if (local.name && local.name.trim().toUpperCase() !== upper) {
    throw new CliError('SHLP_NAME_INVALID', `shlp name in ${toOutputPath(opts.file)} ("${local.name}") does not match the command argument "${upper}"`, {
      file: toOutputPath(opts.file),
      type: 'SHLP',
      object: upper,
      nextSteps: ['Rename the file / change the JSON `name` field, or pass the matching name to `abap create`.'],
    });
  }

  const targetPackage = (opts.package ?? local.package ?? '$TMP').trim().toUpperCase();
  if (targetPackage !== '$TMP' && !opts.tr) {
    throw new CliError('VALIDATION_ERROR', 'transportRequest is required when package is not $TMP', {
      object: upper,
      type: 'SHLP',
      nextSteps: ['Re-run with --tr <REQUEST>', 'Or use --package $TMP for local objects.'],
      example: `abap create SHLP ${upper} --file ${toOutputPath(opts.file)} --package ${opts.package} --tr <REQUEST> --yes`,
    });
  }

  const wire = shlpArtifact.toWire(local);
  wire.name = upper;
  if (opts.description) wire.header = { ...wire.header, description: opts.description };
  wire.package = targetPackage;
  if (opts.tr) wire.transportRequest = opts.tr;

  const icf = await IcfClient.create();
  const resp = await icf.postDdic<{ name: string; type: string; action: 'created' | 'updated' }>('shlp', wire);
  if (resp.status !== 'success' || !resp.data) {
    const code = (resp.error?.code ?? 'SHLP_WRITE_FAILED') as ErrorCode;
    throw new CliError(code, resp.error?.message ?? `Failed to create SHLP ${upper}`, {
      object: upper,
      type: 'SHLP',
      details: resp.error?.details,
      nextSteps: [
        'Fix the cause above and re-run.',
        'Compare the file with `abap create --schema SHLP` (tables[] must list existing tables, fields[] must exist in them).',
      ],
    });
  }

  printResult(mode,
    {
      object: resp.data.name,
      type: 'SHLP',
      action: resp.data.action,
      file: toOutputPath(opts.file),
    },
    `Created SHLP ${resp.data.name} via ICF ${resp.data.action === 'created' ? '(new)' : '(overwritten)'}`,
  );
}

export const createShlpHandler: CreateHandler = async ({ name, opts, mode }) => {
  await runCreateShlp(name, opts, mode);
};
