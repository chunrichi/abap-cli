/**
 * Requested CLI exit.
 *
 * `printError` writes the rendered error envelope to stderr and then throws
 * this instead of calling `process.exit()`. The top-level runner catches it,
 * releases live SAP sessions, and only then exits with the requested code.
 *
 * Why not `process.exit()`: it terminates synchronously and skips commander's
 * `postAction` hook, which is where end-of-command session cleanup lives. A
 * command that failed after opening a stateful SAP session therefore left one
 * orphan entry in SM04 (the SAP user-session list) per failure — repeated test
 * runs filled the ICM session table and made every later stateful ADT request
 * fail. Throwing keeps the exit path observable and awaitable.
 */

export class CliExit extends Error {
  constructor(public readonly exitCode: number) {
    super(`CLI exit ${exitCode}`);
    this.name = 'CliExit';
  }
}
