/**
 * CDS technical object create flow — DTDC / DTEB / DSFD / DSFI (ADT only).
 *
 * Source-bearing types (DTDC / DTEB / DSFD) read the AFF JSON plus the sibling
 * `.acds` sidecar, POST the ADT collection, write `source/main` and activate.
 * DSFI reads a single AFF JSON, validates the engine-suffix contract, checks
 * that the referenced scalar function definition exists, then writes the JSON
 * as the object source and activates.
 *
 * SAP-side gates surfaced as-is (with clearer messages where SAP's wording is
 * misleading): DSFD writes need the `DD_CDS_DSFD` user parameter; DTEB
 * activation needs a bufferable view entity; DSFI needs an active DSFD.
 */
import * as path from 'node:path';
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { cdsTechObjectUrl, rethrowCdsFeatureError, validateDsfiDocument, buildDsfiSource } from '../../clients/cds-tech.js';
import { CliError, printResult, type OutputMode } from '../../output/json.js';
import { cdsTechArtifactFor, type CdsTechLocal, type CdsTechType, type DsfiLocal } from '../../formats/cds-tech/json.js';
import { toOutputPath } from '../../core/path-output.js';
import { transportForPackage } from '../../core/transport.js';
import { CDS_TECH_INFO } from '../../clients/cds-tech.js';
import type { CreateOptions } from './create.js';
import type { CreateHandler } from './routing.js';
import { assertCdsFileName, cdsJsonSuffix, cdsSidecarPath, sidecarRequired } from './cds-tech-shared.js';

async function readSourceSidecar(type: CdsTechType, filePath: string, displayFile: string): Promise<string> {
  const sidecar = cdsSidecarPath(filePath, type);
  const fs = await import('node:fs/promises');
  let source: string;
  try {
    source = await fs.readFile(sidecar, 'utf8');
  } catch {
    throw new CliError('VALIDATION_ERROR', `${type} companion source missing: ${path.basename(sidecar)}`, {
      file: displayFile,
      nextSteps: [`Write the CDS source next to the metadata document: ${path.basename(sidecar)}`],
    });
  }
  if (!source.trim()) {
    throw new CliError('VALIDATION_ERROR', `${type} companion source is empty: ${path.basename(sidecar)}`, {
      file: filePath,
    });
  }
  return source;
}

/** Ensure the DSFD referenced by a DSFI document exists (and is readable). */
async function assertReferencedScalarFunction(
  client: AdtClientWrapper,
  scalarFunctionName: string,
  dsfiName: string,
): Promise<void> {
  try {
    await client.getCdsTechObject('DSFD', scalarFunctionName);
  } catch (error) {
    if (error instanceof CliError && (error.details?.httpStatus === 404 || error.code === 'OBJECT_NOT_FOUND')) {
      throw new CliError('OBJECT_NOT_FOUND', `Referenced scalar function ${scalarFunctionName} does not exist`, {
        object: dsfiName,
        type: 'DSFI',
        details: { scalarFunctionName },
        nextSteps: [
          `Create and activate the scalar function definition first: abap create DSFD ${scalarFunctionName} --file <file> --package <pkg> --yes`,
          'A DSFI name is `<scalarFunctionName>_ANA`.',
        ],
      });
    }
    throw error;
  }
}

export async function runCreateCdsTech(
  type: CdsTechType,
  name: string,
  opts: CreateOptions,
  mode: OutputMode,
): Promise<void> {
  const suffix = cdsJsonSuffix(type);
  if (!opts.file) {
    throw new CliError('USAGE', `Type ${type} requires --file <path> with an abap-file-format JSON`, {
      example: `abap create ${type} ${name} --file src/${name.toLowerCase()}${suffix} --package $TMP --yes`,
    });
  }
  const filePath = path.resolve(process.cwd(), opts.file);
  if (!filePath.toLowerCase().endsWith(suffix)) {
    throw new CliError('VALIDATION_ERROR', `${type} metadata must use the ${suffix} suffix: ${toOutputPath(opts.file)}`, {
      file: toOutputPath(opts.file),
    });
  }
  assertCdsFileName(name, type, filePath);

  const artifact = cdsTechArtifactFor(type);
  let doc: CdsTechLocal;
  try {
    doc = await artifact.read(filePath);
  } catch (error: unknown) {
    throw new CliError(
      'FILE_PARSE_ERROR',
      `Cannot read ${type} file ${toOutputPath(opts.file)}: ${error instanceof Error ? error.message : String(error)}`,
      { file: toOutputPath(opts.file) },
    );
  }
  const errors = await artifact.validate(doc);
  if (errors.length > 0) {
    throw new CliError('VALIDATION_ERROR', `Invalid ${type} definition in ${toOutputPath(opts.file)}: ${errors.join('; ')}`, {
      file: toOutputPath(opts.file),
      details: errors,
    });
  }

  const source = sidecarRequired(type) ? await readSourceSidecar(type, filePath, toOutputPath(opts.file)) : '';
  const client = await AdtClientWrapper.create();
  let dsfiSource = '';
  if (type === 'DSFI') {
    const dsfi = doc as DsfiLocal;
    const parts = validateDsfiDocument(name, dsfi);
    await assertReferencedScalarFunction(client, parts.scalarFunctionName, name);
    dsfiSource = buildDsfiSource(dsfi);
  }

  const targetPackage = (opts.package ?? '$TMP').trim().toUpperCase();
  // A stray --tr on a local package must not reach SAP.
  const transport = transportForPackage(targetPackage, opts.tr);
  try {
    await client.createCdsTechObject(type, name, {
      packageName: targetPackage,
      description: doc.header.description,
      ...(transport ? { transport } : {}),
    });
    await client.writeCdsTechSource(type, name, type === 'DSFI' ? dsfiSource : source, {
      ...(transport ? { transport } : {}),
    });
    if (opts.activate !== false) {
      await client.activate(cdsTechObjectUrl(type, name), CDS_TECH_INFO[type].objtype, name);
    }
  } catch (error) {
    rethrowCdsFeatureError(type, error);
  }
  printResult(
    mode,
    {
      object: name,
      type,
      action: 'created',
      channel: 'adt',
      activated: opts.activate !== false,
    },
    `Created ${type} ${name} via ADT${opts.activate === false ? ' (inactive)' : ''}`,
  );
}

/** Per-type create handler factory (one row per CDS technical type in `routing.ts`). */
export function createCdsTechHandler(type: CdsTechType): CreateHandler {
  return async ({ name, opts, mode }) => {
    await runCreateCdsTech(type, name, opts, mode);
  };
}
