/**
 * DCLS / DDLX / DDLA create flow — three CDS companion types share the same
 * shape: register metadata via ADT typed `createObject`. The companion `.acds`
 * source is written later by `abap push` through `pushSourceObjectOne`; this
 * keeps create minimal and decoupled from the heavy CDS schema validators
 * (the type-specific JSON shape is only consulted on push / pull).
 *
 * Mirrors the SRVD create handler in `create-srvd.ts`.
 */
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { CliError, printResult, type OutputMode } from '../../output/json.js';
import { resolveTransport } from '../../core/transport.js';
import { resolveObject } from '../../core/resolve.js';
import { toOutputPath } from '../../core/path-output.js';
import type { CreateOptions } from './create.js';
import { registerCreateHandler, type CreateHandler } from '../../types/registry.js';

type CdsExtensionType = 'DCLS' | 'DDLX' | 'DDLA';

/** Companion source sidecar path: `<file-without-.json>.acds`. */
function sidecarPath(jsonPath: string): string {
  return jsonPath.replace(/\.json$/, '') + '.acds';
}

async function runCreateCdsExtension(
  type: CdsExtensionType,
  name: string,
  opts: CreateOptions,
  mode: OutputMode,
): Promise<void> {
  if (!opts.file) {
    throw new CliError(
      'USAGE',
      `Type ${type} requires --file <path> with an abap-file-format JSON`,
      {
        example: `abap create ${type} ${name} --file src/${name.toLowerCase()}/${name.toLowerCase()}.${type.toLowerCase()}.json --package $TMP --description "..." --yes`,
      },
    );
  }
  // Companion source sidecar must exist — metadata without source is
  // meaningless on the SAP side and would push back as a broken object.
  const jsonPath = opts.file;
  const sourceFile = sidecarPath(jsonPath);
  if (!sidecarExists(jsonPath, sourceFile)) {
    throw new CliError(
      'VALIDATION_ERROR',
      `${type} companion source file missing: ${sourceFile}`,
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
  // Refuse overwrite: create is a "new object" operation, mirroring the CLAS path.
  try {
    await resolveObject(client, name, type);
    throw new CliError('OBJECT_EXISTS', `${type} ${name} already exists`, { object: name, type });
  } catch (error: unknown) {
    if (error instanceof CliError && error.code === 'OBJECT_EXISTS') throw error;
    if (!(error instanceof CliError) || error.code !== 'OBJECT_NOT_FOUND') throw error;
  }
  const description = opts.description;
  if (!description) {
    throw new CliError('USAGE', `Missing required option '--description <desc>'`, {
      example: `abap create ${type} ${name} --file ${toOutputPath(opts.file)} --package ${opts.package} --description "<desc>" --yes`,
    });
  }
  try {
    await client.createObject({
      objtype: type === 'DCLS' ? 'DCLS/DL' : type === 'DDLX' ? 'DDLX/EX' : 'DDLA/ADF',
      name,
      parentName: opts.package,
      description,
      parentPath: `/sap/bc/adt/packages/${encodeURIComponent(opts.package)}`,
      transport,
    } as Parameters<AdtClientWrapper['createObject']>[0]);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError('CREATE_FAILED', `Failed to create ${type} ${name}: ${message}`, {
      object: name,
      type,
    });
  }
  printResult(
    mode,
    { object: name, type, action: 'created', channel: 'adt', sourceFile: toOutputPath(opts.file) },
    `Created ${type} ${name} in ${opts.package} (${transport}); push the .acds companion next via \`abap push\``,
  );
}

/** Returns true when both files exist (relative paths resolved against cwd). */
function sidecarExists(jsonPath: string, sourceFile: string): boolean {
  try {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    return fs.existsSync(path.resolve(process.cwd(), jsonPath)) && fs.existsSync(path.resolve(process.cwd(), sourceFile));
  } catch {
    return false;
  }
}

function handlerFor(type: CdsExtensionType): CreateHandler {
  return async ({ name, opts, mode }) => {
    await runCreateCdsExtension(type, name, opts as CreateOptions, mode);
  };
}

// Module-load side effect: register all three CDS extension types. Decision 2A.
registerCreateHandler('DCLS', handlerFor('DCLS'));
registerCreateHandler('DDLX', handlerFor('DDLX'));
registerCreateHandler('DDLA', handlerFor('DDLA'));