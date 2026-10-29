import { createHash } from 'node:crypto';
import * as os from 'node:os';
import { spawnSync } from 'node:child_process';
import { FeedbackClient, type FeedbackCreateRequest, type FeedbackIssue } from '../clients/feedback-client.js';
import { CliError } from '../output/json.js';

export const FEEDBACK_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export type FeedbackPriority = (typeof FEEDBACK_PRIORITIES)[number];

export interface FeedbackOptions {
  username?: string;
  email?: string;
  featureKey?: string;
  title?: string;
  description?: string;
  priority?: string;
  sourceSystem?: string;
  agentId?: string;
  sessionId?: string;
  idempotencyKey?: string;
  correlationId?: string;
  dryRun?: boolean;
}

export interface NormalizedFeedback {
  payload: FeedbackCreateRequest;
  idempotencyKey: string;
  correlationId?: string;
}

export interface FeedbackSubmissionResult {
  duplicate: boolean;
  issue?: Partial<FeedbackIssue>;
  request_id?: string;
  idempotencyKey: string;
}

export interface FeedbackDryRunResult {
  dryRun: true;
  payload: FeedbackCreateRequest;
  idempotencyKey: string;
  correlationId?: string;
}

export type FeedbackResult = FeedbackSubmissionResult | FeedbackDryRunResult;

export function normalizeFeedback(options: FeedbackOptions): NormalizedFeedback {
  const missing = [
    ['--feature-key', options.featureKey],
    ['--title', options.title],
    ['--description', options.description],
  ]
    .filter(([, value]) => !value?.trim())
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new CliError('USAGE', `feedback requires ${missing.join(', ')}.`, {
      nextSteps: ['Provide the reporter, feature key, title, and concise description.'],
      example: 'abap feedback --feature-key "abap.feedback" --title "..." --description "..." --json',
    });
  }

  const username = resolveFeedbackUsername(options.username);
  const featureKey = requiredText(options.featureKey, '--feature-key', 60);
  const title = requiredText(options.title, '--title', 120);
  const description = requiredText(options.description, '--description', 255);
  const email = optionalText(options.email, '--email', 241);
  if (email && (!email.includes('@') || !email.includes('.'))) {
    throw new CliError('INVALID_ARGUMENT', '--email must contain both @ and . characters.');
  }

  const priorityValue = (options.priority ?? 'NORMAL').trim().toUpperCase();
  if (!FEEDBACK_PRIORITIES.includes(priorityValue as FeedbackPriority)) {
    throw new CliError('INVALID_ARGUMENT', `--priority must be one of ${FEEDBACK_PRIORITIES.join(', ')}.`, {
      nextSteps: ['Use --priority LOW, NORMAL, HIGH, or URGENT.'],
      example: 'abap feedback --priority HIGH ...',
    });
  }

  const sourceSystem = optionalText(options.sourceSystem, '--source-system', 40) ?? 'abap-cli';
  const agentId = optionalText(options.agentId, '--agent-id', 60);
  const sessionId = optionalText(options.sessionId, '--session-id', 100);
  const correlationId = optionalText(options.correlationId, '--correlation-id', 64);
  const payload: FeedbackCreateRequest = {
    username,
    ...(email ? { email } : {}),
    feature_key: featureKey,
    title,
    description,
    priority: priorityValue as FeedbackPriority,
    ...(sourceSystem ? { source_system: sourceSystem } : {}),
    ...(agentId ? { agent_id: agentId } : {}),
    ...(sessionId ? { session_id: sessionId } : {}),
  };
  const explicitIdempotencyKey = optionalText(options.idempotencyKey, '--idempotency-key', 64);
  const idempotencyKey = explicitIdempotencyKey ?? generatedIdempotencyKey(payload);

  return {
    payload,
    idempotencyKey,
    ...(correlationId ? { correlationId } : {}),
  };
}

export async function submitFeedback(options: FeedbackOptions): Promise<FeedbackResult> {
  const request = normalizeFeedback(options);
  if (options.dryRun) {
    return {
      dryRun: true,
      payload: request.payload,
      idempotencyKey: request.idempotencyKey,
      ...(request.correlationId ? { correlationId: request.correlationId } : {}),
    };
  }

  const client = FeedbackClient.create();
  let response;
  try {
    response = await client.createIssue(request.payload, {
      idempotencyKey: request.idempotencyKey,
      ...(request.correlationId ? { correlationId: request.correlationId } : {}),
    });
  } catch (error: unknown) {
    if (error instanceof CliError) {
      throw new CliError(error.code, error.message, {
        details: { ...error.details, idempotencyKey: request.idempotencyKey },
        nextSteps: error.nextSteps,
        example: error.example,
      });
    }
    throw error;
  }
  return {
    duplicate: response.data.duplicate,
    ...(response.data.issue ? { issue: response.data.issue } : {}),
    ...(response.request_id ? { request_id: response.request_id } : {}),
    idempotencyKey: request.idempotencyKey,
  };
}

export function formatFeedbackHuman(result: FeedbackResult): string {
  if ('dryRun' in result) return 'Feedback request is valid; no request was sent.';
  const issueId = typeof result.issue?.issueId === 'string' ? ` (${result.issue.issueId})` : '';
  const state = result.duplicate ? 'already submitted' : 'submitted';
  return `Feedback ${state}${issueId}${result.request_id ? `. Request ${result.request_id}` : ''}.`;
}

function requiredText(value: string | undefined, option: string, maxLength: number): string {
  const text = value?.trim() ?? '';
  if (!text) throw new CliError('USAGE', `${option} must not be empty.`);
  validateLength(text, option, maxLength);
  return text;
}

function optionalText(value: string | undefined, option: string, maxLength = Number.POSITIVE_INFINITY): string | undefined {
  if (value === undefined) return undefined;
  const text = value.trim();
  if (!text) throw new CliError('INVALID_ARGUMENT', `${option} must not be empty.`);
  validateLength(text, option, maxLength);
  return text;
}

function validateLength(value: string, option: string, maxLength: number): void {
  if (value.length > maxLength) {
    throw new CliError('INVALID_ARGUMENT', `${option} must be at most ${maxLength} characters.`);
  }
}

/**
 * Resolve the business username for a feedback submission.
 *
 * `--username` is documented as *optional* (see `commands/feedback.ts`), so the
 * fallback chain must actually work on every platform. It used to read
 * `USERNAME` only — a Windows/PowerShell variable that does not exist on macOS
 * or Linux — and the guidance was PowerShell-only, so `abap feedback` failed out
 * of the box for every POSIX user (feedback F-06).
 *
 * Order: explicit flag → `$USERNAME` (Windows) → `$USER` (POSIX) →
 * `os.userInfo().username` → `git config user.name`.
 */
function resolveFeedbackUsername(explicitUsername?: string): string {
  if (explicitUsername !== undefined) return requiredText(explicitUsername, '--username', 80);

  const candidates: Array<{ source: string; value: string | undefined }> = [
    { source: 'USERNAME', value: process.env.USERNAME },
    { source: 'USER', value: process.env.USER },
    { source: 'os.userInfo().username', value: safeOsUsername() },
    { source: 'git config user.name', value: gitConfigUserName() },
  ];
  for (const candidate of candidates) {
    const value = candidate.value?.trim();
    if (!value) continue;
    validateLength(value, `$${candidate.source}`, 80);
    return value;
  }

  const isWindows = process.platform === 'win32';
  throw new CliError('CONFIG_ERROR', 'Could not determine a username for feedback.', {
    details: { tried: candidates.map((c) => c.source) },
    nextSteps: [
      isWindows
        ? 'Set $env:USERNAME in PowerShell, then retry without --username.'
        : 'Set USER in your shell, then retry without --username.',
      'Or pass --username <name> explicitly.',
    ],
    example: isWindows
      ? '$env:USERNAME = "agent-user"; abap feedback --feature-key "abap.cli" --title "..." --description "..." --json'
      : 'abap feedback --username "$(whoami)" --feature-key "abap.cli" --title "..." --description "..." --json',
  });
}

/** `os.userInfo()` throws on some sandboxed/containerised environments. */
function safeOsUsername(): string | undefined {
  try {
    return os.userInfo().username;
  } catch {
    return undefined;
  }
}

/** Best-effort `git config user.name`; never throws, never blocks for long. */
function gitConfigUserName(): string | undefined {
  try {
    const result = spawnSync('git', ['config', 'user.name'], { encoding: 'utf8', timeout: 2000 });
    if (result.status !== 0) return undefined;
    return result.stdout?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function generatedIdempotencyKey(payload: FeedbackCreateRequest): string {
  const digest = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  return `abap-feedback-${digest.slice(0, 47)}`;
}