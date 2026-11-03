/**
 * SM59 (HTTP destination) create via the ICF `/sm59/<name>` route.
 *
 * Read `--file` → validate against `sm59-v1.json` + semantic rules → POST.
 * Destinations are client-independent system-table entries (RFCDES): they have
 * no package and no CTS transport path, so `--package` / `--tr` are rejected;
 * there is no activation step, so `--no-activate` is rejected too.
 *
 * `--check-only` validates the document and the destination name locally and
 * prints the plan — it performs no SAP call at all.
 */
import * as path from 'node:path';
import { IcfClient } from '../../clients/icf-client.js';
import { CliError, printResult, type OutputMode } from '../../output/json.js';
import type { ErrorCode } from '../../output/error-codes.js';
import { localToWire, sm59Artifact, type Sm59Local } from '../../formats/sm59/json.js';
import { toOutputPath } from '../../core/path-output.js';
import { affObjectToken } from '../../formats/file-resolver.js';
import type { CreateOptions } from './create.js';
import type { CreateHandler } from './routing.js';
import {
  assertSm59FileNameMatches,
  rejectSm59PackageAndTransport,
  validateSm59Name,
} from './sm59-shared.js';

export async function runCreateSm59(
  objectName: string,
  opts: CreateOptions,
  mode: OutputMode,
): Promise<void> {
  const upper = validateSm59Name(objectName);
  rejectSm59PackageAndTransport({ package: opts.package, tr: opts.tr }, 'create');

  if (opts.activate === false) {
    throw new CliError('VALIDATION_ERROR', 'SM59 destinations have no activation step; --no-activate is not supported', {
      object: upper,
      type: 'SM59',
      nextSteps: ['Drop --no-activate: the destination is in effect as soon as the write succeeds.'],
    });
  }

  if (!opts.file) {
    throw new CliError('USAGE', 'SM59 create requires --file <path> with an sm59-v1 JSON', {
      object: upper,
      type: 'SM59',
      nextSteps: ['See `abap create --schema SM59` for the contract and a minimal example.'],
      example: `abap create SM59 ${upper} --file src/${affObjectToken(upper)}.sm59.json --yes`,
    });
  }

  const filePath = path.resolve(process.cwd(), opts.file);
  if (!filePath.toLowerCase().endsWith('.sm59.json')) {
    throw new CliError('VALIDATION_ERROR', `SM59 document must use the .sm59.json suffix: ${opts.file}`, {
      file: toOutputPath(opts.file),
      type: 'SM59',
      object: upper,
    });
  }
  assertSm59FileNameMatches(upper, filePath, toOutputPath(opts.file));

  let local: Sm59Local;
  try {
    local = await sm59Artifact.load(filePath);
  } catch (error: unknown) {
    if (error instanceof CliError) throw error;
    throw new CliError('FILE_PARSE_ERROR', `Cannot read SM59 file: ${error instanceof Error ? error.message : String(error)}`, {
      file: toOutputPath(opts.file),
      type: 'SM59',
      object: upper,
    });
  }

  // `--description` overrides the document's description (TRAN / HTTP habit);
  // re-validate so an over-long / multi-line override fails locally instead of
  // being truncated silently or rejected by SAP with a generic error.
  if (opts.description !== undefined && opts.description.trim() !== '') {
    local = { ...local, description: opts.description.trim() };
    const overrideErrors = await sm59Artifact.validate(local);
    if (overrideErrors.length > 0) {
      throw new CliError('VALIDATION_ERROR', `Invalid --description for SM59 ${upper}: ${overrideErrors.join('; ')}`, {
        object: upper,
        type: 'SM59',
        file: toOutputPath(opts.file),
        details: overrideErrors,
        nextSteps: [`Use at most 72 characters on a single line (RFCDOC_D).`],
      });
    }
  }

  if (opts.checkOnly) {
    printResult(
      mode,
      {
        object: upper,
        type: 'SM59',
        checkOnly: true,
        valid: true,
        issues: [],
        file: toOutputPath(opts.file),
        plan: { action: 'POST', path: `/sap/abap_cli/sm59/${encodeURIComponent(upper)}`, writes: ['RFCDES', 'RFCDOC'] },
      },
      `SM59 ${upper} document is valid (no destination created).`,
    );
    return;
  }

  const wire = localToWire(local, upper);
  const icf = await IcfClient.create();
  const resp = await icf.postSm59<{ name: string; type: string; action: 'created' | 'updated' }>(upper, wire);
  if (resp.status !== 'success' || !resp.data) {
    throw new CliError((resp.error?.code ?? 'SM59_WRITE_FAILED') as ErrorCode, resp.error?.message ?? `Failed to create SM59 ${upper}`, {
      object: upper,
      type: 'SM59',
      details: resp.error?.details,
      nextSteps: [
        'Fix the cause above and re-run.',
        `Check the document locally with \`abap validate:aff ${toOutputPath(opts.file)}\` (if the file was hand-edited).`,
      ],
      example: `abap create SM59 ${upper} --file src/${affObjectToken(upper)}.sm59.json --yes`,
    });
  }

  const action = resp.data.action === 'updated' ? 'updated' : 'created';
  printResult(
    mode,
    {
      object: resp.data.name ?? upper,
      type: 'SM59',
      action,
      channel: 'icf',
      description: local.description ?? '',
      file: toOutputPath(opts.file),
    },
    `Created SM59 ${resp.data.name ?? upper} via ICF (${action === 'created' ? 'new' : 'overwritten'})`,
  );
}

export const createSm59Handler: CreateHandler = async ({ name, opts, mode }) => {
  await runCreateSm59(name, opts, mode);
};
