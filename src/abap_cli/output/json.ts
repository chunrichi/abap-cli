/**
 * Unified output helpers: consistent --json / human-readable output and exit codes.
 * JSON shape follows contracts/cli-commands.md: { status: 'success', data } | { status: 'error', error }.
 */

import type { Command } from 'commander';

/** Resolve the top-level --json flag from any nested subcommand. */
export function jsonFromCommand(cmd: Command): boolean {
  let c: Command | undefined = cmd;
  while (c.parent) c = c.parent;
  return c.opts().json ?? false;
}

export class CliError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'CliError';
    this.code = code;
    this.details = details;
  }
}

/** Normalize any thrown value into the contract error shape. */
export function toErrorShape(error: unknown): { code: string; message: string; [key: string]: unknown } {
  if (error instanceof CliError) {
    // details first so code/message always win
    return { ...error.details, code: error.code, message: error.message };
  }
  const err = error as { statusCode?: number; statusMessage?: string; message?: string };
  const status = typeof err?.statusCode === 'number' ? err.statusCode : undefined;
  const message = err?.message || String(error);
  if (status !== undefined) {
    return {
      code: 'SAP_ERROR',
      message,
      httpStatus: status,
      ...(err.statusMessage ? { httpStatusText: err.statusMessage } : {}),
    };
  }
  return { code: 'SAP_ERROR', message };
}

/** Print a success result: JSON { status: 'success', data } or a human-readable summary. */
export function printResult(json: boolean, data: unknown, human: string): void {
  if (json) {
    console.log(JSON.stringify({ status: 'success', data }, null, 2));
  } else {
    console.log(human);
  }
}

/** Print an error (JSON or text) and exit with a non-zero code. */
export function printError(json: boolean, error: unknown): never {
  const err = toErrorShape(error);
  if (json) {
    console.error(JSON.stringify({ status: 'error', error: err }, null, 2));
  } else {
    console.error(`Error: ${err.message}`);
  }
  process.exit(1);
}
