/**
 * CDS technical object push flow — DTDC / DTEB / DSFD / DSFI (ADT only).
 *
 * `push` updates an existing object: the local AFF document (+ `.acds` sidecar
 * for DTDC/DTEB/DSFD) is validated, the object's package is read from the
 * metadata resource so the transport rule stays honest, then the source is
 * written under a lock and activated (`--no-activate` stops after the write).
 *
 * A missing object maps to `OBJECT_NOT_FOUND` with a `create` pointer. Pushing
 * the `.acds` sidecar directly is rejected — it is sent together with its JSON
 * document.
 */
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import type { AdtClientWrapper } from '../../clients/adt-client.js';
import {
  CDS_TECH_INFO,
  buildDsfiSource,
  cdsTechObjectUrl,
  parseCdsTechMeta,
  rethrowDsfdFeatureError,
  validateDsfiDocument,
} from '../../clients/cds-tech.js';
import { CliError } from '../../output/json.js';
import { cdsTechArtifactFor, type CdsTechLocal, type CdsTechType, type DsfiLocal } from '../../formats/cds-tech/json.js';
import { resolveFile } from '../../formats/file-resolver.js';
import { isLocalPackageName } from '../../core/transport.js';
import { cdsJsonSuffix, cdsSidecarPath, sidecarRequired } from './cds-tech-shared.js';

export interface PushCdsTechOptions {
  /** Transport request to record the update in (`corrNr`). */
  transport?: string;
  /** false when `abap push --no-activate` was passed. */
  activate?: boolean;
}

export interface PushCdsTechResult {
  object: string;
  channel: 'adt';
  action: 'updated';
  activated: boolean;
}

function nameFromFile(type: CdsTechType, file: string): string {
  const resolved = resolveFile(file);
  if (resolved.objectType !== type) {
    throw new CliError('VALIDATION_ERROR', `Expected a ${cdsJsonSuffix(type)} file, got ${path.basename(file)}`, {
      file,
      type,
    });
  }
  if (resolved.format !== 'json') {
    throw new CliError(
      'INVALID_ARGUMENT',
      `${path.basename(file)} is the ${type} source sidecar; push its JSON document instead`,
      {
        file,
        type,
        nextSteps: [`Push ${path.basename(file).replace(/\.acds$/, cdsJsonSuffix(type))}; the sidecar is sent automatically.`],
      },
    );
  }
  return resolved.objectName;
}

async function readSourceSidecar(type: CdsTechType, file: string): Promise<string> {
  const sidecar = cdsSidecarPath(path.resolve(process.cwd(), file), type);
  let source: string;
  try {
    source = await fs.readFile(sidecar, 'utf8');
  } catch {
    throw new CliError('VALIDATION_ERROR', `${type} companion source missing: ${path.basename(sidecar)}`, {
      file,
      nextSteps: [`Run 'abap pull <name> --type ${type}' to regenerate the .json + .acds pair.`],
    });
  }
  if (!source.trim()) {
    throw new CliError('VALIDATION_ERROR', `${type} companion source is empty: ${path.basename(sidecar)}`, { file });
  }
  return source;
}

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
        nextSteps: [`Create and activate the scalar function definition first: abap create DSFD ${scalarFunctionName} --file <file> --package <pkg> --yes`],
      });
    }
    throw error;
  }
}

export async function runPushCdsTech(
  client: AdtClientWrapper,
  type: CdsTechType,
  file: string,
  opts: PushCdsTechOptions = {},
): Promise<PushCdsTechResult> {
  const name = nameFromFile(type, file);
  const artifact = cdsTechArtifactFor(type);
  const filePath = path.resolve(process.cwd(), file);
  let doc: CdsTechLocal;
  try {
    doc = await artifact.read(filePath);
  } catch (error: unknown) {
    throw new CliError('FILE_PARSE_ERROR', `Cannot read ${type} file ${file}: ${error instanceof Error ? error.message : String(error)}`, {
      file,
      type,
    });
  }
  const errors = await artifact.validate(doc);
  if (errors.length > 0) {
    throw new CliError('AFF_FIXTURE_INVALID', `${type} file ${file} failed schema validation: ${errors.join('; ')}`, {
      file,
      type,
      details: errors,
    });
  }
  const source = sidecarRequired(type) ? await readSourceSidecar(type, file) : '';
  let dsfiSource = '';
  if (type === 'DSFI') {
    const dsfi = doc as DsfiLocal;
    const parts = validateDsfiDocument(name, dsfi);
    await assertReferencedScalarFunction(client, parts.scalarFunctionName, name);
    dsfiSource = buildDsfiSource(dsfi);
  }

  // Existence + package read-back for the transport rule. A 404 must not fall
  // through to a create.
  let packageName: string | undefined;
  try {
    const meta = parseCdsTechMeta(type, await client.getCdsTechObject(type, name));
    packageName = meta.packageName;
  } catch (error) {
    if (error instanceof CliError && (error.details?.httpStatus === 404 || error.code === 'OBJECT_NOT_FOUND')) {
      throw new CliError('OBJECT_NOT_FOUND', `${type} ${name} does not exist; create it first`, {
        object: name,
        type,
        nextSteps: [`Create it: abap create ${type} ${name} --file ${file} --package $TMP --yes`],
        example: `abap create ${type} ${name} --file ${file} --package $TMP --yes`,
      });
    }
    throw error;
  }
  // Local (`$`-prefixed) packages are transport-free and a stray --tr must not
  // reach SAP; everything else needs an active request.
  let transport = opts.transport;
  if (isLocalPackageName(packageName)) {
    transport = undefined;
  } else if (!transport) {
    throw new CliError('MISSING_TRANSPORT', `${type} ${name} is in package ${packageName ?? '?'}; --tr is required`, {
      object: name,
      type,
      details: { packageName },
      nextSteps: [
        'Pass --tr <request> to record the change in a transportable request.',
        'Or move the object to a local package ($TMP) for scratch work.',
      ],
      example: `abap push ${file} --tr NDK900123 --yes`,
    });
  }

  try {
    await client.writeCdsTechSource(type, name, type === 'DSFI' ? dsfiSource : source, {
      ...(transport ? { transport } : {}),
      // All four types keep the AFF header description in the metadata
      // resource (DSFI's JSON header is not the source of truth for it).
      description: doc.header.description,
    });
    const activated = opts.activate !== false;
    if (activated) {
      await client.activate(cdsTechObjectUrl(type, name), CDS_TECH_INFO[type].objtype, name);
    }
    return { object: name, channel: 'adt', action: 'updated', activated };
  } catch (error) {
    if (type === 'DSFD') rethrowDsfdFeatureError(error);
    throw error;
  }
}
