/**
 * Best-effort lifecycle for clients owned by the current CLI process.
 *
 * Centralises the "release on shutdown" path so command code and signal
 * handlers share one implementation: a broken SAP logout must never hide
 * the command result or keep shutdown stuck. Each registered client is
 * given a fixed budget (`timeoutMs`) to release; if SAP doesn't answer in
 * time we drop the client, log a warning and move on.
 *
 * Draining is batched: clients registered while a batch is closing are
 * picked up by the next batch, so "register late, never released" cannot
 * happen. A caller that arrives mid-drain is handed the in-flight promise
 * once, then re-snapshots the registry, so it never returns before its own
 * clients were released.
 */

export interface CloseableClient {
  /** Short label for logs (e.g. "adt", "icf"). */
  readonly label: string;
  /** Release any network resources. Resolves once done; must not throw. */
  close(): Promise<void>;
}

export const DEFAULT_TIMEOUT_MS = 5_000;

const clients = new Set<CloseableClient>();
let draining = false;
let current: Promise<void> | undefined;
let idle: Promise<void> = Promise.resolve();
let releaseIdle: (() => void) | undefined;

/** Track a client so command end + signal handlers release it centrally. */
export function trackClient<T extends CloseableClient>(client: T): T {
  clients.add(client);
  return client;
}

/**
 * Stop tracking a client without closing it (e.g. ownership handed off).
 * Idempotent — unknown clients are ignored.
 */
export function untrackClient(client: CloseableClient): void {
  clients.delete(client);
}

/**
 * Best-effort shutdown for every tracked client, or for just the given
 * labels when a set is passed. Callers that arrive while a drain is already
 * running are handed that in-flight promise once, then re-snapshot, so the
 * call never resolves while clients it asked for are still tracked.
 */
export function closeTrackedClients(
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  labels?: ReadonlySet<string>,
): Promise<void> {
  // Synchronous fast path: a re-entrant or concurrent call joins the running
  // drain instead of queueing a second one, and gets the identical promise.
  if (draining) return current ?? idle;
  draining = true;
  current = runBatches(timeoutMs, labels).finally(() => {
    draining = false;
    current = undefined;
    releaseIdle?.();
    releaseIdle = undefined;
  });
  return current;
}

async function runBatches(timeoutMs: number, labels?: ReadonlySet<string>): Promise<void> {
  // Only the caller that flipped `draining` runs the loop; anyone who joined
  // afterwards is parked on `idle` and re-snapshots once this batch settles.
  await idle;
  for (;;) {
    const batch = snapshot(labels);
    if (batch.length === 0) return;
    // Untrack up-front so a concurrent / later drain never closes twice.
    for (const client of batch) clients.delete(client);
    const settled = new Promise<void>((resolve) => {
      releaseIdle = resolve;
    });
    idle = settled;
    await Promise.all(batch.map((client) => closeWithTimeout(client, timeoutMs)));
    // Wake parked callers, then loop in case clients were registered while the
    // batch was closing (they are drained by the next iteration).
    releaseIdle?.();
    releaseIdle = undefined;
    await settled;
  }
}

function snapshot(labels?: ReadonlySet<string>): CloseableClient[] {
  const all = [...clients];
  return labels ? all.filter((client) => labels.has(client.label)) : all;
}

/**
 * Race the client's close against a timer. We attach `.catch(() => undefined)`
 * to the close branch so a late rejection never becomes an unhandledRejection
 * after the timer already won.
 */
async function closeWithTimeout(client: CloseableClient, timeoutMs: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
    timer.unref();
  });
  try {
    const winner = await Promise.race([workOf(client), timeout]);
    if (winner === 'timeout') {
      // Diagnostics only — the command's exit code is unaffected.
      console.error(`WARN: releasing the ${client.label} client timed out after ${timeoutMs}ms; continuing shutdown.`);
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Close outcome is normalised to "done" so a late rejection stays handled. */
function workOf(client: CloseableClient): Promise<'done'> {
  return Promise.resolve()
    .then(() => client.close())
    .then(() => 'done' as const)
    .catch(() => 'done' as const);
}

/** Test-only: snapshot of currently-tracked clients (labels only). */
export function trackedLabels(): string[] {
  return [...clients].map((c) => c.label);
}

/** Test-only: reset state between cases. */
export function _resetLifecycle(): void {
  clients.clear();
  draining = false;
  current = undefined;
  idle = Promise.resolve();
  releaseIdle = undefined;
}
