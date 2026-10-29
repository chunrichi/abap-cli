/**
 * SRVD (service definition) create flow.
 *
 * Reads the `--file` (abap-file-format `.srvd.json`) for layout validation only
 * (the actual DDL source is the companion `.srvd.acds`, written by `abap push`).
 * Registers metadata via ADT typed `createObject({objtype: 'SRVD/SRV', …})`.
 *
 * Mirrors the CDS-extension create flow in `create-cds-extension.ts`: create
 * owns metadata only; source content lands later via the standard
 * source-object push path (`pushSourceObjectOne`).
 */
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { CliError, printResult, type OutputMode } from '../../output/json.js';
import { resolveTransport } from '../../core/transport.js';
import { resolveObject } from '../../core/resolve.js';
import { toOutputPath } from '../../core/path-output.js';
import type { CreateOptions } from './create.js';
import { registerCreateHandler, type CreateHandler } from '../../types/registry.js';

/** Companion source sidecar path: `<file-without-.json>.acds`. */
function sidecarPath(jsonPath: string): string {
  return jsonPath.replace(/\.json$/, '') + '.acds';
}

async function runCreateSrvd(
  name: string,
  opts: CreateOptions,
  mode: OutputMode,
): Promise<void> {
  if (!opts.file) {
    throw new CliError(
      'USAGE',
      'Type SRVD requires --file <path> with an abap-file-format JSON',
      {
        example: `abap create SRVD ${name} --file src/${name.toLowerCase()}/${name.toLowerCase()}.srvd.json --package $TMP --description "..." --yes`,
      },
    );
  }
  const sourceFile = sidecarPath(opts.file);
  if (!sidecarExists(opts.file, sourceFile)) {
    throw new CliError(
      'VALIDATION_ERROR',
      `SRVD companion source file missing: ${sourceFile}`,
      {
        file: sourceFile,
        nextSteps: ['Both files must be supplied on create — write the `.acds` next to the JSON.'],
      },
    );
  }
  const client = await AdtClientWrapper.create();
  const transport = await resolveTransport(
    client,
    opts.tr,
    client.getConfig().transport,
    { transportOptional: (opts.package ?? '$TMP').trim().toUpperCase() === '$TMP' },
  );
  try {
    await resolveObject(client, name, 'SRVD');
    throw new CliError('OBJECT_EXISTS', `SRVD ${name} already exists`, { object: name, type: 'SRVD' });
  } catch (error: unknown) {
    if (error instanceof CliError && error.code === 'OBJECT_EXISTS') throw error;
    if (!(error instanceof CliError) || error.code !== 'OBJECT_NOT_FOUND') throw error;
  }
  const description = opts.description;
  if (!description) {
    throw new CliError('USAGE', `Missing required option '--description <desc>'`, {
      example: `abap create SRVD ${name} --file ${toOutputPath(opts.file)} --package ${opts.package} --description "<desc>" --yes`,
    });
  }
  try {
    await client.createObject({
      objtype: 'SRVD/SRV',
      name,
      parentName: opts.package,
      description,
      parentPath: `/sap/bc/adt/packages/${encodeURIComponent(opts.package)}`,
      transport,
    } as Parameters<AdtClientWrapper['createObject']>[0]);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError('CREATE_FAILED', `Failed to create SRVD ${name}: ${message}`, {
      object: name,
      type: 'SRVD',
    });
  }
  printResult(
    mode,
    { object: name, type: 'SRVD', action: 'created', channel: 'adt', sourceFile: toOutputPath(opts.file) },
    `Created SRVD ${name} in ${opts.package} (${transport}); push the .acds companion next via \`abap push\``,
  );
}

function sidecarExists(jsonPath: string, sourceFile: string): boolean {
  try {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    return fs.existsSync(path.resolve(process.cwd(), jsonPath)) && fs.existsSync(path.resolve(process.cwd(), sourceFile));
  } catch {
    return false;
  }
}

// Module-load side effect: register SRVD in the create handler table. Decision 2A.
const srvdHandler: CreateHandler = async ({ name, opts, mode }) => {
  await runCreateSrvd(name, opts as CreateOptions, mode);
};
registerCreateHandler('SRVD', srvdHandler);