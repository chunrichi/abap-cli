import { Command } from 'commander';
import { jsonFromCommand, printError, printResult, printSchema } from '../output/json.js';
import { formatFeedbackHuman, submitFeedback, type FeedbackOptions } from '../flows/feedback-flow.js';

const SCHEMA = {
  schemaVersion: 1,
  command: 'feedback',
  description: 'Submit one sanitized issue from a completed agent session.',
  usage: 'feedback [options]',
  arguments: [],
  options: [
    { name: '--username', type: 'string', valuePlaceholder: '<name>', description: 'Optional business username override; when omitted it is resolved from $USERNAME, $USER, the OS user info, or `git config user.name`.' },
    { name: '--email', type: 'string', valuePlaceholder: '<address>', description: 'Optional contact email.' },
    { name: '--feature-key', type: 'string', valuePlaceholder: '<key>', required: true, description: 'Stable feature or function identifier.' },
    { name: '--title', type: 'string', valuePlaceholder: '<text>', required: true, description: 'Short issue summary.' },
    { name: '--description', type: 'string', valuePlaceholder: '<text>', required: true, description: 'Concise plain-text observation, maximum 255 characters.' },
    { name: '--priority', type: 'string', valuePlaceholder: '<level>', default: 'NORMAL', allowedValues: ['LOW', 'NORMAL', 'HIGH', 'URGENT'], description: 'Issue priority.' },
    { name: '--source-system', type: 'string', valuePlaceholder: '<name>', default: 'abap-cli', description: 'Calling client or system name.' },
    { name: '--agent-id', type: 'string', valuePlaceholder: '<id>', description: 'Optional agent or product identifier.' },
    { name: '--session-id', type: 'string', valuePlaceholder: '<id>', description: 'Optional completed agent session identifier.' },
    { name: '--idempotency-key', type: 'string', valuePlaceholder: '<key>', description: 'Stable retry key; generated when omitted.' },
    { name: '--correlation-id', type: 'string', valuePlaceholder: '<id>', description: 'Optional trace identifier sent as X-Correlation-ID.' },
    { name: '--dry-run', type: 'boolean', description: 'Validate and print the normalized request without submitting it.' },
    { name: '--schema', type: 'boolean', description: 'Print this command schema and exit without loading configuration or calling SAP.' },
    { name: '--json', type: 'boolean', global: true, description: 'Emit the unified JSON envelope on stdout.' },
    { name: '--pretty-json', type: 'boolean', global: true, description: 'Emit formatted JSON instead of compact JSON.' },
  ],
  globalOptions: ['--json', '--pretty-json', '--report-stuck'],
  examples: [
    {
      description: 'Submit a concise issue from a completed session',
      command: 'abap feedback --feature-key abap.push --title "Push reports an unclear error" --description "A valid class push fails after syntax check with no actionable detail." --priority NORMAL --session-id session-123 --json',
    },
    {
      description: 'Validate the request without sending it',
      command: 'abap feedback --username agent-user --feature-key abap.cli --title "Example" --description "Example feedback." --dry-run --json',
    },
  ],
  errors: [
    { code: 'USAGE', category: 'USAGE', exitCode: 2 },
    { code: 'INVALID_ARGUMENT', category: 'USAGE', exitCode: 2 },
    { code: 'VALIDATION_ERROR', category: 'VALIDATION_ERROR', exitCode: 7 },
    { code: 'CONFLICT', category: 'VALIDATION_ERROR', exitCode: 7 },
    { code: 'PERSISTENCE_ERROR', category: 'SAP_ERROR', exitCode: 6 },
    { code: 'HTTP_ERROR', category: 'SAP_ERROR', exitCode: 6 },
    { code: 'AUTH_ERROR', category: 'AUTH_ERROR', exitCode: 5 },
    { code: 'TLS_ERROR', category: 'TLS_ERROR', exitCode: 4 },
    { code: 'SAP_ERROR', category: 'SAP_ERROR', exitCode: 6 },
  ],
};

export function registerFeedbackCommand(program: Command): void {
  program
    .command('feedback')
    .description('Submit a completed-session feedback issue')
    .option('--username <name>', 'Optional business username override; auto-detected from $USERNAME/$USER/OS user/git config when omitted')
    .option('--email <address>', 'Optional contact email')
    .option('--feature-key <key>', 'Stable feature or function identifier')
    .option('--title <text>', 'Short issue summary')
    .option('--description <text>', 'Concise plain-text observation')
    .option('--priority <level>', 'Issue priority: LOW, NORMAL, HIGH, or URGENT', 'NORMAL')
    .option('--source-system <name>', 'Calling client or system name', 'abap-cli')
    .option('--agent-id <id>', 'Optional agent or product identifier')
    .option('--session-id <id>', 'Optional completed agent session identifier')
    .option('--idempotency-key <key>', 'Stable retry key; generated when omitted')
    .option('--correlation-id <id>', 'Optional trace identifier')
    .option('--dry-run', 'Validate and print the request without submitting it')
    .option('--schema', 'Print the command schema and exit without a request')
    .action(async (opts: FeedbackOptions & { schema?: boolean }, cmd: Command) => {
      const mode = jsonFromCommand(cmd);
      if (opts.schema) {
        printSchema(SCHEMA);
        return;
      }
      try {
        const result = await submitFeedback(opts);
        printResult(mode, feedbackOutput(result), formatFeedbackHuman(result));
      } catch (error: unknown) {
        await printError(mode, error);
      }
    });
}

function feedbackOutput(result: Awaited<ReturnType<typeof submitFeedback>>): unknown {
  if ('dryRun' in result) return result;
  return {
    status: result.duplicate ? 'duplicate' : 'submitted',
    ...(result.issue?.issueId ? { id: result.issue.issueId } : {}),
    ...(result.issue?.status ? { issueStatus: result.issue.status } : {}),
  };
}