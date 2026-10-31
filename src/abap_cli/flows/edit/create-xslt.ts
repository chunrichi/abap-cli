/**
 * XSLT (transformation program) create flow.
 *
 * Reads the abap-file-format pair from `--file <name>.xslt.json` + the sibling
 * `<name>.xslt.xml` (both required), validates the metadata against
 * `xslt-v1.json`, and POSTs the ICF `/xslt/<name>` upsert. `--package`
 * defaults to `$TMP`; a transportable package requires `--tr`.
 */
import * as path from 'node:path';
import { IcfClient } from '../../clients/icf-client.js';
import { CliError, printResult, type OutputMode } from '../../output/json.js';
import type { ErrorCode } from '../../output/error-codes.js';
import { localToWire } from '../../formats/xslt/json.js';
import { affObjectToken } from '../../formats/file-resolver.js';
import { readXsltPair, xsltPairPaths } from '../../formats/xslt/companion.js';
import { toOutputPath } from '../../core/path-output.js';
import type { CreateOptions } from './create.js';
import type { CreateHandler } from './routing.js';

export async function runCreateXslt(
  objectName: string,
  opts: CreateOptions,
  mode: OutputMode,
): Promise<void> {
  if (!opts.file) {
    throw new CliError('USAGE', 'Type XSLT requires --file <path> with an abap-file-format JSON', {
      example: `abap create XSLT ${objectName} --file src/${objectName.toLowerCase()}.xslt.json --package $TMP --yes`,
    });
  }
  const paths = xsltPairPaths(opts.file);
  if (!paths.jsonPath.endsWith('.xslt.json')) {
    throw new CliError('INVALID_ARGUMENT', `--file must be the .xslt.json metadata document (got ${toOutputPath(opts.file)})`, {
      file: toOutputPath(opts.file),
      nextSteps: ['Pass <name>.xslt.json; its sibling <name>.xslt.xml is read automatically.'],
    });
  }
  const { local, source } = await readXsltPair(opts.file);

  // AFF ties the object name to the file name: <token>.xslt.json. Reject a
  // mismatch here so `create XSLT FOO --file bar.xslt.json` cannot create an
  // object that the subsequent `pull FOO` writes under a different name.
  const expectedName = `${affObjectToken(objectName)}.xslt.json`.toLowerCase();
  if (path.basename(paths.jsonPath).toLowerCase() !== expectedName) {
    throw new CliError('INVALID_ARGUMENT', `--file name does not match the object name: expected ${expectedName} (got ${path.basename(paths.jsonPath)})`, {
      file: toOutputPath(opts.file),
      object: objectName,
      type: 'XSLT',
      nextSteps: ['Rename the file pair to match the object name (AFF: <name>.xslt.json + <name>.xslt.xml).'],
      example: `abap create XSLT ${objectName} --file src/${affObjectToken(objectName)}.xslt.json --package '$TMP' --yes`,
    });
  }

  const packageName = (opts.package ?? '$TMP').trim().toUpperCase();
  if (packageName !== '$TMP' && !opts.tr) {
    throw new CliError('VALIDATION_ERROR', 'transportRequest is required when package is not $TMP', {
      object: objectName,
      type: 'XSLT',
      nextSteps: ['Re-run with --tr <REQUEST>', 'Or use --package $TMP for local objects.'],
      example: `abap create XSLT ${objectName} --file ${toOutputPath(opts.file)} --package ${opts.package} --tr <REQUEST> --yes`,
    });
  }
  if (opts.description) {
    local.header = { ...local.header, description: opts.description };
  }

  if (opts.checkOnly) {
    printResult(
      mode,
      { object: objectName, type: 'XSLT', checkOnly: true, valid: true, files: [toOutputPath(paths.jsonPath), toOutputPath(paths.xmlPath)] },
      `XSLT ${objectName} pair is valid (no object created).`,
    );
    return;
  }

  const wire = localToWire(local, source, {
    name: objectName,
    package: packageName,
    transportRequest: opts.tr,
  });
  const icf = await IcfClient.create();
  const resp = await icf.postXslt<{ name: string; action: 'created' | 'updated' }>(objectName, wire);
  if (resp.status !== 'success' || !resp.data) {
    const code = (resp.error?.code ?? 'XSLT_CREATE_FAILED') as ErrorCode;
    throw new CliError(code, resp.error?.message ?? `Failed to create XSLT ${objectName}`, {
      object: objectName,
      type: 'XSLT',
      details: resp.error?.details,
      nextSteps: ['Fix the cause above and re-run.'],
    });
  }

  printResult(
    mode,
    {
      object: resp.data.name,
      type: 'XSLT',
      action: resp.data.action,
      package: packageName,
      transport: opts.tr,
      files: [toOutputPath(paths.jsonPath), toOutputPath(paths.xmlPath)],
    },
    `Created XSLT ${resp.data.name} via ICF (${resp.data.action})`,
  );
}

export const createXsltHandler: CreateHandler = async ({ name, opts, mode }) => {
  await runCreateXslt(name, opts, mode);
};
