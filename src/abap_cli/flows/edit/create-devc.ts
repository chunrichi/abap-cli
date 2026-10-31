/**
 * DEVC (package) create flow — ADT only.
 *
 * `POST /sap/bc/adt/packages` creates a `DEVC/K` package. A package has no
 * activation step and no source include: the request body carries the super
 * package, software component, transport layer and package type.
 *
 * Defaults for `--software-component` / `--transport-layer` are inherited from
 * the super package (`GET /sap/bc/adt/packages/<parent>`), which is also the
 * existence preflight — `$TMP` yields LOCAL / empty, so local sub-packages
 * need neither flag.
 *
 * `--check-only` uses SAP's own preflight (`POST /sap/bc/adt/packages/validation`)
 * so name/software-component errors come back exactly as SAP words them.
 */
import * as path from 'node:path';
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { CliError, printResult, type OutputMode } from '../../output/json.js';
import { collectWarning } from '../../output/meta.js';
import { buildFilename } from '../../formats/file-resolver.js';
import { toOutputPath } from '../../core/path-output.js';
import {
  wireToLocal,
  isLocalSoftwareComponent,
  validateLocalPackageName,
} from '../../formats/devc/json.js';
import { normalizeName, validatePackageName } from './object-name.js';
import { writePullFile } from './pull-source.js';
import type { CreateOptions } from './create.js';
import type { CreateHandler } from './routing.js';

/** AFF `generalInformation.type` enum values. */
const PACKAGE_TYPES = ['development', 'main', 'structure'] as const;
type PackageType = (typeof PACKAGE_TYPES)[number];

function parsePackageType(value: string | undefined): PackageType {
  const raw = (value ?? 'development').trim().toLowerCase();
  if (!(PACKAGE_TYPES as readonly string[]).includes(raw)) {
    throw new CliError('INVALID_ARGUMENT', `Invalid --package-type '${value}'`, {
      nextSteps: [`Use one of: ${PACKAGE_TYPES.join(', ')}.`],
      example: 'abap create DEVC $MY_PACKAGE --package \'$TMP\' --description "..." --package-type development --yes',
    });
  }
  return raw as PackageType;
}

export async function runCreateDevc(
  name: string,
  opts: CreateOptions,
  mode: OutputMode,
): Promise<void> {
  // DEVC is flag-driven: no AFF input file, no skeleton template, no
  // activation, and no function-module sub-command.
  if (opts.file) {
    throw new CliError('USAGE', 'Type DEVC is created from flags, not --file', {
      nextSteps: [
        'Pass --package <super> --description <desc> and optionally --software-component / --transport-layer / --package-type.',
      ],
      example: `abap create DEVC ${name} --package '$TMP' --description "..." --yes`,
    });
  }
  if (opts.func !== undefined) {
    throw new CliError('INVALID_ARGUMENT', '--func <name> is only valid with type FUGR', { type: 'DEVC' });
  }
  if (opts.template !== undefined) {
    throw new CliError('INVALID_ARGUMENT', '--template is not supported for type DEVC', { type: 'DEVC' });
  }
  if (!opts.description) {
    throw new CliError('USAGE', "Missing required option '--description <desc>'", {
      example: `abap create DEVC ${name} --package '$TMP' --description "..." --yes`,
    });
  }

  const objectName = normalizeName(name);
  validatePackageName(objectName);
  const parentPackage = normalizeName(opts.package);
  const packageType = parsePackageType(opts.packageType);

  const client = await AdtClientWrapper.create();

  // Super-package read doubles as the existence preflight and as the default
  // source for software component / transport layer.
  let parentInfo: ReturnType<typeof wireToLocal>['generalInformation'];
  try {
    parentInfo = wireToLocal(await client.getPackage(parentPackage)).generalInformation;
  } catch (error: unknown) {
    if (error instanceof CliError && error.code === 'OBJECT_NOT_FOUND') {
      throw new CliError('OBJECT_NOT_FOUND', `Super package ${parentPackage} not found`, {
        object: parentPackage,
        type: 'DEVC',
        nextSteps: [
          'Pass an existing super package: `abap search <name> --type DEVC`.',
          "Use '$TMP' for a local scratch package.",
        ],
        example: `abap create DEVC ${objectName} --package '$TMP' --description "..." --yes`,
      });
    }
    throw error;
  }

  const softwareComponent = (opts.softwareComponent ?? parentInfo?.softwareComponent ?? '')
    .trim()
    .toUpperCase();
  if (!softwareComponent) {
    throw new CliError('INVALID_ARGUMENT', 'No software component resolved for the new package', {
      nextSteps: [
        `Pass --software-component <swcomp> (e.g. LOCAL for '$TMP', HOME for customer transportable packages).`,
      ],
      example: `abap create DEVC ${objectName} --package '${parentPackage}' --description "..." --software-component HOME --yes`,
    });
  }
  const transportLayer = (opts.transportLayer ?? parentInfo?.transportLayer ?? '')
    .trim()
    .toUpperCase();
  const isLocal = isLocalSoftwareComponent(softwareComponent);
  const responsible = client.getConfig().sap.username.toUpperCase();

  // --check-only: ask SAP's package validation endpoint, never create.
  if (opts.checkOnly) {
    const result = await client.validatePackage({
      name: objectName,
      description: opts.description,
      parentName: parentPackage,
      softwareComponent,
      transportLayer,
      packageType,
    });
    printResult(
      mode,
      {
        object: objectName,
        type: 'DEVC',
        checkOnly: true,
        valid: result.success,
        superPackage: parentPackage,
        softwareComponent,
        ...(transportLayer ? { transportLayer } : {}),
        packageType,
        issues: result.success ? [] : [result.message],
      },
      `Validation ${result.success ? 'passed' : 'failed'} for ${objectName} (no package created).`,
    );
    return;
  }

  // Local fail-fast before writing: SAP rejects LOCAL names that do not start
  // with `$` or `TEST`. (Skipped for --check-only so SAP reports it instead.)
  if (isLocal) {
    const reason = validateLocalPackageName(objectName);
    if (reason) {
      throw new CliError('VALIDATION_ERROR', `Invalid local package name '${objectName}': ${reason}`, {
        object: objectName,
        type: 'DEVC',
        details: [reason],
        nextSteps: [
          "Prefix the name with '$' (e.g. $MY_PACKAGE) or 'TEST' (e.g. TEST_MY_PACKAGE).",
          'Or choose a non-LOCAL software component via --software-component.',
        ],
      });
    }
  }

  try {
    await client.createPackage({
      name: objectName,
      description: opts.description,
      parentName: parentPackage,
      softwareComponent,
      transportLayer,
      packageType,
      responsible,
      ...(opts.tr ? { transport: opts.tr } : {}),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError('CREATE_FAILED', `Failed to create DEVC ${objectName}: ${message}`, {
      object: objectName,
      type: 'DEVC',
      details: { superPackage: parentPackage, softwareComponent },
    });
  }

  // Create-then-pull default: write the local AFF document from the package
  // SAP just created so the agent has the artifact on disk.
  let localFile: string | undefined;
  if (opts.pull !== false) {
    const doc = wireToLocal(await client.getPackage(objectName));
    const relPath = path.join('src', buildFilename(objectName, 'DEVC', undefined, '.json'));
    try {
      const written = await writePullFile({
        filePath: relPath,
        content: JSON.stringify(doc, null, 2) + '\n',
        overwrite: opts.overwrite === true,
        skipExisting: opts.overwrite !== true,
        object: { name: objectName, type: 'DEVC' },
      });
      if (written.status === 'skipped') {
        collectWarning(
          'LOCAL_FILE_KEPT',
          `${written.outPath} already exists and was left untouched; the fresh SAP copy was not written. Re-run with --overwrite to replace it.`,
          { file: written.outPath },
        );
      }
      localFile = written.outPath;
    } catch (error: unknown) {
      // The package exists at this point — a local write failure must not turn
      // a successful create into an error envelope.
      collectWarning(
        'LOCAL_FILE_WRITE_FAILED',
        `DEVC ${objectName} was created, but writing the local copy failed: ${error instanceof Error ? error.message : String(error)}`,
        { object: objectName },
      );
    }
  }

  printResult(
    mode,
    {
      object: objectName,
      type: 'DEVC',
      action: 'created',
      channel: 'adt',
      superPackage: parentPackage,
      softwareComponent,
      ...(transportLayer ? { transportLayer } : {}),
      packageType,
      ...(localFile ? { localFile: toOutputPath(localFile) } : {}),
    },
    `Created DEVC ${objectName} (super package ${parentPackage}, ${softwareComponent})` +
      (localFile ? `; wrote ${localFile}` : ''),
  );
}

export const createDevcHandler: CreateHandler = async ({ name, opts, mode }) => {
  await runCreateDevc(name, opts, mode);
};
