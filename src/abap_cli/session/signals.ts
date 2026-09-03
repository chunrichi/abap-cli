/**
 * SIGINT / SIGTERM handling.
 *
 * The CLI is short-lived, but a command can be interrupted mid-flight
 * (Ctrl-C, kill from a script). When that happens we best-effort release
 * every live ADT/ICF client (`drainClients`) so the SAP session is not left
 * half-open, then exit with the conventional signal-derived code
 * (130 = SIGINT, 143 = SIGTERM).
 *
 * Install once at startup; the returned uninstaller is used by tests and
 * by the top-level exit path when a command finished normally (in which
 * case `postAction` already drained).
 */

import { drainClients } from './registry.js';

const SIGNAL_EXIT_CODES: Record<string, number> = { SIGINT: 130, SIGTERM: 143 };

let installed = false;
let exiting = false;

/** Register the SIGINT/SIGTERM handlers once; returns an uninstaller. */
export function installSignalHandlers(): () => void {
  if (installed) return () => {};
  installed = true;
  const onSignal = (signal: NodeJS.Signals): void => {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    void handleSignal(signal as 'SIGINT' | 'SIGTERM');
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  return () => {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    installed = false;
  };
}

/** Test-only: expose whether handlers are currently installed. */
export function areSignalHandlersInstalled(): boolean {
  return installed;
}

/**
 * Release live clients then exit. Async drain is awaited before `process.exit`
 * so logout requests have a chance to reach SAP; a short guard prevents a
 * second signal (or a double-call) from racing the first exit.
 */
export async function handleSignal(signal: 'SIGINT' | 'SIGTERM'): Promise<void> {
  if (exiting) return;
  exiting = true;
  try {
    await drainClients({ adt: true, icf: true });
  } catch {
    // drain is best-effort; never block the exit on it
  } finally {
    process.exit(SIGNAL_EXIT_CODES[signal] ?? 130);
  }
}

/** Test-only: reset the module-level guard between cases. */
export function _resetSignalState(): void {
  exiting = false;
}
