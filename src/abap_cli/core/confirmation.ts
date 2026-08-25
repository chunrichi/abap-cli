import { CliError } from '../output/json.js';

export interface WriteConfirmationOptions {
  yes?: boolean;
  dryRun?: boolean;
  supportsDryRun?: boolean;
}

export function requireWriteConfirmation(
  operation: string,
  opts: WriteConfirmationOptions,
  example: string,
): void {
  if (opts.dryRun || opts.yes || process.stdin.isTTY) return;

  const nextSteps = [`Re-run with --yes to perform ${operation}.`];
  const message = opts.supportsDryRun
    ? `${operation} is a write operation; confirm with --yes or pass --dry-run.`
    : `${operation} is a write operation; confirm with --yes.`;
  if (opts.supportsDryRun) nextSteps.push('Or pass --dry-run to preview without making changes.');

  throw new CliError('VALIDATION_ERROR', message, {
    nextSteps,
    example,
  });
}