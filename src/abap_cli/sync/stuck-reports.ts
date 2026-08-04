import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/** Stable report identity, sortable and unique (FR-022). */
export function newReportId(prefix = 'STUCK'): string {
  const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, '');
  const rand = Math.random().toString(16).slice(2, 6);
  return `${prefix}-${ts}-${rand}`;
}

/** The local report store directory (injectable for tests). */
let reportsDir = path.join(os.homedir(), '.abap-cli', 'reports');
export function setReportsDir(dir: string): void {
  reportsDir = dir;
}

export interface StuckReportInput {
  goal?: string;
  tried?: string;
  where?: string;
  command?: string;
  argv?: string[];
  cwd?: string;
  cliVersion?: string;
}

export interface StuckReportResult {
  id: string;
  recorded: boolean;
  echo: { goal?: string; tried?: string; where?: string };
}

/** Flags whose values are secrets — never recorded in a report (Constitution VI). */
const SECRET_FLAGS = new Set(['--password', '-p', '--tr', '--ca']);

/** Strip credential-bearing flags (and their values) before recording argv. */
export function sanitizeArgv(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (SECRET_FLAGS.has(arg)) {
      i++; // skip the value
      out.push(`${arg} <redacted>`);
      continue;
    }
    out.push(arg);
  }
  return out;
}

/**
 * Record a stuck report to the local store (FR-022..024). Never throws: on a
 * write failure it degrades to `recorded: false` with a synthetic id.
 */
export function writeStuckReport(input: StuckReportInput): StuckReportResult {
  const id = newReportId();
  const record = {
    id,
    timestamp: new Date().toISOString(),
    goal: input.goal,
    tried: input.tried,
    where: input.where,
    command: input.command,
    argv: input.argv ? sanitizeArgv(input.argv) : undefined,
    cwd: input.cwd,
    cliVersion: input.cliVersion,
  };
  try {
    fs.mkdirSync(reportsDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(reportsDir, `${id}.json`), JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
    return { id, recorded: true, echo: { goal: input.goal, tried: input.tried, where: input.where } };
  } catch {
    const degradedId = newReportId('STUCK-DEGRADED');
    console.error(`Warning: could not write stuck report to ${reportsDir} (${degradedId}).`);
    return { id: degradedId, recorded: false, echo: { goal: input.goal, tried: input.tried, where: input.where } };
  }
}

// --- ABAP_REPORT_STUCK=1 auto-trigger (FR-023) ---

let counterPath = path.join(os.homedir(), '.abap-cli', '.stuck-count.json');
/** Injectable for tests so the real home dir is never touched. */
export function setCounterPath(p: string): void {
  counterPath = p;
}
const THRESHOLD = 3;
/** Reset window for consecutive failures (ms). */
const WINDOW_MS = 60 * 60 * 1000;

interface CounterState {
  count: number;
  firstAt: number;
}

function readCounter(): CounterState {
  try {
    return JSON.parse(fs.readFileSync(counterPath, 'utf-8')) as CounterState;
  } catch {
    return { count: 0, firstAt: 0 };
  }
}

function writeCounter(state: CounterState): void {
  try {
    fs.mkdirSync(path.dirname(counterPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(counterPath, JSON.stringify(state), { mode: 0o600 });
  } catch {
    // Counter persistence is best-effort; failure must never break the CLI.
  }
}

/** Record a failure in the consecutive-failure counter. */
export function recordFailure(): void {
  const state = readCounter();
  const now = Date.now();
  if (state.firstAt === 0 || now - state.firstAt > WINDOW_MS) {
    state.count = 1;
    state.firstAt = now;
  } else {
    state.count += 1;
  }
  writeCounter(state);
}

/** True when the failure threshold is crossed (auto-report trigger, FR-023). */
export function shouldAutoReport(envValue: string | undefined): boolean {
  if (envValue !== '1') return false;
  const state = readCounter();
  if (state.count >= THRESHOLD) {
    // Consume the trigger — reset the counter after auto-reporting.
    writeCounter({ count: 0, firstAt: 0 });
    return true;
  }
  return false;
}
