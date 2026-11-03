/**
 * Shared helpers for the SM59 (HTTP destination) flows.
 *
 * SM59 destinations are client-independent entries in the system table RFCDES
 * (RFCTYPE = 'G'): create / pull / push / delete all go through the bundled ICF
 * service `/sm59/<name>`. They have no package and cannot be transported, so an
 * explicit `--package` / `--tr` is rejected with an actionable message instead
 * of being silently dropped (which would make an agent believe the value had
 * been applied).
 */
import { CliError } from '../../output/json.js';
import { SM59_NAME_MAX_LENGTH } from '../../formats/sm59/json.js';
import { affObjectToken } from '../../formats/file-resolver.js';
import * as path from 'node:path';

/**
 * Characters a destination name may not contain after trim + uppercase.
 *
 * RFCDEST is a free CHAR 32 field: real destinations include `-` (SAP
 * internal names), `@` and `.` (e.g. `S4H_000@CIF_CCMS`), plus the usual
 * ABAP-style `_` / namespace `/`. The SAP-side maintenance API stays
 * authoritative for exotic names, so the local rule only blocks shapes that can
 * never work: empty / over-long names and whitespace or control characters
 * (they cannot be addressed by the `/sm59/<name>` route reliably).
 */
const SM59_NAME_FORBIDDEN = /[\s\x00-\x1f\x7f]/;

/** Uppercase + trim a destination name (SM59 names are case-insensitive). */
export function normalizeSm59Name(name: string): string {
  return name.trim().toUpperCase();
}

/**
 * Validate and normalize an SM59 destination name: 1..32 characters after
 * trim + uppercase, no whitespace or control characters.
 *
 * @throws CliError SM59_NAME_INVALID (VALIDATION_ERROR / exit 7)
 */
export function validateSm59Name(objectName: string): string {
  const name = normalizeSm59Name(objectName);
  const nextSteps = [
    `Use 1-${SM59_NAME_MAX_LENGTH} characters without whitespace or control characters.`,
    'Destination names are case-insensitive; the CLI stores them uppercase.',
  ];
  if (!name) {
    throw new CliError('SM59_NAME_INVALID', 'SM59 destination name must not be empty', {
      object: name,
      type: 'SM59',
      nextSteps,
      example: 'abap create SM59 ZSM59_DEMO --file src/zsm59_demo.sm59.json --yes',
    });
  }
  if (name.length > SM59_NAME_MAX_LENGTH) {
    throw new CliError(
      'SM59_NAME_INVALID',
      `SM59 destination name must be at most ${SM59_NAME_MAX_LENGTH} characters (RFCDEST; got ${name.length})`,
      { object: name, type: 'SM59', nextSteps },
    );
  }
  if (SM59_NAME_FORBIDDEN.test(name)) {
    throw new CliError(
      'SM59_NAME_INVALID',
      `SM59 destination name must not contain whitespace or control characters: "${objectName}"`,
      { object: name, type: 'SM59', nextSteps },
    );
  }
  return name;
}

/**
 * The local document carries no `name` field (the file name is the identity,
 * matching the AFF HTTP / TRAN convention), so create/push must reject a file
 * whose name token does not match the destination. Otherwise `create SM59 FOO
 * --file bar.sm59.json` would silently define FOO from a document pulled for
 * BAR, and `pull FOO` would write it under a different file name.
 *
 * @throws CliError INVALID_ARGUMENT (VALIDATION_ERROR / exit 7)
 */
export function assertSm59FileNameMatches(name: string, filePath: string, outFile?: string): void {
  const expected = `${affObjectToken(name)}.sm59.json`.toLowerCase();
  const actual = path.basename(filePath).toLowerCase();
  if (actual !== expected) {
    throw new CliError(
      'INVALID_ARGUMENT',
      `--file name does not match the destination name: expected ${expected} (got ${path.basename(filePath)})`,
      {
        file: outFile ?? path.basename(filePath),
        object: name,
        type: 'SM59',
        nextSteps: ['Rename the file to <name>.sm59.json so the AFF file name and the destination stay in sync.'],
        example: `abap create SM59 ${name} --file src/${affObjectToken(name)}.sm59.json --yes`,
      },
    );
  }
}

/**
 * SM59 destinations have no package and no transport path: refuse explicit
 * `--package` / `--tr` so the caller never believes a value was recorded.
 *
 * @throws CliError TYPE_NOT_SUPPORTED (VALIDATION_ERROR / exit 7)
 */
export function rejectSm59PackageAndTransport(
  opts: { package?: string; tr?: string },
  action: 'create' | 'push' | 'delete',
): void {
  const nextSteps = [
    'Drop the flag: SM59 destinations live in the client-independent system table RFCDES, so they have no package and cannot be transported.',
    'Create the destination only in the system where it is needed (repeat create per system instead of transporting it).',
  ];
  const example =
    action === 'create'
      ? 'abap create SM59 ZSM59_DEMO --file src/zsm59_demo.sm59.json --yes'
      : action === 'push'
        ? 'abap push src/zsm59_demo.sm59.json'
        : 'abap delete ZSM59_DEMO --type SM59 --yes';
  if (opts.package !== undefined && opts.package !== '') {
    throw new CliError(
      'TYPE_NOT_SUPPORTED',
      'SM59 destinations are client-independent system-table entries: they have no package and cannot be transported; drop --package',
      {
        type: 'SM59',
        details: { action, package: opts.package },
        nextSteps,
        example,
      },
    );
  }
  if (opts.tr !== undefined && opts.tr !== '') {
    throw new CliError(
      'TYPE_NOT_SUPPORTED',
      'SM59 destinations are client-independent system-table entries: they have no package and cannot be transported; drop --tr',
      {
        type: 'SM59',
        details: { action, transport: opts.tr },
        nextSteps,
        example,
      },
    );
  }
}
